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

function parseHrdBinary(buffer) {
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer)
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let offset=0
  function requireBytes(count){if(offset+count>view.byteLength)throw new Error('HRD binary is truncated')}
  function uint8(){requireBytes(1);const value=view.getUint8(offset);offset+=1;return value}
  function uint16(){requireBytes(2);const value=view.getUint16(offset,false);offset+=2;return value}
  function int16(){requireBytes(2);const value=view.getInt16(offset,false);offset+=2;return value}
  function int32(){requireBytes(4);const value=view.getInt32(offset,false);offset+=4;return value}
  const magic=uint8(),version=uint8()
  if(magic!==72||version!==1)throw new Error(`Unsupported HRD binary header ${magic}/${version}`)
  const attributeNames=['SRI','POH','HRI','VMI','VIL','Vel','Dir','Area']
  const polygonCount=uint16(),features=[]
  for(let polygonIndex=0;polygonIndex<polygonCount;polygonIndex++){
    const ringCount=uint8(),attributeMask=uint16(),minX=int32(),minY=int32()
    int32();int32()
    const properties={}
    for(let attributeIndex=0;attributeIndex<attributeNames.length;attributeIndex++){
      if(!(attributeMask&(1<<attributeIndex)))continue
      const name=attributeNames[attributeIndex]
      properties[name]=name==='Vel'?int16()/100:name==='Area'?uint16()/10:uint16()/100
    }
    const coordinates=[]
    for(let ringIndex=0;ringIndex<ringCount;ringIndex++){
      const pointCount=uint16(),ring=[]
      let x=0,y=0
      for(let pointIndex=0;pointIndex<pointCount;pointIndex++){
        x+=int16();y+=int16()
        ring.push([(minX+x)/262144*360-180,(minY+y)/262144*180-90])
      }
      coordinates.push(ring)
    }
    if(coordinates.length&&coordinates[0].length>=3)features.push({type:'Feature',properties,geometry:{type:'Polygon',coordinates}})
  }
  if(offset!==view.byteLength)throw new Error(`HRD binary has ${view.byteLength-offset} trailing bytes`)
  return features
}

module.exports={parseHrdZip,parseHrdBinary}
