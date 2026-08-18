'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path'),fs=require('node:fs/promises')
const makePlugin=require('../index')
const {StormEngine,haversine,cpa,distanceToGeometryMeters}=require('../lib/storm-engine')
const {RecyclingStorage}=require('../lib/storage')
const {tileBBox3857,normalizeTime,extensionManifest}=makePlugin._test

test('Web Mercator tile bbox is correct for z0',()=>{const b=tileBBox3857(0,0,0);assert.ok(Math.abs(b[0]+20037508.342789244)<1e-6);assert.ok(Math.abs(b[3]-20037508.342789244)<1e-6)})
test('latest time normalization',()=>{assert.equal(normalizeTime('latest'),null);assert.equal(normalizeTime(undefined),null);assert.match(normalizeTime('2026-08-18T00:30:00Z'),/^2026-08-18T00:30:00\.000Z$/)})
test('plotter extension manifest supplies Freeboard-compatible panel, widget and button',()=>{const m=extensionManifest('signalk-storm-intelligence','0.2.0');assert.equal(m.apiVersion,'1');assert.ok(m.requires.includes('panels.iframe'));assert.equal(m.buttons[0].action.type,'togglePanel');assert.match(m.panels[0].url,/\/plotterext\/signalk-storm-intelligence\//)})
test('plugin schema contains no repeated object references',()=>{
  const app={getDataDirPath:()=>path.join(os.tmpdir(),'radar-schema-test'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const schema=makePlugin(app).schema()
  const seen=new WeakMap()
  const repeated=[]
  function walk(node,nodePath){
    if(node===null||typeof node!=='object')return
    if(seen.has(node)){repeated.push(`${nodePath} repeats ${seen.get(node)}`);return}
    seen.set(node,nodePath)
    if(Array.isArray(node))node.forEach((value,index)=>walk(value,`${nodePath}[${index}]`))
    else Object.keys(node).forEach(key=>walk(node[key],`${nodePath}.${key}`))
  }
  walk(schema,'schema')
  assert.deepEqual(repeated,[])
  assert.doesNotThrow(()=>JSON.stringify(schema))
})
test('plugin registers charts and plotterExtensions providers',async()=>{const ps=[];const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'radar-test-data'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}};const p=makePlugin(app);p.start({backgroundEnabled:false,displayProducts:['VMI','SRI']});assert.equal(ps.length,4);assert.ok(ps.find(x=>x.type==='stormIntelligence'));assert.ok(ps.find(x=>x.type==='weatherRadar'));const charts=await ps.find(x=>x.type==='charts').methods.listResources();assert.ok(charts['weather-radar-radar-dpc-vmi']);const exts=await ps.find(x=>x.type==='plotterExtensions').methods.listResources();assert.ok(exts['signalk-storm-intelligence']);p.stop()})
test('storm engine tracks an approaching polygon and predicts CPA',()=>{const e=new StormEngine({warnDistanceM:50000,alarmDistanceM:10000,horizonMinutes:60,warnSeverity:2,alarmSeverity:4,matchDistanceM:100000});const poly=lon=>({type:'Feature',properties:{severity:3},geometry:{type:'Polygon',coordinates:[[[lon,40],[lon+.01,40],[lon+.01,40.01],[lon,40.01],[lon,40]]]}});const v={position:{longitude:12,latitude:40.005},sog:0,cog:0};e.evaluate({epochMs:0,features:[poly(12.5)]},v);const r=e.evaluate({epochMs:300000,features:[poly(12.45)]},v)[0];assert.ok(r.motion.speed>0);assert.ok(r.cpa.closing);assert.ok(r.cpa.dcpaMeters<r.distanceMeters);assert.notEqual(r.state,'normal')})
test('distant severe cell does not alarm',()=>{const e=new StormEngine({warnDistanceM:20000,alarmDistanceM:8000,horizonMinutes:60,warnSeverity:2,alarmSeverity:4,matchDistanceM:100000});const f={type:'Feature',properties:{severity:5},geometry:{type:'Polygon',coordinates:[[[14,42],[14.01,42],[14.01,42.01],[14,42.01],[14,42]]]}};const r=e.evaluate({epochMs:0,features:[f]},{position:{longitude:12,latitude:40},sog:0,cog:0})[0];assert.equal(r.state,'normal')})
test('recycling storage enforces byte budget oldest-first',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-store-'));const s=new RecyclingStorage(dir,{enabled:true,maxBytes:8,maxAgeMs:0});await s.init();await s.put('HRD',1,Buffer.alloc(6),'.zip');await new Promise(r=>setTimeout(r,10));await s.put('HRD',2,Buffer.alloc(6),'.zip');const st=await s.stats();assert.equal(st.files,1);assert.ok(st.bytes<=8);await fs.rm(dir,{recursive:true,force:true})})
test('CPA calculation returns closest approach inside horizon',()=>{const r=cpa([12,40],[12.1,40],{east:-10,north:0},{east:0,north:0},3600);assert.ok(r.closing);assert.ok(r.tcpaSec>0);assert.ok(r.dcpaMeters<100)})

test('storm distance uses polygon boundary rather than only centroid',()=>{const g={type:'Polygon',coordinates:[[[12,40],[12.2,40],[12.2,40.2],[12,40.2],[12,40]]]};assert.equal(distanceToGeometryMeters([12.1,40.1],g),0);assert.ok(distanceToGeometryMeters([11.99,40.1],g)<1000)})

const {DwdProvider,parseTimeDimension,selectObservationEpoch}=require('../lib/dwd-provider')
const {assertProvider,describeProvider}=require('../lib/provider-contract')

test('DWD WMS time parser expands ISO interval and latest observation excludes future nowcast',()=>{
  const xml='<Dimension name="time">2026-08-18T00:00:00Z/2026-08-18T02:00:00Z/PT5M</Dimension>'
  const times=parseTimeDimension(xml)
  assert.equal(times.length,25)
  const now=Date.parse('2026-08-18T00:42:00Z')
  assert.equal(new Date(selectObservationEpoch(times,now,0)).toISOString(),'2026-08-18T00:40:00.000Z')
})

test('DWD provider satisfies minimal contract without pretending raw/cell capability',()=>{
  const p=assertProvider(new DwdProvider({requestTimeoutMs:1000}))
  const d=describeProvider(p)
  assert.equal(d.products.RAIN_RATE.capabilities.map,true)
  assert.equal(d.products.RAIN_RATE.capabilities.temporal,true)
  assert.equal(d.products.RAIN_RATE.capabilities.raw,false)
  assert.equal(d.products.RAIN_RATE.capabilities.cells,false)
  assert.equal(d.products.RAIN_RATE.capabilities.forecast,true)
})

test('multi-provider plugin can advertise DPC and DWD chart overlays together',async()=>{
  const ps=[]
  const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'radar-test-data-multi'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const p=makePlugin(app)
  p.start({backgroundEnabled:false,displayLayers:['radar-dpc:VMI','dwd:RAIN_RATE']})
  const charts=await ps.find(x=>x.type==='charts').methods.listResources()
  assert.ok(charts['weather-radar-radar-dpc-vmi'])
  assert.ok(charts['weather-radar-dwd-rain-rate'])
  const wr=await ps.find(x=>x.type==='stormIntelligence').methods.listResources()
  assert.ok(wr['provider:radar-dpc'])
  assert.ok(wr['provider:dwd'])
  p.stop()
})

const { TileStore, tilesAroundPosition } = require('../lib/tile-store')

test('prefetch tile enumeration covers a finite operating area and obeys hard cap',()=>{
  const tiles=tilesAroundPosition({latitude:40.83,longitude:14.25},40*1852,[5,6,7,8],120)
  assert.ok(tiles.length>0)
  assert.ok(tiles.length<=120)
  assert.ok(tiles.some(t=>t.z===8))
  assert.equal(new Set(tiles.map(t=>`${t.z}/${t.x}/${t.y}`)).size,tiles.length)
})

test('prefetch tile enumeration handles antimeridian without invalid x coordinates',()=>{
  const tiles=tilesAroundPosition({latitude:0,longitude:179.9},100*1852,[5],200)
  assert.ok(tiles.length>0)
  assert.ok(tiles.every(t=>t.x>=0 && t.x<2**t.z && t.y>=0 && t.y<2**t.z))
})

test('persistent tile store supports replay frames, newest fallback and recycling',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'radar-tile-store-'))
  const store=new TileStore(root,{enabled:true,maxBytes:7,maxAgeMs:0})
  await store.init()
  await store.put('radar-dpc','VMI',1000,5,1,2,Buffer.from('aaaa'))
  await new Promise(r=>setTimeout(r,5))
  await store.put('radar-dpc','VMI',2000,5,1,2,Buffer.from('bbbb'))
  assert.deepEqual(await store.frames('radar-dpc','VMI'),[1000,2000])
  assert.equal((await store.newestTile('radar-dpc','VMI',5,1,2)).buffer.toString(),'bbbb')
  const recycled=await store.recycle()
  assert.ok(recycled.removed>=1)
  const stats=await store.stats()
  assert.ok(stats.bytes<=7)
  await fs.rm(root,{recursive:true,force:true})
})

test('plugin advertises prefetch/replay state without requiring background network',async()=>{
  const ps=[]
  const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'radar-test-data-prefetch'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const p=makePlugin(app)
  p.start({backgroundEnabled:false,prefetchEnabled:true,prefetchTargets:['radar-dpc:VMI'],displayLayers:['radar-dpc:VMI']})
  const wr=await ps.find(x=>x.type==='stormIntelligence').methods.listResources()
  assert.equal(wr.status.prefetch.enabled,true)
  assert.deepEqual(wr.status.prefetch.targets,['radar-dpc:VMI'])
  assert.equal(wr.status.prefetch.radiusNm,40)
  p.stop()
})

const { playbackSlots, resolveSlot, playbackChartId } = require('../lib/playback')

test('playback slots normalize to newest-first observation frames',()=>{
  const frames=['2026-08-18T00:00:00Z','2026-08-18T00:05:00Z','2026-08-18T00:10:00Z']
  const slots=playbackSlots(frames,3)
  assert.deepEqual(slots.map(x=>x.slot),[0,1,2])
  assert.deepEqual(slots.map(x=>x.time),['2026-08-18T00:10:00.000Z','2026-08-18T00:05:00.000Z','2026-08-18T00:00:00.000Z'])
  assert.equal(slots[0].live,true)
  assert.equal(resolveSlot(frames,2).time,'2026-08-18T00:00:00.000Z')
})

test('playback chart records expose bounded distinct slot URLs without changing logical provider/product',()=>{
  const {chartRecords}=makePlugin._test
  const provider={id:'test',name:'Test Radar',attribution:'Test',products:()=>({RAIN:{title:'Rain',description:'Rain mosaic',kind:'raster',temporal:true}}),tile(){},latest(){}}
  const records=chartRecords('signalk-storm-intelligence',provider,'RAIN',{minZoom:4,maxZoom:12,playbackEnabled:true,playbackSlots:4})
  assert.equal(records.length,4)
  assert.equal(records[0][0],playbackChartId('test','RAIN',0))
  assert.equal(records[0][1].stormIntelligence.playbackSlot,0)
  assert.match(records[1][1].url,/\?slot=1$/)
  assert.match(records[3][1].url,/\?slot=3$/)
  assert.ok(records.every(([,r])=>r.provider==='test'&&r.product==='RAIN'))
})

test('Freeboard panel playback drives only standard chart and extension-state host methods',async()=>{
  const html=await fs.readFile(path.join(__dirname,'..','public','radar-panel.html'),'utf8')
  assert.match(html,/chart\.setVisibility/)
  assert.match(html,/chart\.setOpacity/)
  assert.match(html,/state\.set/)
  assert.match(html,/data-slot/)
  assert.doesNotMatch(html,/OpenLayers|ol\.Map|document\.querySelector\([^)]*freeboard/i)
})

const { destination, translateGeometry, cellToHazard, renderHazardTile, geometryBounds } = require('../lib/hazard-overlay')

test('hazard normalization predicts future centroid and translated polygon',()=>{
  const cell={id:'c1',state:'warn',severity:3,geometry:{type:'Polygon',coordinates:[[[14,40],[14.02,40],[14.02,40.02],[14,40.02],[14,40]]]},centroid:[14.01,40.01],motion:{east:10,north:0,speed:10,course:90},distanceMeters:10000,cpa:{dcpaMeters:5000,tcpaSec:900}}
  const h=cellToHazard(cell,[15,30])
  assert.equal(h.predictions.length,2)
  assert.ok(h.predictions[0].centroid[0]>h.centroid[0])
  assert.equal(h.predictions[0].geometry.type,'Polygon')
  assert.deepEqual(geometryBounds(cell.geometry),[14,40,14.02,40.02])
})

test('hazard tile renderer creates transparent PNG with plotted storm geometry',()=>{
  const cell={id:'c1',state:'alarm',geometry:{type:'Polygon',coordinates:[[[13.9,39.9],[14.1,39.9],[14.1,40.1],[13.9,40.1],[13.9,39.9]]]},centroid:[14,40],motion:{east:5,north:0,speed:5}}
  const png=renderHazardTile([cell],6,34,24,{predictionMinutes:[15,30]})
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10])
  assert.ok(png.length>100)
})

