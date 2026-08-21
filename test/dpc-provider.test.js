'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { DpcProvider } = require('../lib/dpc-provider')
const { parseHrdBinary } = require('../lib/hrd-parser')
const { sourceTile, v2TileUrl, renderRgba, encodePng, colorFor } = require('../lib/dpc-v2-raster')

function provider() {
  return new DpcProvider({
    dpcApiBase: 'https://radar-api.protezionecivile.it',
    dpcWebpTileBase: 'https://tiles.example',
    dpcHrdBinaryBase: 'https://hrd.example',
    dpcOrigin: 'https://radar.protezionecivile.it',
    requestTimeoutMs: 1000
  })
}

test('Radar-DPC v2 URL uses the immutable UTC frame and provider-native XYZ hierarchy',()=>{
  const direct=v2TileUrl('https://tiles.example','VMI','2026-08-21T06:20:00.000Z',{z:6,x:33,y:23})
  assert.equal(direct.url,'https://tiles.example/VMI/2026/08/21/0620/6/33/23/vmi.webp')
  assert.deepEqual(direct.tile,{z:6,x:33,y:23,scale:1,offsetX:0,offsetY:0})
  const overzoom=v2TileUrl('https://tiles.example','SRI','2026-08-21T06:24:59.000Z',{z:9,x:269,y:186})
  assert.equal(overzoom.url,'https://tiles.example/SRI/2026/08/21/0620/7/67/46/sri.webp')
  assert.deepEqual(overzoom.tile,{z:7,x:67,y:46,scale:4,offsetX:1,offsetY:2})
  assert.throws(()=>v2TileUrl('https://tiles.example','VMI','invalid',{z:7,x:67,y:46}),/valid UTC frame time/)
})

test('Radar-DPC v2 colourization produces deterministic transparent PNG-compatible RGBA',()=>{
  const image={width:256,height:256,data:new Uint8Array(256*256*4)}
  image.data.fill(255)
  const rgba=renderRgba('VMI',image,sourceTile(7,67,46))
  assert.equal(rgba.length,256*256*4)
  assert.deepEqual([...rgba.slice(0,4)],[255,67,0,204])
  const png=encodePng(256,256,rgba)
  assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10])
  assert.equal(png.readUInt32BE(16),256)
  assert.equal(png.readUInt32BE(20),256)
  assert.deepEqual(colorFor('SRI',0).slice(3),[0])
})

test('Radar-DPC v2 rejects malformed coordinates at the provider boundary',()=>{
  assert.throws(()=>sourceTile(7,-1,46),/non-negative integer XYZ/)
  assert.throws(()=>sourceTile(7,67.5,46),/non-negative integer XYZ/)
})

function response(overrides={}) {
  return {ok:true,status:200,headers:{get:()=> 'application/octet-stream'},...overrides}
}

test('Radar-DPC raster lookup follows the current root API route', async () => {
  const oldFetch=global.fetch
  let request
  global.fetch=async(url,options)=>{
    request={url:String(url),options}
    return response({json:async()=>({lastProducts:[{productType:'VMI',time:1787082000000,period:'PT5M'}]})})
  }
  try{
    const latest=await provider().latest('VMI')
    assert.equal(request.url,'https://radar-api.protezionecivile.it/findLastProductByType?type=VMI&lang=it')
    assert.equal(request.options.headers.origin,'https://radar.protezionecivile.it')
    assert.equal(latest.epochMs,1787082000000)
  }finally{global.fetch=oldFetch}
})

test('Radar-DPC HRD discovery verifies a bounded delayed binary frame', async () => {
  const oldFetch=global.fetch
  const requests=[]
  global.fetch=async(url,options={})=>{
    requests.push({url:String(url),options})
    if(requests.length===1)return response({json:async()=>({lastProducts:[{productType:'VMI',time:1787082000000,period:'PT5M'}]})})
    if(requests.length===2)return response({ok:false,status:403})
    return response()
  }
  try{
    const latest=await provider().latest('HRD')
    assert.equal(requests[1].url,'https://hrd.example/HRD/hrd_5min_1787082000000.bin')
    assert.equal(requests[1].options.method,'HEAD')
    assert.equal(requests[2].url,'https://hrd.example/HRD/hrd_5min_1787081700000.bin')
    assert.equal(latest.epochMs,1787081700000)
    assert.equal(latest.product,'HRD')
  }finally{global.fetch=oldFetch}
})

test('Radar-DPC HRD download preserves the exact verified binary object', async () => {
  const oldFetch=global.fetch
  let request
  global.fetch=async(url,options={})=>{
    request={url:String(url),options}
    return response({arrayBuffer:async()=>Uint8Array.from([72,1,0,0]).buffer})
  }
  try{
    const result=await provider().downloadRaw('HRD',1787081700000)
    assert.equal(request.url,'https://hrd.example/HRD/hrd_5min_1787081700000.bin')
    assert.equal(result.key,'hrd_5min_1787081700000.bin')
    assert.deepEqual([...result.buffer],[72,1,0,0])
  }finally{global.fetch=oldFetch}
})

test('Radar-DPC binary parser validates and normalizes polygon attributes and coordinates',()=>{
  const parts=[]
  const u8=value=>{const b=Buffer.alloc(1);b.writeUInt8(value);parts.push(b)}
  const u16=value=>{const b=Buffer.alloc(2);b.writeUInt16BE(value);parts.push(b)}
  const i16=value=>{const b=Buffer.alloc(2);b.writeInt16BE(value);parts.push(b)}
  const i32=value=>{const b=Buffer.alloc(4);b.writeInt32BE(value);parts.push(b)}
  u8(72);u8(1);u16(1)
  u8(1);u16((1<<2)|(1<<3));i32(139810);i32(189326);i32(139900);i32(189400)
  u16(450);u16(3250)
  u16(4);i16(0);i16(0);i16(8);i16(0);i16(0);i16(8);i16(-8);i16(-8)
  const features=parseHrdBinary(Buffer.concat(parts))
  assert.equal(features.length,1)
  assert.deepEqual(features[0].properties,{HRI:4.5,VMI:32.5})
  assert.equal(features[0].geometry.type,'Polygon')
  assert.equal(features[0].geometry.coordinates[0].length,4)
  assert.ok(features[0].geometry.coordinates[0].every(([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat)))
})

test('Radar-DPC binary parser rejects truncated data',()=>{
  assert.throws(()=>parseHrdBinary(Buffer.from([72,1,0,1])),/truncated/)
})
