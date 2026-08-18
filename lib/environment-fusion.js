'use strict'
const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI
function angleDiffRad(a,b){if(!Number.isFinite(a)||!Number.isFinite(b))return null;let d=a-b;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d}
class EnvironmentFusion{
 constructor({historyMinutes=30,maxAgeSec=180}={}){this.historyMinutes=historyMinutes;this.maxAgeSec=maxAgeSec;this.history=[]}
 sample(app,now=Date.now()){
  const get=p=>app.getSelfPath?.(p), val=p=>{const v=get(p);if(v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null}
  const s={time:new Date(now).toISOString(),epochMs:now,windSpeedTrue:val('environment.wind.speedTrue'),windDirectionTrue:val('environment.wind.directionTrue'),temperature:val('environment.outside.temperature'),relativeHumidity:val('environment.outside.humidity')}
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
  return{available:n>0,time:current.time,values:{windSpeedTrue:current.windSpeedTrue,windDirectionTrue:current.windDirectionTrue,temperature:current.temperature,relativeHumidity:current.relativeHumidity},trends:{windSpeedIncrease:windIncrease,windDirectionShift:windShift,temperatureDrop:tempDrop,relativeHumidityRise:humidityRise},evidenceScore:n?evidence/n:0,method:'onboard-environment-trend'}
 }
}
module.exports={EnvironmentFusion,angleDiffRad}