test('hazard chart resources use rolling slots and public weather-radar tile route',()=>{
  const {hazardChartRecords,hazardChartId}=makePlugin._test
  const rows=hazardChartRecords('signalk-storm-intelligence',{hazardOverlayEnabled:true,hazardOverlaySlots:3,minZoom:4,maxZoom:13})
  assert.equal(rows.length,3)
  assert.equal(rows[0][0],hazardChartId(0))
  assert.match(rows[2][1].url,/\/stormintelligence\/signalk-storm-intelligence\/hazards\/2\/\{z\}\/\{x\}\/\{y\}\.png$/)
  assert.equal(rows[0][1].stormIntelligence.kind,'hazards')
})

test('weatherRadar resources include normalized hazard collection and overlay status',async()=>{
  const ps=[]
  const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'radar-test-hazards'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const p=makePlugin(app);p.start({backgroundEnabled:false,hazardOverlayEnabled:true,hazardOverlaySlots:4})
  const wr=await ps.find(x=>x.type==='stormIntelligence').methods.listResources()
  assert.equal(wr.hazards.kind,'hazards')
  assert.equal(wr.hazards.type,'FeatureCollection')
  assert.equal(wr.status.storm.overlay.enabled,true)
  const charts=await ps.find(x=>x.type==='charts').methods.listResources()
  assert.ok(charts['storm-intelligence-hazards'])
  p.stop()
})

