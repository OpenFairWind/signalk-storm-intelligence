'use strict'

const { USER_AGENT } = require('./version')
const RAINVIEWER_PRODUCTS = Object.freeze({
  COMPOSITE: {
    title: 'RainViewer Global Radar Composite',
    description: 'Global weather-radar composite exposed as native XYZ raster tiles',
    kind: 'raster',
    units: 'dBZ',
    period: 'PT10M',
    temporal: true,
    forecast: true,
    bounds: [-180, -85.05112878, 180, 85.05112878],
    minZoom: 0,
    maxZoom: 7
  }
})

function timeoutSignal(ms) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : (() => {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), ms)
    t.unref?.()
    return c.signal
  })()
}

function normalizeMetadata(data) {
  if (!data || typeof data !== 'object') throw new Error('RainViewer metadata is not an object')
  if (typeof data.host !== 'string' || !data.host) throw new Error('RainViewer metadata has no tile host')
  const past = Array.isArray(data.radar?.past) ? data.radar.past : []
  const nowcast = Array.isArray(data.radar?.nowcast) ? data.radar.nowcast : []
  const clean = list => list
    .filter(f => Number.isFinite(Number(f?.time)) && typeof f?.path === 'string' && f.path)
    .map(f => ({ epochMs: Number(f.time) * 1000, time: new Date(Number(f.time) * 1000).toISOString(), path: f.path }))
    .sort((a, b) => a.epochMs - b.epochMs)
  return {
    generatedEpochMs: Number.isFinite(Number(data.generated)) ? Number(data.generated) * 1000 : null,
    host: data.host.replace(/\/$/, ''),
    past: clean(past),
    nowcast: clean(nowcast)
  }
}

function selectObservationFrame(meta, now = Date.now(), toleranceMs = 2 * 60 * 1000) {
  const frames = meta?.past || []
  if (!frames.length) return null
  const valid = frames.filter(f => f.epochMs <= now + toleranceMs)
  return (valid.length ? valid[valid.length - 1] : frames[0])
}

function frameForTime(meta, time, toleranceMs = 90 * 1000) {
  const target = typeof time === 'number' ? time : Date.parse(time)
  if (!Number.isFinite(target)) return null
  const frames = [...(meta?.past || []), ...(meta?.nowcast || [])]
  let best = null
  for (const frame of frames) {
    const delta = Math.abs(frame.epochMs - target)
    if (!best || delta < best.delta) best = { frame, delta }
  }
  return best && best.delta <= toleranceMs ? best.frame : null
}

class RainViewerProvider {
  constructor(cfg = {}) {
    this.id = 'rainviewer'
    this.name = 'RainViewer Global Radar'
    this.attribution = 'Radar mosaic: RainViewer.com'
    this.bounds = [-180, -85.05112878, 180, 85.05112878]
    this.cfg = cfg
    this._metadata = null
  }

  products() { return RAINVIEWER_PRODUCTS }

  async metadata(force = false) {
    const now = Date.now()
    if (!force && this._metadata && this._metadata.expires > now) return this._metadata.value
    const url = this.cfg.metadataUrl || 'https://api.rainviewer.com/public/weather-maps.json'
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: timeoutSignal(this.cfg.requestTimeoutMs || 10000)
    })
    if (!r.ok) throw new Error(`RainViewer metadata HTTP ${r.status}`)
    const value = normalizeMetadata(await r.json())
    if (!value.past.length) throw new Error('RainViewer metadata returned no past radar frames')
    const ttl = Math.max(15000, Number(this.cfg.metadataCacheSeconds || 60) * 1000)
    this._metadata = { value, expires: now + ttl }
    return value
  }

  async latest(product) {
    if (product !== 'COMPOSITE') throw new Error(`Unsupported RainViewer product ${product}`)
    const meta = await this.metadata()
    const frame = selectObservationFrame(meta)
    if (!frame) throw new Error('No RainViewer observation frame available')
    return {
      product,
      time: frame.time,
      epochMs: frame.epochMs,
      period: RAINVIEWER_PRODUCTS.COMPOSITE.period,
      source: this.id,
      generatedAt: meta.generatedEpochMs ? new Date(meta.generatedEpochMs).toISOString() : null,
      forecastAvailable: meta.nowcast.length > 0
    }
  }

  async timeline(product, options = {}) {
    if (product !== 'COMPOSITE') throw new Error(`Unsupported RainViewer product ${product}`)
    const meta = await this.metadata()
    const latest = selectObservationFrame(meta)
    if (!latest) return []
    const minutes = Math.max(5, Math.min(24 * 60, Number(options.minutes) || 180))
    const lower = latest.epochMs - minutes * 60000
    return meta.past.filter(f => f.epochMs >= lower && f.epochMs <= latest.epochMs).map(f => f.time)
  }

  async forecastTimeline(product) {
    if (product !== 'COMPOSITE') throw new Error(`Unsupported RainViewer product ${product}`)
    const meta = await this.metadata()
    return meta.nowcast.map(f => f.time)
  }

  async tile(product, tileRequest, time) {
    if (product !== 'COMPOSITE') throw new Error(`Unsupported RainViewer product ${product}`)
    const { z, x, y } = tileRequest || {}
    if (![z, x, y].every(Number.isInteger)) throw new Error('RainViewer requires XYZ tile coordinates')
    if (z < 0 || z > 7) throw new Error(`RainViewer zoom ${z} outside supported range 0-7`)

    const meta = await this.metadata()
    const frame = time ? frameForTime(meta, time) : selectObservationFrame(meta)
    if (!frame) throw new Error(`RainViewer frame not available${time ? ` for ${time}` : ''}`)

    const size = Number(this.cfg.tileSize) === 512 ? 512 : 256
    const color = Math.max(0, Math.min(8, Number(this.cfg.colorScheme) || 2))
    const smooth = this.cfg.smooth === false ? 0 : 1
    const snow = this.cfg.showSnow === false ? 0 : 1
    const url = `${meta.host}${frame.path}/${size}/${z}/${x}/${y}/${color}/${smooth}_${snow}.png`
    const r = await fetch(url, {
      headers: { accept: 'image/png,image/*;q=0.8', 'user-agent': USER_AGENT },
      signal: timeoutSignal(this.cfg.requestTimeoutMs || 10000)
    })
    if (!r.ok) throw new Error(`RainViewer tile HTTP ${r.status}`)
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('image/png')) throw new Error(`RainViewer tile returned ${ct}`)
    return Buffer.from(await r.arrayBuffer())
  }
}

module.exports = {
  RainViewerProvider,
  RAINVIEWER_PRODUCTS,
  normalizeMetadata,
  selectObservationFrame,
  frameForTime
}
