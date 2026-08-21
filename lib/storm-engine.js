'use strict'

const R = 6371008.8
const rad = d => d * Math.PI / 180
const deg = r => r * 180 / Math.PI
const normalizeLongitude=lon=>{let value=((Number(lon)+180)%360+360)%360-180;return Object.is(value,-0)?0:value}
const unwrapLongitude=(lon,reference)=>{let value=Number(lon);while(value-reference>=180)value-=360;while(value-reference< -180)value+=360;return value}

function haversine(a, b) {
  const p1 = rad(a[1]), p2 = rad(b[1]), dp = p2 - p1, dl = rad(b[0] - a[0])
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
function bearing(a,b) {
  const p1=rad(a[1]), p2=rad(b[1]), dl=rad(b[0]-a[0])
  const y=Math.sin(dl)*Math.cos(p2), x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl)
  return (deg(Math.atan2(y,x))+360)%360
}
function centroidGeometry(g) {
  if (!g) return null
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null
  if (!polygons?.length) return null
  const first=g.coordinates?.flat(3).find(Number.isFinite),reference=Number.isFinite(first)?first:0
  let weightedX=0,weightedY=0,totalWeight=0
  const fallback=[]
  for(const polygon of polygons) for(const [ringIndex,ring] of (polygon||[]).entries()){
    if(!Array.isArray(ring))continue
    const localRing=ring.map(p=>[unwrapLongitude(p[0],reference),p[1]])
    for(let i=0;i<localRing.length;i++)if(Array.isArray(localRing[i])&&localRing[i].length>=2&&(i===0||localRing[i][0]!==localRing[i-1][0]||localRing[i][1]!==localRing[i-1][1]))fallback.push(localRing[i])
    let twiceArea=0,cx=0,cy=0
    for(let i=0;i<localRing.length;i++){
      const a=localRing[i],b=localRing[(i+1)%localRing.length];if(!a||!b)continue
      const cross=a[0]*b[1]-b[0]*a[1];twiceArea+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross
    }
    if(Math.abs(twiceArea)>1e-12){
      const weight=(ringIndex===0?1:-1)*Math.abs(twiceArea)/2
      weightedX+=(cx/(3*twiceArea))*weight;weightedY+=(cy/(3*twiceArea))*weight;totalWeight+=weight
    }
  }
  if(Math.abs(totalWeight)>1e-12)return[normalizeLongitude(weightedX/totalWeight),weightedY/totalWeight]
  if(!fallback.length)return null
  const unique=fallback.filter((p,i)=>i===0||p[0]!==fallback[0][0]||p[1]!==fallback[0][1]||i<fallback.length-1)
  return [normalizeLongitude(unique.reduce((s,p)=>s+p[0],0)/unique.length),unique.reduce((s,p)=>s+p[1],0)/unique.length]
}
function velocityBetween(a,b,dtSec) {
  if (!a || !b || !dtSec) return { east:0, north:0, speed:0, course:null }
  const d=haversine(a,b), br=rad(bearing(a,b)), speed=d/dtSec
  return { east:speed*Math.sin(br), north:speed*Math.cos(br), speed, course:(deg(br)+360)%360 }
}
function vesselVelocity(v) {
  const s=Number(v?.sog)||0, c=Number(v?.cog)
  if (!Number.isFinite(c)) return {east:0,north:0}
  return {east:s*Math.sin(c), north:s*Math.cos(c)} // Signal K COG radians
}
function localVectorMeters(origin, target) {
  const north = rad(target[1]-origin[1])*R
  const east = rad(unwrapLongitude(target[0],origin[0])-origin[0])*R*Math.cos(rad((origin[1]+target[1])/2))
  return {east,north}
}
function localPoint(origin, east, north) {
  const lat=origin[1]+deg(north/R), cos=Math.max(.05,Math.cos(rad((origin[1]+lat)/2)))
  let lon=origin[0]+deg(east/(R*cos)); while(lon>180)lon-=360;while(lon<-180)lon+=360
  return [lon,lat]
}

function pointInRing(point, ring) {
  const px=Number(point[0]),localRing=ring.map(p=>[unwrapLongitude(p[0],px),p[1]])
  let inside=false
  for(let i=0,j=localRing.length-1;i<localRing.length;j=i++){
    const xi=localRing[i][0], yi=localRing[i][1], xj=localRing[j][0], yj=localRing[j][1]
    const hit=((yi>point[1])!==(yj>point[1])) && (px < (xj-xi)*(point[1]-yi)/((yj-yi)||1e-15)+xi)
    if(hit) inside=!inside
  }
  return inside
}
function pointInGeometry(point, geometry) {
  if(!geometry)return false
  const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[]
  return polys.some(poly=>{const outer=poly?.[0]||[];if(!pointInRing(point,outer))return false;for(let i=1;i<poly.length;i++)if(pointInRing(point,poly[i]))return false;return true})
}
function pointSegmentDistanceMeters(origin, a, b) {
  const A=localVectorMeters(origin,a), B=localVectorMeters(origin,b)
  const dx=B.east-A.east, dy=B.north-A.north, den=dx*dx+dy*dy
  const t=den>0?Math.max(0,Math.min(1,-(A.east*dx+A.north*dy)/den)):0
  return Math.hypot(A.east+t*dx,A.north+t*dy)
}
function distanceToGeometryMeters(point, geometry) {
  if(!geometry)return null
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[]
  let best=Infinity
  for(const poly of polygons){
    const outer=poly?.[0]||[]
    if(outer.length>=3 && pointInRing(point,outer)) return 0
    for(const ring of poly||[]) for(let i=1;i<ring.length;i++) best=Math.min(best,pointSegmentDistanceMeters(point,ring[i-1],ring[i]))
  }
  return Number.isFinite(best)?best:null
}