test('Freeboard storm UI uses host chart layer and map viewport APIs only',async()=>{
  const html=await fs.readFile(path.join(__dirname,'..','public','radar-panel.html'),'utf8')
  assert.match(html,/Storm Intelligence · Storm cells/)
  assert.match(html,/chart\.setVisibility/)
  assert.match(html,/map\.fitBounds/)
  assert.match(html,/data-locate/)
  assert.doesNotMatch(html,/ol\.layer|OpenLayers|freeboard.*document/i)
})

test('multi-frame storm tracking increases confidence and resists a single noisy displacement',()=>{
  const {StormEngine}=require('../lib/storm-engine')
  const e=new StormEngine({warnDistanceM:100000,alarmDistanceM:10000,horizonMinutes:60,warnSeverity:1,alarmSeverity:9,matchDistanceM:100000,historyFrames:8})
  const poly=lon=>({type:'Feature',properties:{severity:2},geometry:{type:'Polygon',coordinates:[[[lon,40],[lon+.01,40],[lon+.01,40.01],[lon,40.01],[lon,40]]]}})
  const v={position:{longitude:12,latitude:40},sog:0,cog:0}
  let r
  for(const [i,lon] of [12.50,12.47,12.44,12.405,12.38].entries()) r=e.evaluate({epochMs:i*300000,features:[poly(lon)]},v)[0]
  assert.ok(r.motion.samples>=5)
  assert.ok(r.motion.confidence>0.5)
  assert.ok(r.motion.speed>0)
  assert.equal(r.motion.method,'track-robust')
  assert.equal(r.history.length,5)
})

test('polygon path threat detects vessel interception even when centroid CPA is less informative',()=>{
  const {pathPolygonThreat}=require('../lib/storm-engine')
  const g={type:'Polygon',coordinates:[[[12.05,39.99],[12.15,39.99],[12.15,40.01],[12.05,40.01],[12.05,39.99]]]}
  const t=pathPolygonThreat([12,40],{east:5,north:0},g,{east:-2,north:0},3600,{stepSec:30,uncertaintyM:200})
  assert.equal(t.intersects,true)
  assert.ok(t.interceptSec>0)
  assert.ok(t.minDistanceMeters<=200)
})

test('normalized hazards expose track history confidence and polygon-path threat',()=>{
  const {cellToHazard}=require('../lib/hazard-overlay')
  const c={id:'storm-1',trackId:'storm-1',sourceId:'raw-9',state:'warn',severity:3,geometry:{type:'Polygon',coordinates:[[[12,40],[12.01,40],[12.01,40.01],[12,40.01],[12,40]]]},centroid:[12.005,40.005],motion:{east:3,north:1,speed:3.16,course:71,samples:4,confidence:.8,method:'track-robust'},history:[{time:'2026-08-18T00:00:00Z',centroid:[12.1,40]}],threat:{state:'warn',confidence:.8,method:'polygon-path',intersects:true,interceptSec:900,uncertaintyMeters:2500}}
  const h=cellToHazard(c,[15])
  assert.equal(h.trackId,'storm-1')
  assert.equal(h.sourceId,'raw-9')
  assert.equal(h.history.length,1)
  assert.equal(h.threat.intersects,true)
  assert.equal(h.predictions[0].confidence,.8)
  assert.equal(h.predictions[0].provenance,'track-robust')
})

const { discoverAdapters, knownProducts, defaultsFromAdapters, instantiateAdapters } = require('../lib/provider-registry')

test('a third provider adapter is discovered and instantiated without core changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'weather-radar-adapters-'))
  const adapterFile = path.join(dir, 'third.js')
  await fs.writeFile(adapterFile, `
    module.exports = {
      id: 'third', name: 'Third Radar',
      products: { MOSAIC: { title:'Third Mosaic', description:'Synthetic third-provider mosaic', kind:'raster', units:'dBZ', period:'PT10M' } },
      defaults: { endpoint:'https://example.invalid/wms' },
      recommended: { enabled:true, display:['MOSAIC'], prefetch:['MOSAIC'] },
      settingsSchema: { properties: { endpoint:{type:'string'} } },
      create({common,settings}) { return {
        id:'third', name:'Third Radar', attribution:'Third', bounds:[-10,30,30,60],
        products(){ return module.exports.products },
        async latest(product){ return {product,time:'2026-08-18T00:00:00.000Z',epochMs:1787011200000,period:'PT10M',source:'third'} },
        async tile(){ return Buffer.from([137,80,78,71,13,10,26,10]) }
      } }
    }
  `)
  const adapters = discoverAdapters(dir)
  assert.ok(adapters.has('third'))
  assert.ok(knownProducts(adapters).third.MOSAIC)
  assert.deepEqual(defaultsFromAdapters(adapters).displayLayers, ['third:MOSAIC'])
  const providers = instantiateAdapters(adapters, ['third'], { requestTimeoutMs:1000 }, { third:{ endpoint:'x' } }, {})
  assert.equal(providers.get('third').id, 'third')
  await fs.rm(dir, { recursive:true, force:true })
})

test('generic core and Freeboard UI contain no bundled-provider special cases', async () => {
  const files = ['index.js','lib/provider-contract.js','lib/provider-registry.js','public/radar-panel.html','public/storm-widget.html']
  const text = (await Promise.all(files.map(f => fs.readFile(path.join(__dirname,'..',f),'utf8')))).join('\n')
  assert.doesNotMatch(text, /radar-dpc|Radar-DPC|protezionecivile|Deutscher Wetterdienst|maps\.dwd|\bdwd\b|RainViewer|rainviewer\.com|\brainviewer\b/i)
})

const { RainViewerProvider, normalizeMetadata, selectObservationFrame, frameForTime } = require('../lib/rainviewer-provider')

