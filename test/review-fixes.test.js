'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const makePlugin = require('../index')
const { InferenceEngine } = require('../lib/inference-engine')
const { centroidGeometry, pathPolygonThreat, pointInGeometry, distanceToGeometryMeters, translateGeometryLocal } = require('../lib/storm-engine')

const cell = (confidence, state = 'warn') => ({ trackId:'cell-1', state, threat:{ state, confidence, method:'test' } })
const algorithm = (id, options = {}) => ({ id, name:id, weight:options.weight ?? 1, capabilities:options.capabilities || { detector:true }, infer:options.infer || (() => [cell(options.confidence ?? 0.5, options.state)]) })

test('inference health distinguishes detector success, degradation, and unavailability', async () => {
  const primaryFailure = algorithm('primary',{infer(){throw new Error('detector failed')}})
  const refiner = algorithm('refiner',{capabilities:{detector:false,candidateRefiner:true},infer:({baseCells})=>baseCells})
  let engine = new InferenceEngine(new Map([['primary',primaryFailure],['refiner',refiner]]))
  assert.deepEqual(await engine.infer({}),[])
  assert.equal(engine.describe().health.state,'unavailable')
  assert.deepEqual(engine.describe().health.failedAlgorithms,['primary'])

  const primary = algorithm('primary',{infer:()=>[cell(.6)]})
  const failedRefiner = algorithm('refiner',{capabilities:{detector:false,candidateRefiner:true},infer(){throw new Error('refiner failed')}})
  engine = new InferenceEngine(new Map([['primary',primary],['refiner',failedRefiner]]))
  assert.equal((await engine.infer({})).length,1)
  assert.equal(engine.describe().health.state,'degraded')

  engine = new InferenceEngine(new Map([['primary',algorithm('primary',{infer:()=>[]})]]))
  assert.deepEqual(await engine.infer({}),[])
  assert.equal(engine.describe().health.state,'no-candidates')

  engine = new InferenceEngine(new Map([['one',primaryFailure],['two',algorithm('two',{infer(){throw new Error('also failed')}})]]))
  await engine.infer({})
  assert.equal(engine.describe().health.state,'unavailable')
})

test('weighted confidence is cumulative, order independent, and honors zero weight', async () => {
  const definitions = [algorithm('a',{confidence:.2,weight:1,state:'normal'}),algorithm('b',{confidence:.8,weight:2,state:'alarm'}),algorithm('c',{confidence:1,weight:0,state:'alarm'})]
  async function run(items) {
    const engine = new InferenceEngine(new Map(items.map(item=>[item.id,item])),{strategy:'weighted-confidence'})
    return (await engine.infer({}))[0]
  }
  const forward=await run(definitions),reverse=await run([...definitions].reverse())
  assert.ok(Math.abs(forward.threat.confidence-.6)<1e-12)
  assert.equal(reverse.threat.confidence,forward.threat.confidence)
  assert.equal(forward.state,'alarm')
  assert.equal(forward.threat.evidence.algorithms.c.weight,0)
  assert.deepEqual(Object.keys(forward.threat.evidence.algorithms).sort(),['a','b','c'])

  const zero=await run([algorithm('a',{confidence:.9,weight:0,state:'alarm'}),algorithm('b',{confidence:.4,weight:0,state:'warn'})])
  assert.equal(zero.threat.confidence,0)
  assert.equal(zero.state,'normal')
})

test('multimodal DNN preserves configured zero weight', () => {
  const definition=require('../inference-algorithms/multimodal-dnn')
  const instance=definition.create({settings:{modelPath:path.join(__dirname,'..','models','stormfusion-reference-v1.json'),weight:0}})
  assert.equal(instance.weight,0)
})

