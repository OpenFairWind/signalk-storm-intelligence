'use strict'

const { renderLightningTile } = require('../lib/lightning-overlay')

function timeoutSignal(ms){return AbortSignal.timeout?AbortSignal.timeout(ms):(()=>{const c=new AbortController();setTimeout(()=>c.abort(),ms).unref?.();return c.signal})()}

function parseLgtBinary(buffer,frameTime){
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer||[])
  if(bytes.length<3||bytes.readUInt8(0)!==2)throw new Error('Radar-DPC LGT binary has an invalid header')
  const count=bytes.readUInt16BE(1),out=[]
  let offset=3
  for(let index=0;index<count;index++){
    if(offset+6>bytes.length)throw new Error('Radar-DPC LGT binary is truncated')
    const lonLow=bytes.readUInt16BE(offset),latLow=bytes.readUInt16BE(offset+2),high=bytes.readUInt8(offset+4),ageCode=bytes.readUInt8(offset+5)
    const longitudeRaw=lonLow+((high>>6)&3)*65536,latitudeRaw=latLow+((high>>4)&3)*65536
    const longitude=longitudeRaw*(360/262144)-180,latitude=latitudeRaw*(180/262144)-90
    let recordLength=6
    if(ageCode===255){if(offset+8>bytes.length)throw new Error('Radar-DPC LGT binary is truncated');recordLength=8}
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude < -180||longitude > 180||latitude < -90||latitude > 90)throw new Error('Radar-DPC LGT binary contains invalid coordinates')
    out.push({id:`${frameTime}:${index}:${longitudeRaw}:${latitudeRaw}`,type:'lightning',time:new Date(frameTime).toISOString(),position:{longitude,latitude},provider:'dpc-ltg-density'})
    offset+=recordLength
  }
  if(offset!==bytes.length)throw new Error('Radar-DPC LGT binary has trailing data')
  return out
}

async function fetchResponse(url,settings,common,accept){
  const headers={accept}
  if(settings.origin){headers.origin=settings.origin;headers.referer=`${settings.origin.replace(/\/?$/,'/')}`}
  return fetch(url,{headers,signal:timeoutSignal(common.requestTimeoutMs||10000)})
}

async function latestFrame(settings,common){
  const url=new URL('/findLastProductByType',settings.apiBase);url.searchParams.set('type','VMI');url.searchParams.set('lang','it')
  const response=await fetchResponse(url,settings,common,'application/json')
  if(!response.ok)throw new Error(`Radar-DPC latest-product API HTTP ${response.status}`)
  const body=await response.json(),epochMs=Number(body?.lastProducts?.[0]?.time)
  if(!Number.isFinite(epochMs))throw new Error('Radar-DPC latest-product API returned no valid frame')
  return epochMs
}

function lgtUrl(base,epochMs){return new URL(`LGT/lgt_5min_${Number(epochMs)}.bin`,`${base.replace(/\/?$/,'/')}`).toString()}

module.exports={
 id:'dpc-ltg-density',name:'Radar-DPC v2 Lightning Event Map',recommended:{enabled:false},
 defaults:{apiBase:'https://radar-api.protezionecivile.it',binaryBase:'https://s3-prod-dpc-radar-webp-cache.s3.eu-south-1.amazonaws.com',origin:'https://radar.protezionecivile.it'},
 settingsSchema:{properties:{apiBase:{type:'string',title:'Radar-DPC latest-product API endpoint'},binaryBase:{type:'string',title:'Radar-DPC v2 LGT binary endpoint'},origin:{type:'string',title:'Origin header required by the Radar-DPC API'}}},
 create({common,settings}){return{
   id:module.exports.id,name:module.exports.name,attribution:'Radar-DPC / Dipartimento della Protezione Civile',types:['lightning'],capabilities:{density:true,map:true,temporal:true,points:false,quantitativeSamples:false},
   async densityTile(q={}){
     const explicit=q.time!=null,requested=explicit?new Date(q.time).getTime():await latestFrame(settings,common)
     if(!Number.isFinite(requested))throw new Error('Radar-DPC LGT requires a valid frame time')
     const attempts=explicit?1:13
     for(let lag=0;lag<attempts;lag++){
       const frame=requested-lag*300000,response=await fetchResponse(lgtUrl(settings.binaryBase,frame),settings,common,'application/octet-stream')
       if(response.status===403||response.status===404)continue
       if(!response.ok)throw new Error(`Radar-DPC LGT binary HTTP ${response.status}`)
       const contentType=String(response.headers?.get?.('content-type')||'')
       if(contentType&&!contentType.includes('octet-stream')&&!contentType.includes('binary'))throw new Error(`Radar-DPC LGT binary returned ${contentType}`)
       const events=parseLgtBinary(Buffer.from(await response.arrayBuffer()),frame)
       return renderLightningTile(events,q.z,q.x,q.y,frame)
     }
     return renderLightningTile([],q.z,q.x,q.y,requested)
   },
   densityDescriptor(){return{kind:'event-map',phenomenon:'lightning',title:'Radar-DPC v2 LGT frame events',period:'PT10M',units:null,quantitative:false,note:'The upstream v2 binary exposes event coordinates for a frame but no documented per-event timestamp semantics. The adapter renders the frame directly and does not expose fabricated point observations to inference.'}}
 }}
}
module.exports._test={parseLgtBinary,lgtUrl,latestFrame}