test('RainViewer metadata normalization handles hash-based native tile frames',()=>{
  const meta=normalizeMetadata({version:'2.0',generated:1787009135,host:'https://tilecache.rainviewer.com',radar:{past:[{time:1787008200,path:'/v2/radar/facef1f0535a'},{time:1787008800,path:'/v2/radar/c8001ca5ab55'}],nowcast:[{time:1787009400,path:'/v2/radar/futurehash'}]}})
  assert.equal(meta.past.length,2)
  assert.equal(meta.past[1].path,'/v2/radar/c8001ca5ab55')
  assert.equal(selectObservationFrame(meta,1787009000*1000,0).path,'/v2/radar/c8001ca5ab55')
  assert.equal(frameForTime(meta,'2026-08-18T00:40:00.000Z',1000),null)
})

test('RainViewer native XYZ provider satisfies generic contract and constructs tile request from XYZ', { concurrency:false }, async()=>{
  const oldFetch=global.fetch
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3])
  const metadata={version:'2.0',generated:1787009135,host:'https://tilecache.example',radar:{past:[{time:1787008200,path:'/v2/radar/hash-a'},{time:1787008800,path:'/v2/radar/hash-b'}],nowcast:[]}}
  const urls=[]
  global.fetch=async(url)=>{
    urls.push(String(url))
    if(String(url).includes('weather-maps.json')) return {ok:true,status:200,json:async()=>metadata,headers:{get:()=> 'application/json'}}
    return {ok:true,status:200,arrayBuffer:async()=>png,headers:{get:(k)=>k.toLowerCase()==='content-type'?'image/png':null}}
  }
  try {
    const p=assertProvider(new RainViewerProvider({metadataUrl:'https://api.example/weather-maps.json',requestTimeoutMs:1000,colorScheme:4,smooth:false,showSnow:true}))
    const d=describeProvider(p)
    assert.equal(d.products.COMPOSITE.capabilities.map,true)
    assert.equal(d.products.COMPOSITE.capabilities.raw,false)
    const latest=await p.latest('COMPOSITE')
    const tile=await p.tile('COMPOSITE',{z:6,x:33,y:23,bbox3857:[1,2,3,4]},latest.time)
    assert.deepEqual(tile,png)
    assert.match(urls.at(-1),/\/v2\/radar\/hash-b\/256\/6\/33\/23\/4\/0_1\.png$/)
  } finally { global.fetch=oldFetch }
})

test('bundled third provider is discovered without changing generic core',()=>{
  const adapters=discoverAdapters(path.join(__dirname,'..','providers'))
  assert.ok(adapters.has('radar-dpc'))
  assert.ok(adapters.has('dwd'))
  assert.ok(adapters.has('rainviewer'))
  const providers=instantiateAdapters(adapters,['rainviewer'],{requestTimeoutMs:1000},{rainviewer:{}},{})
  assert.equal(providers.get('rainviewer').id,'rainviewer')
  assert.equal(providers.get('rainviewer').products().COMPOSITE.maxZoom,7)
})

test('generic chart metadata honors provider product zoom limits',()=>{
  const {chartRecords}=makePlugin._test
  const provider={id:'native',name:'Native XYZ',products:()=>({MOSAIC:{title:'Mosaic',description:'Native tiles',kind:'raster',minZoom:0,maxZoom:7}}),latest(){},tile(){}}
  const row=chartRecords('signalk-storm-intelligence',provider,'MOSAIC',{minZoom:4,maxZoom:13,playbackEnabled:false,playbackSlots:1})[0][1]
  assert.equal(row.minzoom,4)
  assert.equal(row.maxzoom,7)
})

test('plugin can advertise WMS and native-XYZ providers simultaneously',async()=>{
  const ps=[]
  const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'radar-test-data-three'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const p=makePlugin(app)
  p.start({backgroundEnabled:false,displayLayers:['radar-dpc:VMI','dwd:RAIN_RATE','rainviewer:COMPOSITE']})
  const charts=await ps.find(x=>x.type==='charts').methods.listResources()
  assert.ok(charts['weather-radar-radar-dpc-vmi'])
  assert.ok(charts['weather-radar-dwd-rain-rate'])
  assert.ok(charts['weather-radar-rainviewer-composite'])
  assert.equal(charts['weather-radar-rainviewer-composite'].maxzoom,7)
  const wr=await ps.find(x=>x.type==='stormIntelligence').methods.listResources()
  assert.ok(wr['provider:radar-dpc']&&wr['provider:dwd']&&wr['provider:rainviewer'])
  p.stop()
})

test('generic lightning observations compute proximity trend and jump',()=>{
  const {lightningSummary}=require('../lib/lightning-engine')
  const now=Date.parse('2026-08-18T01:00:00Z')
  const strike=(min,lon=12.01)=>({id:String(min),time:new Date(now-min*60000).toISOString(),position:{latitude:40,longitude:lon}})
  const rows=[strike(1),strike(2),strike(3),strike(4),strike(6),strike(9)]
  const s=lightningSummary(rows,{latitude:40,longitude:12},now)
  assert.equal(s.count5min,4)
  assert.equal(s.count10min,6)
  assert.equal(s.jump.detected,true)
  assert.ok(s.nearestStrikeMeters>0)
})

test('future and invalid lightning observations fail closed',()=>{
  const {normalizeStrike,lightningSummary}=require('../lib/lightning-engine')
  const now=Date.parse('2026-08-18T01:00:00Z')
  const future={id:'future',time:'2026-08-18T01:01:00Z',position:{latitude:40,longitude:14}}
  const valid={id:'valid',time:'2026-08-18T00:59:00Z',position:{latitude:40,longitude:14}}
  assert.equal(lightningSummary([future,valid],{latitude:40,longitude:14},now).count30min,1)
  assert.equal(normalizeStrike({...valid,position:{latitude:91,longitude:14}}),null)
})

test('generic HTTP lightning adapter rejects malformed timestamps and coordinates',async()=>{
  const a=require('../observation-providers/http-json-lightning')
  const p=a.create({common:{requestTimeoutMs:1000},settings:{...a.defaults,endpoint:'https://example.invalid'}})
  const old=global.fetch
  global.fetch=async()=>({ok:true,status:200,json:async()=>[
    {id:'valid',time:'2026-08-18T00:59:00Z',latitude:40,longitude:14},
    {id:'bad-time',time:'not-a-time',latitude:40,longitude:14},
    {id:'bad-position',time:'2026-08-18T00:59:00Z',latitude:95,longitude:14}
  ]})
  try{const rows=await p.observations();assert.deepEqual(rows.map(row=>row.id),['valid'])}finally{global.fetch=old}
})

test('lightning evidence attaches to generic storm cells without provider coupling',()=>{
  const {attachLightning}=require('../lib/lightning-engine')
  const now=Date.parse('2026-08-18T01:00:00Z')
  const cell={id:'x',geometry:{type:'Polygon',coordinates:[[[12,40],[12.1,40],[12.1,40.1],[12,40.1],[12,40]]]},threat:{confidence:.5}}
  const strikes=[1,2,3].map(i=>({id:String(i),time:new Date(now-i*60000).toISOString(),position:{latitude:40.05,longitude:12.05}}))
  const out=attachLightning([cell],strikes,now)[0]
  assert.equal(out.lightning.countAssociated,3)
  assert.ok(out.threat.confidence>.5)
  assert.ok(out.threat.evidence.lightning)
})

