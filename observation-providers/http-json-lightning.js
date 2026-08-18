'use strict'
function dig(v,path){return String(path||'').split('.').filter(Boolean).reduce((o,k)=>o?.[k],v)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
module.exports={
  id:'http-json-lightning',
  name:'Generic HTTP JSON Lightning',
  recommended:{enabled:false},
  defaults:{endpoint:'',arrayPath:'',latitudeField:'latitude',longitudeField:'longitude',timeField:'time',polarityField:'polarity',amplitudeField:'amplitude',headersJson:'{}'},
  settingsSchema:{properties:{endpoint:{type:'string',title:'Endpoint URL template ({west},{south},{east},{north},{since},{until})'},arrayPath:{type:'string'},latitudeField:{type:'string'},longitudeField:{type:'string'},timeField:{type:'string'},polarityField:{type:'string'},amplitudeField:{type:'string'},headersJson:{type:'string',title:'HTTP headers as JSON'}}},
  create({common,settings}){
    return {
      id:module.exports.id,name:module.exports.name,attribution:'Configured lightning data source',types:['lightning'],capabilities:{points:true},
      async observations(q={}){
        if(!settings.endpoint)throw new Error('Generic lightning endpoint is not configured')
        const b=q.bounds||[-180,-90,180,90], repl={west:b[0],south:b[1],east:b[2],north:b[3],since:q.since||'',until:q.until||''}
        let url=settings.endpoint
        for(const[k,v]of Object.entries(repl))url=url.replaceAll(`{${k}}`,encodeURIComponent(v))
        let headers={}; try{headers=JSON.parse(settings.headersJson||'{}')}catch{}
        const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),common.requestTimeoutMs||10000)
        let r; try{r=await fetch(url,{headers,signal:ctl.signal})}finally{clearTimeout(tm)}
        if(!r.ok)throw new Error(`Lightning HTTP ${r.status}`)
        const json=await r.json(), rows=settings.arrayPath?dig(json,settings.arrayPath):json
        if(!Array.isArray(rows))throw new Error('Lightning JSON array not found')
        return rows.map((row,i)=>{
          const lat=num(dig(row,settings.latitudeField)),lon=num(dig(row,settings.longitudeField)); if(lat==null||lon==null||lat < -90||lat > 90||lon < -180||lon > 180)return null
          const rawTime=dig(row,settings.timeField),d=new Date(rawTime)
          if(Number.isNaN(d.getTime()))return null
          return{id:String(row.id??`${d.getTime()}-${i}`),type:'lightning',time:d.toISOString(),position:{latitude:lat,longitude:lon},polarity:num(dig(row,settings.polarityField)),amplitude:num(dig(row,settings.amplitudeField)),provider:module.exports.id,raw:row}
        }).filter(Boolean)
      }
    }
  }
}