test('zero storm base uncertainty is preserved by runtime normalization', () => {
  const app={registerResourceProvider(){},getDataDirPath:()=>path.join(os.tmpdir(),'storm-zero-uncertainty'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const plugin=makePlugin(app)
  plugin.start({backgroundEnabled:false,displayLayers:[],acquisitionTargets:[],stormBaseUncertaintyNm:0})
  assert.equal(plugin._test.config().stormBaseUncertaintyNm,0)
  plugin.stop()
})

test('failed radar frame is retried and operational error recovers after success', async () => {
  const providerId='radar-dpc',algorithmId='kinematic-polygon',target=`${providerId}:HRD`,epochMs=Date.parse('2026-08-20T00:00:00Z')
  let inferenceCalls=0,downloads=0
  const adapter={id:providerId,name:'Retry test',products:{VMI:{title:'Display',kind:'raster'},SRI:{title:'Display',kind:'raster'},HRD:{title:'Cells',kind:'vector',raw:true,cells:true}},recommended:{enabled:false},create(){return{id:providerId,name:'Retry test',products:()=>adapter.products,latest:async()=>({epochMs,time:new Date(epochMs).toISOString()}),tile:async()=>Buffer.alloc(0),downloadRaw:async()=>{downloads++;return{buffer:Buffer.from('raw'),key:'frame.bin'}},rawExtension:()=>'.bin',cellsFromRaw:async()=>[{id:'cell-1',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},properties:{severity:2}}]}}}
  const definition={id:algorithmId,name:'Retry detector',defaults:{enabled:true,weight:1},create(){return{id:algorithmId,name:'Retry detector',weight:1,capabilities:{detector:true},infer(){inferenceCalls++;if(inferenceCalls===1)throw new Error('transient processing failure');return[]}}}}
  const {ADAPTERS,INFERENCE_ALGORITHMS}=makePlugin._test
  const originalAdapter=ADAPTERS.get(providerId),originalAlgorithm=INFERENCE_ALGORITHMS.get(algorithmId)
  ADAPTERS.set(providerId,adapter);INFERENCE_ALGORITHMS.set(algorithmId,definition)
  const providers=[],messages=[]
  const app={registerResourceProvider:p=>providers.push(p),getDataDirPath:()=>path.join(os.tmpdir(),`storm-retry-${process.pid}`),setPluginStatus(){},debug(){},error(){},handleMessage:(id,message)=>messages.push(message),getSelfPath(){return null}}
  const plugin=makePlugin(app)
  try {
    plugin.start({backgroundEnabled:false,pollSeconds:300,enabledProviders:[providerId],displayLayers:[],acquisitionTargets:[target],stormSource:target,inferenceAlgorithms:[algorithmId],lightningEnabled:false,onboardEnvironmentEnabled:false,weatherApiObservationsEnabled:false,prefetchEnabled:false})
    assert.deepEqual(await plugin._test.scheduledAcquisitionCycle(),{attempted:false,reason:'background-disabled',errors:[]})
    let cycle=await plugin._test.acquireCycle();assert.equal(cycle.attempted,true);assert.equal(cycle.ok,false);assert.equal(cycle.errors[0].component,`acquisition:${target}`)
    let resources=await providers.find(p=>p.type==='stormIntelligence').methods.listResources()
    assert.deepEqual(resources.status.acquisition.lastAcquired,{})
    assert.match(resources.status.lastError,/inference unavailable/)
    assert.equal(resources.inference.health.state,'unavailable')
    assert.match(resources.inference.lastRuns[0].error,/transient processing failure/)
    cycle=await plugin._test.acquireCycle();assert.equal(cycle.ok,true)
    resources=await providers.find(p=>p.type==='stormIntelligence').methods.listResources()
    assert.equal(resources.status.acquisition.lastAcquired[target],epochMs)
    assert.equal(resources.status.lastError,null)
    assert.equal(resources.inference.health.state,'no-candidates')
    await plugin._test.acquireCycle()
    assert.equal(inferenceCalls,2)
    assert.equal(downloads,1)
    assert.ok(messages.some(message=>message.updates?.[0]?.values?.[0]?.value?.message?.includes('inference unavailable')))
  } finally {
    plugin.stop();ADAPTERS.set(providerId,originalAdapter);INFERENCE_ALGORITHMS.set(algorithmId,originalAlgorithm)
  }
})

test('polygon centroid is area weighted for holes, multipolygons, and closed rings', () => {
  const polygon={type:'Polygon',coordinates:[[[0,0],[4,0],[4,2],[0,2],[0,0]]]}
  assert.deepEqual(centroidGeometry(polygon),[2,1])
  const hole={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[2,1],[4,1],[4,3],[2,3],[2,1]]]}
  const hc=centroidGeometry(hole);assert.ok(Math.abs(hc[0]-5/3)<1e-12);assert.ok(Math.abs(hc[1]-2)<1e-12)
  const multi={type:'MultiPolygon',coordinates:[[[[0,0],[2,0],[2,2],[0,2],[0,0]]],[[[4,0],[6,0],[6,2],[4,2],[4,0]]]]}
  assert.deepEqual(centroidGeometry(multi),[3,1])
  assert.deepEqual(centroidGeometry({type:'Polygon',coordinates:[[[0,0],[2,0],[4,0],[0,0]]]}),[2,0])
})

test('adaptive path interception detects crossing between coarse samples', () => {
  const narrow={type:'Polygon',coordinates:[[[.004,-.001],[.006,-.001],[.006,.001],[.004,.001],[.004,-.001]]]}
  const result=pathPolygonThreat([0,0],{east:20,north:0},narrow,{east:0,north:0},60,{stepSec:60,uncertaintyM:0})
  assert.equal(result.intersects,true)
  assert.ok(result.interceptSec>0&&result.interceptSec<60)
})

test('onboard environment freshness is timestamp-aware and conservative',()=>{
  const {EnvironmentFusion}=require('../lib/environment-fusion'),now=Date.parse('2026-08-21T12:00:00Z')
  const make=timestamp=>({getSelfPath:()=>({value:10,timestamp})})
  assert.equal(new EnvironmentFusion({maxAgeSec:180}).sample(make(new Date(now-180000).toISOString()),now).available,true)
  const stale=new EnvironmentFusion({maxAgeSec:180}).sample(make(new Date(now-180001).toISOString()),now)
  assert.equal(stale.available,false);assert.equal(stale.stale,true);assert.equal(stale.reason,'stale')
  const missing=new EnvironmentFusion({maxAgeSec:180}).sample({getSelfPath:()=>10},now)
  assert.equal(missing.available,false);assert.equal(missing.reason,'missing-timestamp')
  assert.equal(new EnvironmentFusion({maxAgeSec:0}).sample(make('2020-01-01T00:00:00Z'),now).available,true)
})