test('onboard environmental fusion uses Signal K standard paths and trends',()=>{
  const {EnvironmentFusion}=require('../lib/environment-fusion')
  let vals={'environment.wind.speedTrue':5,'environment.wind.directionTrue':0,'environment.outside.temperature':298.15,'environment.outside.humidity':.55}
  const app={getSelfPath:p=>vals[p]}
  const e=new EnvironmentFusion({historyMinutes:30})
  e.sample(app,Date.parse('2026-08-18T00:30:00Z'))
  vals={'environment.wind.speedTrue':11,'environment.wind.directionTrue':Math.PI/3,'environment.outside.temperature':294.15,'environment.outside.humidity':.78}
  const c=e.sample(app,Date.parse('2026-08-18T01:00:00Z'))
  assert.equal(c.available,true)
  assert.ok(c.trends.windSpeedIncrease>0)
  assert.ok(c.trends.temperatureDrop>0)
  assert.ok(c.trends.relativeHumidityRise>0)
  assert.ok(c.evidenceScore>.5)
})

test('observation provider adapters are independently discoverable',()=>{
  const {discoverObservationAdapters,instantiateObservationAdapters}=require('../lib/observation-provider-registry')
  const adapters=discoverObservationAdapters(path.join(__dirname,'..','observation-providers'))
  assert.ok(adapters.has('http-json-lightning'))
  const ps=instantiateObservationAdapters(adapters,['http-json-lightning'],{requestTimeoutMs:1000},{'http-json-lightning':{endpoint:'https://example.invalid'}})
  assert.equal(ps.get('http-json-lightning').id,'http-json-lightning')
})


test('Blitzortung adapter validates second independent point-strike provider',async()=>{
 const a=require('../observation-providers/blitzortung-lightning'),p=a.create({common:{requestTimeoutMs:1000},settings:{...a.defaults,username:'u',password:'p'}}),old=global.fetch;let seen
 global.fetch=async(url,opt)=>{seen={url:String(url),auth:opt.headers.authorization};return{ok:true,status:200,text:async()=>JSON.stringify({time:'1787014800000000000',lat:40.8,lon:14.2,pol:-1,mds:1200})+'\n'}}
 try{const r=await p.observations({bounds:[13,40,15,42],since:'2026-08-18T00:00:00Z'});assert.equal(r.length,1);assert.equal(r[0].provider,'blitzortung-lightning');assert.equal(r[0].polarity,-1);assert.ok(seen.url.includes('west=13'));assert.ok(seen.auth.startsWith('Basic '))}finally{global.fetch=old}
})

test('observation contract accepts density-only providers',()=>{const {assertObservationProvider,describeObservationProvider}=require('../lib/observation-provider-contract');const p=assertObservationProvider({id:'density',name:'density',densityTile(){}});assert.equal(describeObservationProvider(p).capabilities.density,true);assert.equal(describeObservationProvider(p).capabilities.points,false)})

test('DPC LTG adapter exposes a density WMS tile without pretending point strikes',async()=>{const a=require('../observation-providers/dpc-ltg-density'),p=a.create({common:{requestTimeoutMs:1000},settings:a.defaults}),old=global.fetch;let url;global.fetch=async u=>{url=String(u);return{ok:true,status:200,headers:{get:()=> 'image/png'},arrayBuffer:async()=>Uint8Array.from([137,80,78,71]).buffer}};try{const b=await p.densityTile({bbox3857:[1,2,3,4],size:256,time:'2026-08-18T01:00:00Z'});assert.equal(b[0],137);assert.ok(url.includes('LAYERS=radar%3Altg'));assert.equal(p.capabilities.points,false);assert.equal(p.densityDescriptor().quantitative,false)}finally{global.fetch=old}})

test('observation registry discovers point and density lightning providers independently',()=>{const {discoverObservationAdapters}=require('../lib/observation-provider-registry');const a=discoverObservationAdapters(path.join(__dirname,'..','observation-providers'));assert.ok(a.has('http-json-lightning'));assert.ok(a.has('blitzortung-lightning'));assert.ok(a.has('dpc-ltg-density'))})

const { WeatherApiFusion, normalizeWeatherData, evidenceForCell, attachWeatherApiEvidence } = require('../lib/weather-api-fusion')

test('Signal K Weather API observations normalize standard weather fields and freshness',()=>{
  const now=Date.parse('2026-08-18T01:00:00Z')
  const o=normalizeWeatherData({date:'2026-08-18T00:55:00Z',type:'observation',description:'station observation',outside:{temperature:295.15,relativeHumidity:.82,pressure:100900,precipitationVolume:1.2},wind:{speedTrue:8,directionTrue:Math.PI,gust:13}}, {latitude:40,longitude:14}, now)
  assert.equal(o.values.temperature,295.15)
  assert.equal(o.values.windGust,13)
  assert.equal(o.ageSec,300)
  assert.deepEqual(o.queryPosition,{latitude:40,longitude:14})
})

test('Weather API fusion samples center and ring through app.weatherApi without provider coupling',async()=>{
  const calls=[]
  const app={weatherApi:{getObservations:async(pos,opts)=>{calls.push({pos,opts});return[{date:'2026-08-18T00:59:00Z',type:'observation',outside:{temperature:293.15,relativeHumidity:.7,pressure:101100},wind:{speedTrue:5,directionTrue:1}}]}}}
  const f=new WeatherApiFusion({radiusNm:20,bearings:4,maxCount:2,maxAgeMinutes:30})
  const c=await f.sample(app,{latitude:40,longitude:14},Date.parse('2026-08-18T01:00:00Z'))
  assert.equal(c.available,true)
  assert.equal(c.requestedCount,5)
  assert.equal(c.sampleCount,5)
  assert.equal(calls.length,5)
  assert.ok(calls.every(x=>x.opts.maxCount===2))
  assert.equal(c.method,'signalk-weather-api-location-sampling')
})

test('Weather API spatial evidence boosts an existing storm threat but never creates one',()=>{
  const context={available:true,vesselPosition:{latitude:40,longitude:14},center:{queryPosition:{latitude:40,longitude:14},values:{temperature:298,relativeHumidity:.6,pressure:101300,windSpeedTrue:4,windGust:6,windDirectionTrue:1}},samples:[{queryPosition:{latitude:40,longitude:14},values:{temperature:298,relativeHumidity:.6,pressure:101300,windSpeedTrue:4,windGust:6,windDirectionTrue:1}},{queryPosition:{latitude:40,longitude:13.5},values:{temperature:293,relativeHumidity:.85,pressure:100700,windSpeedTrue:12,windGust:18,windDirectionTrue:1.7,precipitationVolume:3}}]}
  const cell={centroid:[13.5,40],threat:{state:'warn',confidence:.5,evidence:{}}}
  const ev=evidenceForCell(cell,context)
  assert.equal(ev.available,true)
  assert.ok(ev.score>.5)
  const [boosted]=attachWeatherApiEvidence([cell],context,.15)
  assert.ok(boosted.threat.confidence>.5)
  const [noThreat]=attachWeatherApiEvidence([{centroid:[13.5,40]}],context,.15)
  assert.equal(noThreat.threat,undefined)
})

