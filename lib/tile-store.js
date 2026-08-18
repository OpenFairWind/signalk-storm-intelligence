'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

function safeName(s) { return String(s).replace(/[^A-Za-z0-9_.-]+/g, '_') }
function clampLat(lat) { return Math.max(-85.05112878, Math.min(85.05112878, Number(lat))) }
function wrapLon(lon) { let v = Number(lon); while (v < -180) v += 360; while (v >= 180) v -= 360; return v }
function lonToTileX(lon, z) { return Math.floor(((wrapLon(lon) + 180) / 360) * (2 ** z)) }
function latToTileY(lat, z) {
  const phi = clampLat(lat) * Math.PI / 180, n = 2 ** z
  return Math.floor((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * n)
}
function tileCountForZoom(z) { return 2 ** z }
function normalizeX(x, z) { const n = tileCountForZoom(z); return ((x % n) + n) % n }
function clampY(y, z) { const n = tileCountForZoom(z); return Math.max(0, Math.min(n - 1, y)) }

function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const R = 6371008.8, d = distanceM / R, b = bearingDeg * Math.PI / 180
  const p1 = Number(lat) * Math.PI / 180, l1 = Number(lon) * Math.PI / 180
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return { latitude: p2 * 180 / Math.PI, longitude: wrapLon(l2 * 180 / Math.PI) }
}

function tilesAroundPosition(position, radiusM, zooms, maxTiles = 4096) {
  if (!position || !Number.isFinite(Number(position.latitude)) || !Number.isFinite(Number(position.longitude))) return []
  const lat = Number(position.latitude), lon = Number(position.longitude), r = Math.max(0, Number(radiusM) || 0)
  const north = destinationPoint(lat, lon, 0, r), south = destinationPoint(lat, lon, 180, r)
  const east = destinationPoint(lat, lon, 90, r), west = destinationPoint(lat, lon, 270, r)
  const out = []
  for (const zRaw of zooms || []) {
    const z = Number(zRaw); if (!Number.isInteger(z) || z < 0 || z > 22) continue
    const n = tileCountForZoom(z), y0 = clampY(latToTileY(north.latitude, z), z), y1 = clampY(latToTileY(south.latitude, z), z)
    let x0 = lonToTileX(west.longitude, z), x1 = lonToTileX(east.longitude, z)
    let xs = []
    if (west.longitude <= east.longitude) { for (let x = x0; x <= x1; x++) xs.push(normalizeX(x, z)) }
    else { for (let x = x0; x < n; x++) xs.push(x); for (let x = 0; x <= x1; x++) xs.push(x) }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (const x of xs) {
      out.push({ z, x, y }); if (out.length >= maxTiles) return out
    }
  }
  return out
}

class TileStore {
  constructor(root, options = {}) {
    this.root = root
    this.enabled = options.enabled !== false
    this.maxBytes = Math.max(0, Number(options.maxBytes) || 0)
    this.maxAgeMs = Math.max(0, Number(options.maxAgeMs) || 0)
  }
  async init() { if (this.enabled) await fs.mkdir(this.root, { recursive: true }) }
  frameDir(provider, product, epochMs) { return path.join(this.root, safeName(provider), safeName(product), String(Number(epochMs))) }
  tilePath(provider, product, epochMs, z, x, y) { return path.join(this.frameDir(provider, product, epochMs), String(z), String(x), `${y}.png`) }
  async put(provider, product, epochMs, z, x, y, data) {
    if (!this.enabled) return null
    const target = this.tilePath(provider, product, epochMs, z, x, y); await fs.mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`; await fs.writeFile(temp, data); await fs.rename(temp, target); return target
  }
  async get(provider, product, epochMs, z, x, y) { try { return await fs.readFile(this.tilePath(provider, product, epochMs, z, x, y)) } catch { return null } }
  async frames(provider, product) {
    const dir = path.join(this.root, safeName(provider), safeName(product)); let names=[]
    try { names = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
    return names.filter(x=>x.isDirectory() && /^\d+$/.test(x.name)).map(x=>Number(x.name)).sort((a,b)=>a-b)
  }
  async newestTile(provider, product, z, x, y) {
    const frames = await this.frames(provider, product)
    for (let i=frames.length-1;i>=0;i--) { const b=await this.get(provider, product, frames[i], z, x, y); if (b) return { epochMs: frames[i], buffer:b } }
    return null
  }
  async listFiles() {
    if (!this.enabled) return []
    const out=[]
    async function walk(dir) { let ents=[]; try{ents=await fs.readdir(dir,{withFileTypes:true})}catch{return} for(const e of ents){ const p=path.join(dir,e.name); if(e.isDirectory()) await walk(p); else if(e.isFile()&&!e.name.includes('.tmp-')){ const st=await fs.stat(p); out.push({path:p,size:st.size,mtimeMs:st.mtimeMs}) } } }
    await walk(this.root); return out.sort((a,b)=>a.mtimeMs-b.mtimeMs)
  }
  async recycle(now=Date.now()) {
    if (!this.enabled) return {removed:0,bytes:0}
    let files=await this.listFiles(), removed=0, bytes=0
    if(this.maxAgeMs>0){ for(const f of files) if(now-f.mtimeMs>this.maxAgeMs){ try{await fs.unlink(f.path);removed++;bytes+=f.size}catch{} } files=await this.listFiles() }
    if(this.maxBytes>0){ let total=files.reduce((s,f)=>s+f.size,0); for(const f of files){ if(total<=this.maxBytes)break; try{await fs.unlink(f.path);total-=f.size;removed++;bytes+=f.size}catch{} } }
    return {removed,bytes}
  }
  async stats() { const files=await this.listFiles(); return {enabled:this.enabled,files:files.length,bytes:files.reduce((s,f)=>s+f.size,0),root:this.root} }
}

module.exports = { TileStore, tilesAroundPosition, destinationPoint, lonToTileX, latToTileY }