test('storm geometry is antimeridian-safe without regressing ordinary polygons',()=>{
  const crossing={type:'Polygon',coordinates:[[[179.8,10],[-179.8,10],[-179.8,11],[179.8,11],[179.8,10]]]}
  const centroid=centroidGeometry(crossing);assert.ok(Math.abs(Math.abs(centroid[0])-180)<1e-9);assert.ok(Math.abs(centroid[1]-10.5)<1e-9)
  assert.equal(pointInGeometry([179.9,10.5],crossing),true);assert.equal(pointInGeometry([-179.9,10.5],crossing),true)
  assert.equal(distanceToGeometryMeters([-179.9,10.5],crossing),0)
  const translated=translateGeometryLocal(crossing,10,0,600);assert.ok(translated.coordinates[0].some(p=>p[0]<0));assert.ok(translated.coordinates[0].some(p=>p[0]>0))
  assert.deepEqual(centroidGeometry({type:'Polygon',coordinates:[[[0,0],[4,0],[4,2],[0,2],[0,0]]]}),[2,1])
})

test('OpenAPI validates and declares path parameters, responses, and administrative access',async()=>{
  const plugin=makePlugin({}),doc=plugin.getOpenApi()
  await require('@apidevtools/swagger-parser').validate(doc)
  assert.match(doc.openapi,/^3\./)
  for(const [pathName,item] of Object.entries(doc.paths))for(const operation of Object.values(item)){
    assert.ok(operation.responses?.['200'])
    for(const name of pathName.match(/\{([^}]+)\}/g)||[])assert.ok(operation.parameters?.some(p=>p.in==='path'&&p.required&&p.name===name.slice(1,-1)),`${pathName} missing ${name}`)
  }
  assert.equal(doc.paths['/acquire'].post['x-access-level'],'admin');assert.ok(doc.paths['/acquire'].post.responses['502'])
})

test('stop clears both periodic and startup acquisition handles',()=>{
  const plugin=makePlugin({registerResourceProvider(){},getDataDirPath:()=>path.join(os.tmpdir(),'storm-lifecycle'),setPluginStatus(){},getSelfPath(){return null},handleMessage(){}})
  plugin.start({backgroundEnabled:true,pollSeconds:300,displayLayers:[],acquisitionTargets:[],prefetchEnabled:false,lightningEnabled:false,onboardEnvironmentEnabled:false,weatherApiObservationsEnabled:false,inferenceAlgorithms:[]})
  assert.ok(plugin._test.timers().timer);assert.ok(plugin._test.timers().startupTimer);plugin.stop();assert.deepEqual(plugin._test.timers(),{timer:null,startupTimer:null,busy:false})
})

test('lightning errors recover by provider and GPS loss publishes unavailable state',async()=>{
  const providerId='http-json-lightning';let fail=true,position={latitude:40,longitude:14};const messages=[],resources=[]
  const definition={id:providerId,name:'Lightning test',defaults:{enabled:true},create(){return{id:providerId,name:'Lightning test',capabilities:{points:true},observations:async()=>{if(fail)throw new Error('temporary outage');return[{id:'one',provider:providerId,time:new Date().toISOString(),latitude:40,longitude:14}]}}}}
  const original=makePlugin._test.OBSERVATION_ADAPTERS.get(providerId);makePlugin._test.OBSERVATION_ADAPTERS.set(providerId,definition)
  const app={registerResourceProvider:p=>resources.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'storm-lightning-recovery'),setPluginStatus(){},error(){},handleMessage:(id,message)=>messages.push(message),getSelfPath:p=>p==='navigation.position'?position:null}
  const plugin=makePlugin(app)
  try{
    plugin.start({backgroundEnabled:false,displayLayers:[],acquisitionTargets:[],prefetchEnabled:false,stormEnabled:false,inferenceAlgorithms:[],lightningEnabled:true,lightningProviders:[providerId],onboardEnvironmentEnabled:false,weatherApiObservationsEnabled:false})
    await plugin._test.lightningCycle();assert.ok(plugin._test.activeErrors.has(`lightning:${providerId}`));assert.equal(plugin._test.activeErrors.has('runtime'),false)
    fail=false;await plugin._test.lightningCycle();assert.equal(plugin._test.activeErrors.has(`lightning:${providerId}`),false)
    position=null;await plugin._test.lightningCycle();const state=(await resources.find(p=>p.type==='stormIntelligence').methods.listResources()).status.lightning
    assert.equal(state.state,'unavailable');assert.match(state.message,/position is missing/);assert.equal(state.observations.length,1)
    position={latitude:40,longitude:14};await plugin._test.lightningCycle();assert.equal((await resources.find(p=>p.type==='stormIntelligence').methods.listResources()).status.lightning.state,'normal');assert.ok(messages.length>=2)
  }finally{plugin.stop();makePlugin._test.OBSERVATION_ADAPTERS.set(providerId,original)}
})