test('Weather API fusion rejects stale observations so they cannot corroborate threats',async()=>{
  const app={weatherApi:{getObservations:async()=>[{date:'2026-08-17T18:00:00Z',type:'observation',outside:{temperature:280},wind:{speedTrue:20}}]}}
  const f=new WeatherApiFusion({radiusNm:10,bearings:4,maxAgeMinutes:30})
  const c=await f.sample(app,{latitude:40,longitude:14},Date.parse('2026-08-18T01:00:00Z'))
  assert.equal(c.available,false)
  assert.equal(c.sampleCount,0)
})

test('inference algorithms are independently discoverable and can run together', async () => {
  const { discoverInferenceAlgorithms, instantiateInferenceAlgorithms } = require('../lib/inference-registry')
  const { InferenceEngine } = require('../lib/inference-engine')
  const defs=discoverInferenceAlgorithms()
  assert.ok(defs.has('kinematic-polygon'));assert.ok(defs.has('multisensor-evidence'))
  const algs=instantiateInferenceAlgorithms(defs,['kinematic-polygon','multisensor-evidence'],{}, {stormConfig:{warnDistanceM:50000,alarmDistanceM:10000}})
  const engine=new InferenceEngine(algs)
  const geometry={type:'Polygon',coordinates:[[[14,40],[14.1,40],[14.1,40.1],[14,40.1],[14,40]]]}
  const cells=await engine.infer({snapshot:{epochMs:Date.now(),features:[{id:'x',geometry,properties:{severity:4}}]},vessel:{position:{longitude:14.2,latitude:40.05},sog:0,cog:0},config:{lightningEnabled:false,onboardEnvironmentEnabled:false,weatherApiObservationsEnabled:false}})
  assert.equal(cells.length,1);assert.equal(engine.describe().algorithms.length,2)
})

test('inference registry accepts a synthetic third algorithm without core changes', async () => {
  const os=require('node:os'),fs=require('node:fs'),path=require('node:path')
  const { discoverInferenceAlgorithms, instantiateInferenceAlgorithms } = require('../lib/inference-registry')
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'storm-infer-'))
  fs.writeFileSync(path.join(dir,'third.js'),`module.exports={id:'third',name:'Third',create(){return{id:'third',name:'Third',infer(){return[]}}}}`)
  const defs=discoverInferenceAlgorithms(dir);assert.ok(defs.has('third'));assert.ok(instantiateInferenceAlgorithms(defs,['third']).has('third'))
})


test('v2 identity exposes stormIntelligence primary resource with deprecated weatherRadar alias', async()=>{
  const ps=[]
  const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'storm-intelligence-v2-identity'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const plugin=makePlugin(app)
  assert.equal(plugin.id,'signalk-storm-intelligence')
  assert.equal(plugin.name,'Storm Intelligence')
  assert.equal(plugin.version,'2.5.0')
  plugin.start({backgroundEnabled:false,displayLayers:['radar-dpc:VMI']})
  const primary=await ps.find(x=>x.type==='stormIntelligence').methods.listResources()
  const legacy=await ps.find(x=>x.type==='weatherRadar').methods.listResources()
  assert.ok(primary.status)
  assert.equal(legacy.status.deprecated,true)
  assert.equal(legacy.status.replacement,'stormIntelligence')
  plugin.stop()
})

test('v2 Freeboard extension and chart URLs use Storm Intelligence identity', async()=>{
  const ps=[]
  const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'storm-intelligence-v2-freeboard'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const plugin=makePlugin(app); plugin.start({backgroundEnabled:false,displayLayers:['radar-dpc:VMI']})
  const exts=await ps.find(x=>x.type==='plotterExtensions').methods.listResources()
  assert.equal(exts['signalk-storm-intelligence'].name,'Storm Intelligence')
  const charts=await ps.find(x=>x.type==='charts').methods.listResources()
  const radar=Object.values(charts).find(c=>c.provider==='radar-dpc'&&c.product==='VMI'&&c.stormIntelligence?.live)
  assert.ok(radar.url.startsWith('/stormintelligence/signalk-storm-intelligence/'))
  assert.equal(radar.weatherRadar.deprecated,true)
  plugin.stop()
})

test('multimodal DNN reference model is discoverable but disabled by default',()=>{
  const { discoverInferenceAlgorithms }=require('../lib/inference-registry')
  const defs=discoverInferenceAlgorithms()
  assert.ok(defs.has('multimodal-dnn'))
  assert.equal(defs.get('multimodal-dnn').defaults.enabled,false)
})

test('multimodal feature extractor produces fixed provider-agnostic feature schema',()=>{
  const {FEATURE_NAMES,extractMultimodalFeatures}=require('../lib/multimodal-features')
  const cell={trackId:'x',severity:4,geometry:{type:'Polygon',coordinates:[[[14,40],[14.1,40],[14.1,40.1],[14,40.1],[14,40]]]},distanceMeters:10000,motion:{speed:12,confidence:.8},pathThreat:{minDistanceMeters:5000,intersects:true,interceptSec:900,uncertaintyMeters:2000},cpa:{dcpaMeters:6000,closing:true},lightning:{count10min:20,ratePerMinute:2,jump:{detected:true},nearestStrikeMeters:4000,trend:'increasing',countAssociated:20}}
  const f=extractMultimodalFeatures(cell,{vessel:{position:{latitude:40,longitude:14}},config:{horizonMinutes:60},environmentContext:{available:true,evidenceScore:.6,trends:{windSpeedIncrease:4,windDirectionShift:.4,temperatureDrop:2,relativeHumidityRise:.1}},weatherApiContext:{available:false}})
  assert.equal(f.values.length,FEATURE_NAMES.length)
  assert.equal(FEATURE_NAMES.length,32)
  assert.equal(f.masks.radar,true);assert.equal(f.masks.lightning,true);assert.equal(f.masks.onboard,true);assert.equal(f.masks.vessel,true)
  assert.ok(f.modalityCompleteness>0 && f.modalityCompleteness<=1)
})

