'use strict'
const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI
function angleDiffRad(a,b){if(!Number.isFinite(a)||!Number.isFinite(b))return null;let d=a-b;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d}
class EnvironmentFusion{
 constructor({historyMinutes=30,maxAgeSec=180}={}){this.historyMinutes=historyMinutes;this.maxAgeSec=maxAgeSec;this.history=[]}
 sample(app,now=Date.now()){
  const read=p=>{
   const raw=app.getSelfPath?.(p),wrapped=raw&&typeof raw==='object'&&Object.hasOwn(raw,'value')
   const value=wrapped?raw.value:raw
   const timestamp=(wrapped&&(raw.timestamp||raw.time||raw.observedAt))||app.getSelfPathTimestamp?.(p)||null
   const epochMs=timestamp==null?NaN:new Date(timestamp).getTime(),ageMs=now-epochMs
   const fresh=Number.isFinite(epochMs)&&ageMs>=0&&(this.maxAgeSec<=0||ageMs<=this.maxAgeSec*1000)
   const number=Number(value)
   return {value:Number.isFinite(number)&&fresh?number:null,sourceTimestamp:Number.isFinite(epochMs)?new Date(epochMs).toISOString():null,ageMs:Number.isFinite(ageMs)?ageMs:null,fresh,reason:timestamp==null?'missing-timestamp':fresh?null:'stale'}
  }
  const samples={windSpeedTrue:read('environment.wind.speedTrue'),windDirectionTrue:read('environment.wind.directionTrue'),temperature:read('environment.outside.temperature'),relativeHumidity:read('environment.outside.humidity')}
  const s={time:new Date(now).toISOString(),epochMs:now,windSpeedTrue:samples.windSpeedTrue.value,windDirectionTrue:samples.windDirectionTrue.value,temperature:samples.temperature.value,relativeHumidity:samples.relativeHumidity.value,samples}
  for(const k of ['windSpeedTrue','windDirectionTrue','temperature','relativeHumidity'])if(!Number.isFinite(s[k]))s[k]=null
  this.history.push(s);const cut=now-this.historyMinutes*60000;this.history=this.history.filter(x=>x.epochMs>=cut);return this.context(s)
 }
 context(current=this.history.at(-1)){
  const old=this.history[0]||current;if(!current)return{available:false}
  const windIncrease=current.windSpeedTrue!=null&&old.windSpeedTrue!=null?current.windSpeedTrue-old.windSpeedTrue:null
  const windShift=angleDiffRad(current.windDirectionTrue,old.windDirectionTrue)
  const tempDrop=current.temperature!=null&&old.temperature!=null?old.temperature-current.temperature:null
  const humidityRise=current.relativeHumidity!=null&&old.relativeHumidity!=null?current.relativeHumidity-old.relativeHumidity:null
  let evidence=0,n=0
  if(windIncrease!=null){evidence+=Math.min(1,Math.max(0,windIncrease/5));n++}
  if(windShift!=null){evidence+=Math.min(1,Math.abs(windShift)/rad(45));n++}
  if(tempDrop!=null){evidence+=Math.min(1,Math.max(0,tempDrop/3));n++}
  if(humidityRise!=null){evidence+=Math.min(1,Math.max(0,humidityRise/.15));n++}
  const sampleStates=Object.values(current.samples||{}),stale=sampleStates.some(x=>x.reason==='stale'),missingTimestamp=sampleStates.some(x=>x.reason==='missing-timestamp')
  return{available:n>0,stale:!n&&stale,reason:n?null:stale?'stale':missingTimestamp?'missing-timestamp':'unavailable',time:current.time,values:{windSpeedTrue:current.windSpeedTrue,windDirectionTrue:current.windDirectionTrue,temperature:current.temperature,relativeHumidity:current.relativeHumidity},samples:current.samples||{},trends:{windSpeedIncrease:windIncrease,windDirectionShift:windShift,temperatureDrop:tempDrop,relativeHumidityRise:humidityRise},evidenceScore:n?evidence/n:0,method:'onboard-environment-trend'}
 }
}
module.exports={EnvironmentFusion,angleDiffRad}