function cpa(vesselPos, cellPos, cellVel, vesselVel, horizonSec) {
  const r=localVectorMeters(vesselPos, cellPos)
  const ve=(cellVel?.east||0)-(vesselVel?.east||0), vn=(cellVel?.north||0)-(vesselVel?.north||0)
  const vv=ve*ve+vn*vn
  let t=vv>1e-6 ? -(r.east*ve+r.north*vn)/vv : 0
  t=Math.max(0, Math.min(horizonSec, t))
  const e=r.east+ve*t, n=r.north+vn*t
  return { tcpaSec:t, dcpaMeters:Math.hypot(e,n), closing: (r.east*ve+r.north*vn)<0 }
}
function severityValue(properties={}) {
  const keys=['severity','SEVERITY','maxInd','MAXIND','maxind','SSI','ssi','HRI','hri']
  const nums=keys.map(k=>Number(properties[k])).filter(Number.isFinite)
  return nums.length ? Math.max(...nums) : null
}
function severityState(s, distance, cfg) {
  if (!Number.isFinite(distance) || distance > cfg.warnDistanceM) return 'normal'
  const severe = s === null || s >= cfg.warnSeverity
  if (!severe) return 'normal'
  if (distance <= cfg.alarmDistanceM || (s !== null && s >= cfg.alarmSeverity && distance <= cfg.warnDistanceM)) return 'alarm'
  return 'warn'
}
function median(xs){const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function robustTrackVelocity(history) {
  if(!history || history.length<2)return {east:0,north:0,speed:0,course:null,samples:history?.length||0,confidence:0,residualMeters:null,method:'track-robust'}
  const steps=[]
  for(let i=1;i<history.length;i++){const dt=(history[i].epochMs-history[i-1].epochMs)/1000;if(dt>0){const v=velocityBetween(history[i-1].centroid,history[i].centroid,dt);steps.push({...v,dt})}}
  if(!steps.length)return {east:0,north:0,speed:0,course:null,samples:history.length,confidence:0,residualMeters:null,method:'track-robust'}
  const east=median(steps.map(s=>s.east)),north=median(steps.map(s=>s.north)),speed=Math.hypot(east,north),course=speed>1e-6?(deg(Math.atan2(east,north))+360)%360:null
  const residuals=steps.map(s=>Math.hypot(s.east-east,s.north-north)*s.dt)
  const residualMeters=median(residuals), sampleScore=Math.min(1,(history.length-1)/4), residualScore=Math.max(0,1-Math.min(1,residualMeters/15000)), confidence=Math.max(0,Math.min(1,.15+.55*sampleScore+.30*residualScore))
  return {east,north,speed,course,samples:history.length,confidence,residualMeters,method:'track-robust'}
}
function translateGeometryLocal(g,east,north,seconds){
  if(!g||!['Polygon','MultiPolygon'].includes(g.type))return null
  const base=centroidGeometry(g);if(!base)return g
  const movePoint=p=>{const v=localVectorMeters(base,p);return localPoint(base,v.east+east*seconds,v.north+north*seconds)}
  const ring=r=>r.map(movePoint)
  return g.type==='Polygon'?{type:'Polygon',coordinates:g.coordinates.map(ring)}:{type:'MultiPolygon',coordinates:g.coordinates.map(poly=>poly.map(ring))}
}
function pathPolygonThreat(vesselPos,vesselVel,geometry,cellVel,horizonSec,{stepSec=60,uncertaintyM=0}={}){
  if(!vesselPos||!geometry)return null
  let best=Infinity,bestT=0,intercept=null
  const sample=t=>{
    const vesselPoint=localPoint(vesselPos,(vesselVel?.east||0)*t,(vesselVel?.north||0)*t)
    const moved=translateGeometryLocal(geometry,cellVel?.east||0,cellVel?.north||0,t)
    const d=distanceToGeometryMeters(vesselPoint,moved)
    if(d<best){best=d;bestT=t}
    if(intercept===null && d<=Math.max(0,uncertaintyM)) intercept=t
    return d
  }
  const relativeSpeed=Math.hypot((vesselVel?.east||0)-(cellVel?.east||0),(vesselVel?.north||0)-(cellVel?.north||0))
  const refine=(a,b,da,db,depth=0)=>{
    if(depth>=8||b-a<=1)return
    if(Math.min(da,db)>relativeSpeed*(b-a)+Math.max(0,uncertaintyM))return
    const mid=(a+b)/2,dm=sample(mid)
    refine(a,mid,da,dm,depth+1);refine(mid,b,dm,db,depth+1)
  }
  let previousT=0,previousD=sample(0)
  for(let t=Math.min(stepSec,horizonSec);t<=horizonSec;t=Math.min(horizonSec,t+stepSec)){
    const d=sample(t);refine(previousT,t,previousD,d);previousT=t;previousD=d
    if(t===horizonSec)break
  }
  return {intersects:intercept!==null,interceptSec:intercept,minDistanceMeters:best,minDistanceSec:bestT,stepSec,uncertaintyMeters:uncertaintyM}
}

class StormEngine {
  constructor(config={}) {
    this.config={warnDistanceM:30000,alarmDistanceM:12000,horizonMinutes:60,warnSeverity:3,alarmSeverity:4,matchDistanceM:50000,historyFrames:8,pathStepSec:60,baseUncertaintyM:1500,maxUncertaintyM:20000,...config}
    this.previous=null;this.tracks=new Map();this.nextTrack=1
  }
  evaluate(snapshot, vessel) {
    const current=(snapshot?.features||[]).map((f,i)=>({sourceId:f.id||`cell-${i}`,geometry:f.geometry,properties:f.properties||{},centroid:centroidGeometry(f.geometry)})).filter(c=>c.centroid)
    const prev=this.previous, used=new Set(), vv=vesselVelocity(vessel), vp=vessel?.position ? [vessel.position.longitude,vessel.position.latitude] : null
    const results=current.map(cell=>{
      let match=null, md=Infinity
      if(prev) for(const p of prev.cells){ if(used.has(p.trackId)) continue; const d=haversine(p.centroid,cell.centroid); if(d<md && d<=this.config.matchDistanceM){md=d;match=p} }
      let trackId=match?.trackId
      if(trackId)used.add(trackId);else trackId=`storm-${this.nextTrack++}`
      const old=this.tracks.get(trackId)||[]
      const history=[...old,{epochMs:snapshot.epochMs,centroid:cell.centroid}].slice(-Math.max(2,this.config.historyFrames))
      this.tracks.set(trackId,history)
      const vel=robustTrackVelocity(history)
      const distance=vp?distanceToGeometryMeters(vp,cell.geometry):null
      const approach=vp?cpa(vp,cell.centroid,vel,vv,this.config.horizonMinutes*60):null
      const uncertainty=Math.min(this.config.maxUncertaintyM,this.config.baseUncertaintyM+(1-vel.confidence)*12000+(vel.residualMeters||0))
      const pathThreat=vp?pathPolygonThreat(vp,vv,cell.geometry,vel,this.config.horizonMinutes*60,{stepSec:this.config.pathStepSec,uncertaintyM:uncertainty}):null
      const severity=severityValue(cell.properties)
      let relevantDistance=distance
      if(approach?.closing) relevantDistance=Math.min(relevantDistance,approach.dcpaMeters)
      if(pathThreat) relevantDistance=Math.min(relevantDistance,pathThreat.minDistanceMeters)
      const state=relevantDistance==null?'normal':severityState(severity,relevantDistance,this.config)
      const threat={state,confidence:vel.confidence,method:'polygon-path',intersects:pathThreat?.intersects||false,interceptSec:pathThreat?.interceptSec??null,minDistanceMeters:pathThreat?.minDistanceMeters??null,minDistanceSec:pathThreat?.minDistanceSec??null,uncertaintyMeters:uncertainty}
      return {id:trackId,trackId,sourceId:cell.sourceId,geometry:cell.geometry,properties:cell.properties,centroid:cell.centroid,severity,distanceMeters:distance,motion:vel,cpa:approach,pathThreat,threat,state,history:history.map(h=>({time:new Date(h.epochMs).toISOString(),centroid:h.centroid}))}
    })
    const live=new Set(results.map(r=>r.trackId));for(const id of this.tracks.keys())if(!live.has(id)){const h=this.tracks.get(id);if(!h?.length||snapshot.epochMs-h.at(-1).epochMs>this.config.horizonMinutes*60000)this.tracks.delete(id)}
    this.previous={epochMs:snapshot.epochMs,cells:results.map(r=>({trackId:r.trackId,centroid:r.centroid}))}
    const rank={alarm:0,warn:1,normal:2}
    results.sort((a,b)=>(rank[a.state]-rank[b.state]) || ((a.threat?.minDistanceMeters??Infinity)-(b.threat?.minDistanceMeters??Infinity)))
    return results
  }
}
module.exports={StormEngine,haversine,bearing,centroidGeometry,velocityBetween,cpa,severityValue,distanceToGeometryMeters,robustTrackVelocity,pathPolygonThreat,pointInGeometry,translateGeometryLocal,normalizeLongitude,unwrapLongitude}