test('bundled pretrained DNN loads with immutable provenance and valid probabilities',()=>{
  const path=require('node:path');const {loadJsonModel,PretrainedDnn}=require('../lib/pretrained-dnn');const {FEATURE_NAMES}=require('../lib/multimodal-features')
  const bundle=loadJsonModel(path.join(__dirname,'..','models','stormfusion-reference-v1.json'));const dnn=new PretrainedDnn(bundle)
  const out=dnn.predict(Float32Array.from(FEATURE_NAMES,()=>0.5))
  assert.match(bundle.sha256,/^[0-9a-f]{64}$/);assert.ok(['normal','warn','alarm'].includes(out.state));assert.ok(Math.abs(Object.values(out.probabilities).reduce((a,b)=>a+b,0)-1)<1e-6)
  assert.equal(dnn.describe().training.kind,'synthetic-physically-informed')
})

test('multimodal DNN never invents a storm candidate and can score an existing one',()=>{
  const path=require('node:path');const def=require('../inference-algorithms/multimodal-dnn');const a=def.create({settings:{modelPath:path.join(__dirname,'..','models','stormfusion-reference-v1.json'),minimumConfidence:0}})
  assert.deepEqual(a.infer({baseCells:[],config:{}}),[])
  const geometry={type:'Polygon',coordinates:[[[14,40],[14.1,40],[14.1,40.1],[14,40.1],[14,40]]]}
  const rows=a.infer({baseCells:[{trackId:'storm-x',geometry,severity:5,distanceMeters:4000,motion:{speed:15,confidence:.9},pathThreat:{minDistanceMeters:1000,intersects:true,interceptSec:600,uncertaintyMeters:1000},cpa:{dcpaMeters:2000,closing:true}}],vessel:{position:{latitude:40,longitude:14}},config:{horizonMinutes:60},lightningStrikes:[],environmentContext:{available:false},weatherApiContext:{available:false},now:Date.now()})
  assert.equal(rows.length,1);assert.equal(rows[0].trackId,'storm-x');assert.equal(rows[0].threat.method,'multimodal-pretrained-dnn');assert.ok(rows[0].ml.model.sha256)
})

test('OpenAI-compatible client builds current Responses API structured-output request',()=>{
  const {OpenAICompatibleClient}=require('../lib/openai-compatible-client')
  const c=new OpenAICompatibleClient({model:'test-model',baseUrl:'https://example.invalid/v1',protocol:'responses',apiKeyEnv:'',fetch:async()=>{throw new Error('unused')}})
  const body=c.buildRequest({instructions:'system',input:'{}',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},schemaName:'x'})
  assert.equal(c.endpoint(),'https://example.invalid/v1/responses')
  assert.equal(body.model,'test-model');assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true)
})

test('OpenAI-compatible client parses Responses API structured output and provenance',async()=>{
  const {OpenAICompatibleClient}=require('../lib/openai-compatible-client')
  const fetch=async(url,opt)=>({ok:true,status:200,headers:{get:n=>n==='x-request-id'?'req-test':null},text:async()=>JSON.stringify({id:'resp-test',model:'served-model',usage:{input_tokens:10,output_tokens:5},output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]})})
  const c=new OpenAICompatibleClient({model:'requested-model',baseUrl:'https://example.invalid/v1',protocol:'responses',apiKeyEnv:'',fetch})
  const r=await c.structured({instructions:'x',input:'y',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},schemaName:'x'})
  assert.equal(r.data.ok,true);assert.equal(r.provenance.model,'served-model');assert.equal(r.provenance.responseId,'resp-test');assert.equal(r.provenance.requestId,'req-test');assert.match(r.provenance.requestFingerprint,/^[0-9a-f]{64}$/)
})

test('LLM inference adapter is discoverable, disabled by default, and never calls API without candidates',async()=>{
  const {discoverInferenceAlgorithms}=require('../lib/inference-registry');const defs=discoverInferenceAlgorithms();assert.ok(defs.has('llm-openai-compatible'));assert.equal(defs.get('llm-openai-compatible').defaults.enabled,false)
  let calls=0;const a=defs.get('llm-openai-compatible').create({settings:{model:'mock',baseUrl:'https://example.invalid/v1',apiKeyEnv:'',requireApiKey:false},common:{fetch:async()=>{calls++;throw new Error('must not call')}}})
  assert.deepEqual(await a.infer({baseCells:[],config:{}}),[]);assert.equal(calls,0);assert.equal(a.capabilities.detector,false)
})

test('LLM inference validates candidate ids and caps one-step escalation',async()=>{
  const def=require('../inference-algorithms/llm-openai-compatible')
  const fetch=async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({id:'r1',model:'mock-model',usage:{input_tokens:100,output_tokens:40},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({assessments:[{id:'storm-x',state:'alarm',confidence:.88,uncertainty:'medium',summary:'Converging evidence supports escalation.',factors:['path interception','radar severity']},{id:'invented',state:'alarm',confidence:1,uncertainty:'low',summary:'ignore',factors:[]}]})}]}]})})
  const a=def.create({settings:{model:'mock-model',baseUrl:'https://example.invalid/v1',apiKeyEnv:'',requireApiKey:false,minimumConfidence:.5,maxEscalationLevels:1},common:{fetch}})
  const geometry={type:'Polygon',coordinates:[[[14,40],[14.1,40],[14.1,40.1],[14,40.1],[14,40]]]}
  const rows=await a.infer({baseCells:[{trackId:'storm-x',geometry,severity:5,distanceMeters:5000,motion:{speed:14,confidence:.9},pathThreat:{minDistanceMeters:1200,intersects:true,interceptSec:800,uncertaintyMeters:1200},cpa:{dcpaMeters:2000,closing:true},threat:{state:'normal',confidence:.45,evidence:{}}}],vessel:{position:{latitude:40,longitude:14}},config:{horizonMinutes:60},lightningStrikes:[],environmentContext:{available:false},weatherApiContext:{available:false},now:Date.now()})
  assert.equal(rows.length,1);assert.equal(rows[0].trackId,'storm-x');assert.equal(rows[0].state,'warn');assert.equal(rows[0].llm.assessment.proposedState,'alarm');assert.equal(rows[0].llm.assessment.appliedState,'warn');assert.equal(rows[0].threat.method,'llm-openai-compatible');assert.equal(rows[0].threat.evidence.llm.model,'mock-model')
})

test('LLM inference requires API key by default but does not expose key in model description',async()=>{
  const def=require('../inference-algorithms/llm-openai-compatible');const old=process.env.STORM_TEST_LLM_KEY;delete process.env.STORM_TEST_LLM_KEY
  try{const a=def.create({settings:{model:'mock',apiKeyEnv:'STORM_TEST_LLM_KEY'},common:{fetch:async()=>{throw new Error('unused')}}});assert.equal(a.model.model,'mock');assert.equal(JSON.stringify(a.model).includes('STORM_TEST_LLM_KEY'),false);await assert.rejects(()=>a.infer({baseCells:[{trackId:'x'}],config:{}}),/STORM_TEST_LLM_KEY is not set/)}finally{if(old!==undefined)process.env.STORM_TEST_LLM_KEY=old}
})

