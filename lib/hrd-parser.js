'use strict'
const path = require('node:path')
const fs = require('node:fs/promises')

async function parseHrdZip(buffer) {
  let AdmZip, shapefile, proj4
  try { AdmZip=require('adm-zip'); shapefile=require('shapefile'); proj4=require('proj4') } catch (e) { throw new Error(`HRD parser dependencies unavailable: ${e.message}`) }
  const zip=new AdmZip(buffer), entries=zip.getEntries()
  const shp=entries.find(e=>e.entryName.toLowerCase().endsWith('.shp'))
  const dbf=entries.find(e=>e.entryName.toLowerCase().endsWith('.dbf'))
  const prj=entries.find(e=>e.entryName.toLowerCase().endsWith('.prj'))
  if(!shp||!dbf) throw new Error('HRD archive has no .shp/.dbf collection')
  const source=await shapefile.open(shp.getData(),dbf.getData())
  const transform=prj ? proj4(prj.getData().toString('utf8'),'EPSG:4326') : null
  const features=[]
  function txCoords(coords){ return typeof coords[0]==='number' ? (transform?transform.forward(coords):coords) : coords.map(txCoords) }
  for(;;){ const r=await source.read(); if(r.done) break; if(r.value?.geometry && transform) r.value.geometry.coordinates=txCoords(r.value.geometry.coordinates); features.push(r.value) }
  return features
}
module.exports={parseHrdZip}
