'use strict'

const { haversine } = require('./storm-engine')
const R = 6371008.8
const NM = 1852
const rad = d => d * Math.PI / 180
const deg = r => r * 180 / Math.PI

function destination(position, bearingDeg, distanceM) {
  const lat1 = rad(Number(position.latitude)), lon1 = rad(Number(position.longitude))
  const br = rad(bearingDeg), ad = distanceM / R
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ad) + Math.cos(lat1) * Math.sin(ad) * Math.cos(br))
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(lat1), Math.cos(ad) - Math.sin(lat1) * Math.sin(lat2))
  let lon = deg(lon2); while (lon > 180) lon -= 360; while (lon < -180) lon += 360
  return { latitude: deg(lat2), longitude: lon }
}

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
function angleDiff(a,b){ if(!Number.isFinite(a)||!Number.isFinite(b))return null;let d=a-b;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d }

function normalizeWeatherData(row, queryPosition, now = Date.now()) {
  if (!row || !row.date) return null
  const epochMs = new Date(row.date).getTime()
  if (!Number.isFinite(epochMs)) return null
  const outside = row.outside || {}, wind = row.wind || {}
  return {
    type: 'weather-observation',
    time: new Date(epochMs).toISOString(), epochMs,
    queryPosition: { latitude:Number(queryPosition.latitude), longitude:Number(queryPosition.longitude) },
    provider: row.provider || row.source || null,
    description: row.description || null,
    ageSec: Math.max(0, (now - epochMs) / 1000),
    values: {
      windSpeedTrue: finite(wind.speedTrue), windDirectionTrue: finite(wind.directionTrue), windGust: finite(wind.gust),
      temperature: finite(outside.temperature), relativeHumidity: finite(outside.relativeHumidity), pressure: finite(outside.pressure),
      precipitationVolume: finite(outside.precipitationVolume), dewPointTemperature: finite(outside.dewPointTemperature), visibility: finite(outside.horizontalVisibility)
    }
  }
}

function newestObservation(rows, queryPosition, now, maxAgeMs) {
  return (rows || []).map(r => normalizeWeatherData(r, queryPosition, now)).filter(Boolean)
    .filter(r => r.epochMs <= now + 120000 && now - r.epochMs <= maxAgeMs)
    .sort((a,b) => b.epochMs - a.epochMs)[0] || null
}

function range(samples, key) {
  const vals = samples.map(s => s?.values?.[key]).filter(Number.isFinite)
  return vals.length ? { min:Math.min(...vals), max:Math.max(...vals), spread:Math.max(...vals)-Math.min(...vals), count:vals.length } : null
}

function positiveEvidence(upstream, local) {
  if (!upstream || !local) return { score:0, available:false, signals:{} }
  const u=upstream.values||{}, l=local.values||{}, sig={}; let sum=0,n=0
  const add=(name,value,scale)=>{if(value==null)return;const s=Math.max(0,Math.min(1,value/scale));sig[name]=value;sum+=s;n++}
  add('windIncrease', Number.isFinite(u.windSpeedTrue)&&Number.isFinite(l.windSpeedTrue)?u.windSpeedTrue-l.windSpeedTrue:null, 5)
  add('gustIncrease', Number.isFinite(u.windGust)&&Number.isFinite(l.windGust)?u.windGust-l.windGust:null, 7)
  add('temperatureDrop', Number.isFinite(u.temperature)&&Number.isFinite(l.temperature)?l.temperature-u.temperature:null, 3)
  add('humidityRise', Number.isFinite(u.relativeHumidity)&&Number.isFinite(l.relativeHumidity)?u.relativeHumidity-l.relativeHumidity:null, .15)
  add('pressureDrop', Number.isFinite(u.pressure)&&Number.isFinite(l.pressure)?l.pressure-u.pressure:null, 300)
  if(Number.isFinite(u.precipitationVolume)){sig.upstreamPrecipitation=u.precipitationVolume;sum+=Math.min(1,Math.max(0,u.precipitationVolume)/2);n++}
  if(Number.isFinite(u.windDirectionTrue)&&Number.isFinite(l.windDirectionTrue)){const shift=Math.abs(angleDiff(u.windDirectionTrue,l.windDirectionTrue));sig.windDirectionDifference=shift;sum+=Math.min(1,shift/rad(45));n++}
  return { score:n?sum/n:0, available:n>0, signals:sig }
}

