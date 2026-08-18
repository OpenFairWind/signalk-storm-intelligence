'use strict'
function epochNsToIso(v){try{const ns=BigInt(String(v));return new Date(Number(ns/1000000n)).toISOString()}catch{return null}}
module.exports={
  id:'blitzortung-lightning',name:'Blitzortung.org Lightning',recommended:{enabled:false},
  defaults:{baseUrl:'https://data.blitzortung.org/Data/Protected/last_strikes.php',username:'',password:'',maxResults:2000},
  settingsSchema:{properties:{baseUrl:{type:'string',title:'Blitzortung last_strikes.php endpoint'},username:{type:'string'},password:{type:'string'},maxResults:{type:'integer',minimum:1,maximum:100000,title:'Maximum strikes per query'}}},
  create({common,settings}){return{
    id:module.exports.id,name:module.exports.name,attribution:'Blitzortung.org',types:['lightning'],capabilities:{points:true,polarity:true,authenticated:true},
    async observations(q={}){
      if(!settings.username||!settings.password)throw new Error('Blitzortung username/password are not configured')
      const b=q.bounds||[-180,-90,180,90],u=new URL(settings.baseUrl);u.searchParams.set('number',String(Math.max(1,Math.min(100000,Number(settings.maxResults)||2000))));u.searchParams.set('west',String(b[0]));u.searchParams.set('east',String(b[2]));u.searchParams.set('north',String(b[3]));u.searchParams.set('south',String(b[1]));u.searchParams.set('sig','0')
      if(q.since){const ms=new Date(q.since).getTime();if(Number.isFinite(ms))u.searchParams.set('time',(BigInt(Math.floor(ms))*1000000n).toString())}
      const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),common.requestTimeoutMs||10000);let r;try{r=await fetch(u,{headers:{authorization:'Basic '+Buffer.from(settings.username+':'+settings.password).toString('base64')},signal:ctl.signal})}finally{clearTimeout(tm)}
      if(!r.ok)throw new Error('Blitzortung HTTP '+r.status);const text=await r.text(),out=[]
      for(const line of text.split(/\r?\n/)){if(!line.trim())continue;let row;try{row=JSON.parse(line)}catch{continue}const lat=Number(row.lat),lon=Number(row.lon),time=epochNsToIso(row.time);if(!Number.isFinite(lat)||!Number.isFinite(lon)||!time)continue;out.push({id:String(row.id??row.time+'-'+lat+'-'+lon),type:'lightning',time,position:{latitude:lat,longitude:lon},polarity:Number.isFinite(Number(row.pol))?Number(row.pol):null,provider:module.exports.id,quality:{maxDeviationSpanNs:Number.isFinite(Number(row.mds))?Number(row.mds):null,maxCircularGapDeg:Number.isFinite(Number(row.mcg))?Number(row.mcg):null},raw:row})}
      return out
    }
  }}
}
module.exports._test={epochNsToIso}
