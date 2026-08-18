'use strict'
function buildWmsUrl(settings,q={}){const b=q.bbox3857;if(!Array.isArray(b)||b.length!==4)throw new Error('DPC LTG requires bbox3857');const u=new URL(settings.wmsBase);for(const[k,v]of Object.entries({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',LAYERS:settings.layer,STYLES:'',SRS:'EPSG:3857',BBOX:b.join(','),WIDTH:String(q.size||256),HEIGHT:String(q.size||256),FORMAT:'image/png',TRANSPARENT:'true',TILED:'true'}))u.searchParams.set(k,v);if(q.time)u.searchParams.set('TIME',new Date(q.time).toISOString());return u.toString()}
module.exports={
 id:'dpc-ltg-density',name:'Radar-DPC LTG Lightning Frequency',recommended:{enabled:false},
 defaults:{wmsBase:'https://radar-geowebcache.protezionecivile.it/service/wms',layer:'radar:ltg',origin:'https://radar.protezionecivile.it'},
 settingsSchema:{properties:{wmsBase:{type:'string',title:'DPC/compatible LTG WMS endpoint'},layer:{type:'string',title:'LTG WMS layer'},origin:{type:'string',title:'Origin header when required'}}},
 create({common,settings}){return{
   id:module.exports.id,name:module.exports.name,attribution:'Radar-DPC / Dipartimento della Protezione Civile',types:['lightning'],capabilities:{density:true,map:true,temporal:true,points:false,quantitativeSamples:false},
   async densityTile(q={}){const url=buildWmsUrl(settings,q),ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),common.requestTimeoutMs||10000);let r;try{r=await fetch(url,{headers:settings.origin?{origin:settings.origin}:{},signal:ctl.signal})}finally{clearTimeout(tm)}if(!r.ok)throw new Error('DPC LTG WMS HTTP '+r.status);const ct=String(r.headers?.get?.('content-type')||'');if(!ct.includes('image/png'))throw new Error('DPC LTG upstream did not return PNG');return Buffer.from(await r.arrayBuffer())},
   densityDescriptor(){return{kind:'density',phenomenon:'lightning',title:'LTG absolute lightning-frequency map',period:'PT10M',units:null,quantitative:false,note:'Radar-DPC documents LTG as an absolute lightning-frequency estimate from LAMPINET; pixel-value semantics are not assumed by this adapter.'}}
 }}
}
module.exports._test={buildWmsUrl}
