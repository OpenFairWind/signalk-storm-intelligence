'use strict'
const { USER_AGENT } = require('./version')
const { parseHrdZip } = require('./hrd-parser')

const PRODUCTS=Object.freeze({
  VMI:{raw:true,layer:'radar:vmi',title:'Radar-DPC VMI',description:'Vertical Maximum Intensity radar reflectivity mosaic',kind:'raster',units:'dBZ',period:'PT5M'},
  SRI:{raw:true,layer:'radar:sri',title:'Radar-DPC SRI',description:'Surface Rainfall Intensity mosaic',kind:'raster',units:'mm/h',period:'PT5M'},
  VIL:{raw:true,layer:'radar:vil',title:'Radar-DPC VIL',description:'Vertically Integrated Liquid water',kind:'raster'},
  POH:{raw:true,layer:'radar:poh',title:'Radar-DPC POH',description:'Probability of Hail',kind:'raster'},
  ETM:{raw:true,layer:'radar:etm',title:'Radar-DPC ETM',description:'Echo Top Maximum',kind:'raster'},
  SRT1:{raw:true,layer:'radar:srt1',title:'Radar-DPC SRT1',description:'One-hour accumulated precipitation',kind:'raster'},
  CUM3:{raw:true,layer:'radar:cum3',title:'Radar-DPC CUM3',description:'3-hour accumulated precipitation',kind:'raster'},
  CUM6:{raw:true,layer:'radar:cum6',title:'Radar-DPC CUM6',description:'6-hour accumulated precipitation',kind:'raster'},
  CUM12:{raw:true,layer:'radar:cum12',title:'Radar-DPC CUM12',description:'12-hour accumulated precipitation',kind:'raster'},
  CUM24:{raw:true,layer:'radar:cum24',title:'Radar-DPC CUM24',description:'24-hour accumulated precipitation',kind:'raster'},
  HRD:{layer:'radar:hrd',title:'Radar-DPC HRD',description:'Heavy Rain Detection severe-weather cells',kind:'vector',period:'PT5M',map:false,raw:true,cells:true,temporal:true}
})
const PRODUCT_API_PATH='/wide/product'
function timeoutSignal(ms){ return AbortSignal.timeout ? AbortSignal.timeout(ms) : (()=>{const c=new AbortController();setTimeout(()=>c.abort(),ms).unref?.();return c.signal})() }
class DpcProvider {
  constructor(cfg={}){ this.id='radar-dpc'; this.name='Italian Civil Protection Radar-DPC'; this.attribution='Radar-DPC - Dipartimento della Protezione Civile'; this.bounds=[4.53700051775303,35.0768620138162,20.4367624666779,47.8560958107746]; this.cfg=cfg }
  products(){ return PRODUCTS }
  async latest(product){
    const u=new URL(`${PRODUCT_API_PATH}/findLastProductByType`,this.cfg.dpcApiBase);u.searchParams.set('type',product)
    const r=await fetch(u,{headers:{accept:'application/json',origin:this.cfg.dpcOrigin,referer:`${this.cfg.dpcOrigin}/`,'user-agent':USER_AGENT},signal:timeoutSignal(this.cfg.requestTimeoutMs)})
    if(!r.ok) throw new Error(`Radar-DPC API HTTP ${r.status}`); const d=await r.json(); const lp=d?.lastProducts?.[0]; if(!lp) throw new Error(`No ${product} product available`)
    return {product:lp.productType||product,time:new Date(lp.time).toISOString(),epochMs:Number(lp.time),period:lp.period||null,source:this.id}
  }
  wmsUrl(product,bbox,time){
    const m=PRODUCTS[product]; if(!m) throw new Error(`Unsupported product ${product}`)
    const u=new URL(this.cfg.dpcWmsBase); for(const [k,v] of Object.entries({service:'WMS',version:'1.1.1',request:'GetMap',layers:m.layer,styles:'',format:'image/png',transparent:'true',tiled:'true',width:'256',height:'256',srs:'EPSG:3857',bbox:bbox.join(',')}))u.searchParams.set(k,v); if(time)u.searchParams.set('time',time); return u.toString()
  }
  async tile(product,tileRequest,time){ const bbox=Array.isArray(tileRequest)?tileRequest:tileRequest?.bbox3857; if(!Array.isArray(bbox))throw new Error('Radar-DPC requires bbox3857 in tile request'); const r=await fetch(this.wmsUrl(product,bbox,time),{headers:{accept:'image/png,image/*;q=0.8','user-agent':USER_AGENT},signal:timeoutSignal(this.cfg.requestTimeoutMs)}); if(!r.ok)throw new Error(`Radar-DPC WMS HTTP ${r.status}`); const ct=r.headers.get('content-type')||''; if(!ct.includes('image/png'))throw new Error(`Radar-DPC WMS returned ${ct}`); return Buffer.from(await r.arrayBuffer()) }
  async downloadRaw(product,epochMs){
    const u=new URL(`${PRODUCT_API_PATH}/downloadProduct`,this.cfg.dpcApiBase)
    const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json',accept:'application/json',origin:this.cfg.dpcOrigin,referer:`${this.cfg.dpcOrigin}/`,'user-agent':USER_AGENT},body:JSON.stringify({productType:product,productDate:Number(epochMs)}),signal:timeoutSignal(this.cfg.requestTimeoutMs)})
    if(!r.ok)throw new Error(`Radar-DPC download API HTTP ${r.status}`); const d=await r.json(); if(!d.url)throw new Error('Radar-DPC download API returned no URL')
    const f=await fetch(d.url,{signal:timeoutSignal(Math.max(this.cfg.requestTimeoutMs,30000))}); if(!f.ok)throw new Error(`Radar-DPC raw download HTTP ${f.status}`)
    return {buffer:Buffer.from(await f.arrayBuffer()),key:d.key||'',contentType:f.headers.get('content-type')||''}
  }
  rawExtension(product,key=''){ if(product==='HRD'||/\.zip$/i.test(key))return '.zip'; if(/\.tiff?$/i.test(key)||PRODUCTS[product]?.kind==='raster')return '.tif'; return '.bin' }
  async cellsFromRaw(product,buffer){ if(product!=='HRD')return []; return parseHrdZip(buffer) }
}
module.exports={DpcProvider,PRODUCTS}
