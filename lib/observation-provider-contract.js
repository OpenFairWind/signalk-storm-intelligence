'use strict'
function assertObservationProvider(p){
  if(!p||typeof p!=='object') throw new TypeError('Invalid observation provider')
  for(const k of ['id','name']) if(typeof p[k]!=='string'||!p[k]) throw new TypeError(`Observation provider missing ${k}`)
  if(typeof p.observations!=='function'&&typeof p.densityTile!=='function') throw new TypeError(`Observation provider ${p.id} needs observations() and/or densityTile()`)
  return p
}
function describeObservationProvider(p){const c={...(p.capabilities||{})};if(c.points==null)c.points=typeof p.observations==='function';if(c.density==null)c.density=typeof p.densityTile==='function';return{id:p.id,name:p.name,attribution:p.attribution||p.name,types:Array.isArray(p.types)?p.types:['lightning'],capabilities:c,density:typeof p.densityDescriptor==='function'?p.densityDescriptor():undefined}}
module.exports={assertObservationProvider,describeObservationProvider}