function evidenceForCell(cell, context) {
  if (!context?.available || !cell?.centroid || !context.samples?.length) return { available:false, score:0 }
  const cp=cell.centroid
  let nearest=null
  for(const s of context.samples){const d=haversine(cp,[s.queryPosition.longitude,s.queryPosition.latitude]);if(!nearest||d<nearest.distanceMeters)nearest={sample:s,distanceMeters:d}}
  const local=context.center || context.samples.reduce((best,s)=>{const d=haversine([context.vesselPosition.longitude,context.vesselPosition.latitude],[s.queryPosition.longitude,s.queryPosition.latitude]);return !best||d<best.distanceMeters?{sample:s,distanceMeters:d}:best},null)?.sample
  const ev=positiveEvidence(nearest?.sample,local)
  return { ...ev, method:'signalk-weather-api-spatial-corroboration', upstream:nearest?.sample||null, local:local||null, upstreamDistanceToCellMeters:nearest?.distanceMeters??null }
}

class WeatherApiFusion {
  constructor({radiusNm=40,bearings=8,maxCount=3,maxAgeMinutes=30}={}) { this.radiusNm=radiusNm;this.bearings=bearings;this.maxCount=maxCount;this.maxAgeMinutes=maxAgeMinutes;this.last={available:false} }
  points(position){const out=[{id:'center',bearing:null,position:{latitude:Number(position.latitude),longitude:Number(position.longitude)}}];for(let i=0;i<this.bearings;i++){const b=i*360/this.bearings;out.push({id:`ring-${i}`,bearing:b,position:destination(position,b,this.radiusNm*NM)})}return out}
  async sample(app, position, now=Date.now()) {
    if (!position || !app?.weatherApi || typeof app.weatherApi.getObservations !== 'function') return this.last={available:false,reason:'weather-api-unavailable',sampledAt:new Date(now).toISOString(),samples:[]}
    const points=this.points(position), samples=[], errors=[]
    const startDate=new Date(now-this.maxAgeMinutes*60000).toISOString().slice(0,10)
    for(const p of points){try{const rows=await app.weatherApi.getObservations(p.position,{maxCount:this.maxCount,startDate});const obs=newestObservation(rows,p.position,now,this.maxAgeMinutes*60000);if(obs)samples.push({...obs,sampleId:p.id,bearing:p.bearing})}catch(e){errors.push({sampleId:p.id,message:e.message})}}
    const center=samples.find(s=>s.sampleId==='center')||null
    const ring=samples.filter(s=>s.sampleId!=='center')
    const spatial={temperature:range(ring,'temperature'),relativeHumidity:range(ring,'relativeHumidity'),pressure:range(ring,'pressure'),windSpeedTrue:range(ring,'windSpeedTrue'),windGust:range(ring,'windGust'),precipitationVolume:range(ring,'precipitationVolume')}
    return this.last={available:samples.length>0,method:'signalk-weather-api-location-sampling',sampledAt:new Date(now).toISOString(),vesselPosition:{latitude:Number(position.latitude),longitude:Number(position.longitude)},radiusNm:this.radiusNm,sampleCount:samples.length,requestedCount:points.length,center,samples,spatial,errors}
  }
}

function attachWeatherApiEvidence(cells, context, weight=.15){return(cells||[]).map(c=>{const ev=evidenceForCell(c,context);if(!ev.available)return c;const boost=Math.max(0,Math.min(weight,ev.score*weight));return{...c,weatherObservations:ev,threat:c.threat?{...c.threat,confidence:Math.min(1,(c.threat.confidence||0)+boost),evidence:{...(c.threat.evidence||{}),weatherObservations:ev}}:c.threat}})}

module.exports={WeatherApiFusion,normalizeWeatherData,newestObservation,evidenceForCell,attachWeatherApiEvidence,destination,positiveEvidence}