test('OpenAI-compatible client supports Chat Completions structured-output fallback',async()=>{
  const {OpenAICompatibleClient}=require('../lib/openai-compatible-client');let seen
  const fetch=async(url,opt)=>{seen={url:String(url),body:JSON.parse(opt.body)};return{ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({id:'chat-1',model:'compat-model',choices:[{message:{content:'{"ok":true}'}}]})}}
  const c=new OpenAICompatibleClient({model:'compat-model',baseUrl:'http://local/v1',protocol:'chat-completions',apiKeyEnv:'',fetch,maxRetries:0})
  const r=await c.structured({instructions:'x',input:'y',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},schemaName:'x'})
  assert.equal(seen.url,'http://local/v1/chat/completions');assert.equal(seen.body.response_format.type,'json_schema');assert.equal(r.data.ok,true)
})

test('LLM algorithm can run after a primary detector in the same inference ensemble cycle',async()=>{
  const {InferenceEngine}=require('../lib/inference-engine');const def=require('../inference-algorithms/llm-openai-compatible')
  const fetch=async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({id:'ensemble-r',model:'mock',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({assessments:[{id:'cell-1',state:'alarm',confidence:.8,uncertainty:'medium',summary:'Escalated by combined evidence.',factors:['interception']}]})}]}]})})
  const primary={id:'primary',name:'Primary',weight:1,infer(){return[{trackId:'cell-1',severity:4,geometry:{type:'Polygon',coordinates:[[[14,40],[14.1,40],[14.1,40.1],[14,40.1],[14,40]]]},threat:{state:'warn',confidence:.6,evidence:{}},state:'warn'}]}}
  const llm=def.create({settings:{model:'mock',baseUrl:'https://example.invalid/v1',apiKeyEnv:'',requireApiKey:false,minimumConfidence:0,maxEscalationLevels:1},common:{fetch}})
  const engine=new InferenceEngine(new Map([['primary',primary],['llm-openai-compatible',llm]]),{strategy:'max-severity'})
  const rows=await engine.infer({config:{horizonMinutes:60},vessel:{position:{latitude:40,longitude:14}},environmentContext:{available:false},weatherApiContext:{available:false},lightningStrikes:[],now:Date.now()})
  assert.equal(rows.length,1);assert.equal(rows[0].state,'alarm');assert.equal(rows[0].threat.evidence.algorithms['llm-openai-compatible'].state,'alarm');assert.equal(engine.describe().lastRuns.every(x=>x.ok),true)
})


test('package exposes companion Signal K webapp and dashboard is strictly read only',()=>{
  const pkg=require('../package.json');assert.ok(pkg.keywords.includes('signalk-webapp'));assert.equal(pkg.signalk.displayName,'Storm Intelligence')
  const fss=require('node:fs');const html=fss.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');const js=fss.readFileSync(path.join(__dirname,'..','public','dashboard.js'),'utf8')
  assert.match(html,/Read-only operational monitor/i);assert.match(js,/\/plugins\/signalk-storm-intelligence\/operational/)
  assert.doesNotMatch(js,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);assert.doesNotMatch(html,/<form\b/i)
})

test('package exposes current Signal K App Store metadata and published assets',()=>{
  const pkg=require('../package.json'),fss=require('node:fs')
  assert.ok(pkg.keywords.includes('signalk-node-server-plugin'))
  assert.ok(pkg.keywords.includes('signalk-webapp'))
  assert.ok(pkg.keywords.includes('signalk-category-weather'))
  assert.ok(pkg.keywords.includes('signalk-category-chart-plotters'))
  assert.equal(pkg.signalk.displayName,'Storm Intelligence')
  assert.ok(pkg.signalk.appIcon.endsWith('.svg'))
  assert.equal(pkg.signalk.screenshots.length,1)
  for(const asset of [pkg.signalk.appIcon,...pkg.signalk.screenshots])assert.ok(fss.existsSync(path.join(__dirname,'..',asset)))
  assert.equal(pkg.scripts.preinstall,undefined)
  assert.equal(pkg.scripts.install,undefined)
  assert.equal(pkg.scripts.postinstall,undefined)
})

test('operational route is registered through readonly router and returns component health',async()=>{
  const ps=[];const routes={};let accessMode=null
  const app={registerResourceProvider:p=>ps.push(p),getDataDirPath:()=>path.join(os.tmpdir(),'storm-operational-webapp'),setPluginStatus(){},debug(){},error(){},handleMessage(){},getSelfPath(){return null}}
  const plugin=makePlugin(app);plugin.start({backgroundEnabled:false,displayLayers:[],stormEnabled:false,lightningEnabled:false,onboardEnvironmentEnabled:false,weatherApiObservationsEnabled:false,inferenceAlgorithms:[]})
  const readonly={get:(route,handler)=>{routes[route]=handler},post:(route,handler)=>{routes['POST '+route]=handler}}
  plugin.registerWithRouter({access:mode=>{accessMode=mode;return readonly}})
  assert.equal(accessMode,'readonly');assert.equal(typeof routes['/operational'],'function')
  let payload,statusCode=200;const res={json:x=>{payload=x;return res},status:n=>{statusCode=n;return res},set(){return res},send(){return res}}
  await routes['/operational']({},res)
  assert.equal(statusCode,200);assert.equal(payload.readOnly,true);assert.ok(Array.isArray(payload.components));assert.ok(Array.isArray(payload.approachingCells));assert.equal(payload.runtime.version,'2.5.0');assert.match(payload.semantics.risk,/not a probability/i)
  plugin.stop()
})

test('inference registry rejects duplicate algorithm ids instead of silently overwriting', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'storm-inference-duplicates-'))
  try{
    const moduleText="module.exports={id:'duplicate',name:'Duplicate',create(){return{id:'duplicate',name:'Duplicate',infer(){return[]}}}}\n"
    await fs.writeFile(path.join(dir,'a.js'),moduleText)
    await fs.writeFile(path.join(dir,'b.js'),moduleText)
    const {discoverInferenceAlgorithms}=require('../lib/inference-registry')
    assert.throws(()=>discoverInferenceAlgorithms(dir),/Duplicate inference algorithm id/)
  }finally{
    await fs.rm(dir,{recursive:true,force:true})
  }
})

test('inference and observation registries reject runtime ids that differ from adapter definitions',()=>{
  const {instantiateInferenceAlgorithms}=require('../lib/inference-registry')
  const inferenceDefs=new Map([['declared',{id:'declared',create(){return{id:'different',name:'Different',infer(){return[]}}}}]])
  assert.throws(()=>instantiateInferenceAlgorithms(inferenceDefs,['declared']),/mismatched id/)

  const {instantiateObservationAdapters}=require('../lib/observation-provider-registry')
  const observationDefs=new Map([['declared',{id:'declared',create(){return{id:'different',name:'Different',observations:async()=>[]}}}]])
  assert.throws(()=>instantiateObservationAdapters(observationDefs,['declared'],{},{}),/mismatched id/)
})
