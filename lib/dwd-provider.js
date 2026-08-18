'use strict'

const { USER_AGENT } = require('./version')
const DWD_PRODUCTS = Object.freeze({
  RAIN_RATE: {
    layer: 'dwd:Niederschlagsradar',
    path: 'Niederschlagsradar',
    title: 'DWD Radar Rain Rate',
    description: 'German Weather Service national radar precipitation mosaic (alias of the current RV product)',
    kind: 'raster',
    units: 'mm/h',
    period: 'PT5M',
    temporal: true,
    forecast: true,
    bounds: [3.0, 46.0, 17.0, 56.0]
  },
  REFLECTIVITY: {
    layer: 'dwd:Radar_wn-product_1x1km_ger',
    path: 'Radar_wn-product_1x1km_ger',
    title: 'DWD Radar Reflectivity',
    description: 'German Weather Service WN national radar reflectivity composite',
    kind: 'raster',
    units: 'dBZ',
    period: 'PT5M',
    temporal: true,
    forecast: true,
    style: 'wn-produkt-ohne-abdeckung',
    bounds: [3.0, 46.0, 17.0, 56.0]
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

function parseIsoDurationMs(text) {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(text || '')
  if (!m) return null
  return ((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)) * 1000
}

function expandTimeToken(token, out, max = 4096) {
  const parts = token.trim().split('/')
  if (parts.length !== 3) {
    const t = Date.parse(token.trim())
    if (Number.isFinite(t)) out.push(t)
    return
  }
  const start = Date.parse(parts[0]), end = Date.parse(parts[1]), step = parseIsoDurationMs(parts[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || !step || step <= 0) return
  for (let t = start; t <= end && out.length < max; t += step) out.push(t)
}

function parseTimeDimension(xml) {
  // GeoServer can emit either WMS 1.3 Dimension or WMS 1.1 Extent elements.
  const matches = []
  const re = /<(?:Dimension|Extent)\b[^>]*\bname=["']time["'][^>]*>([\s\S]*?)<\/(?:Dimension|Extent)>/gi
  let m
  while ((m = re.exec(xml))) matches.push(m[1])
  const epochs = []
  for (const body of matches) {
    const clean = body.replace(/&amp;/g, '&').replace(/\s+/g, '')
    for (const token of clean.split(',').filter(Boolean)) expandTimeToken(token, epochs)
  }
  return [...new Set(epochs)].sort((a, b) => a - b)
}

function selectObservationEpoch(epochs, now = Date.now(), toleranceMs = 2 * 60 * 1000) {
  if (!epochs.length) return null
  const notFuture = epochs.filter(t => t <= now + toleranceMs)
  return (notFuture.length ? notFuture[notFuture.length - 1] : epochs[0])
}

class DwdProvider {
  constructor(cfg = {}) {
    this.id = 'dwd'
    this.name = 'Deutscher Wetterdienst (DWD)'
    this.attribution = 'Radar data: Deutscher Wetterdienst (DWD)'
    this.bounds = [3.0, 46.0, 17.0, 56.0]
    this.cfg = cfg
    this._times = new Map()
  }

  products() { return DWD_PRODUCTS }

  _meta(product) {
    const m = DWD_PRODUCTS[product]
    if (!m) throw new Error(`Unsupported DWD product ${product}`)
    return m
  }

  capabilitiesUrl(product) {
    const m = this._meta(product)
    const base = new URL(this.cfg.dwdWmsBase || 'https://maps.dwd.de/geoserver/dwd/wms')
    const root = `${base.protocol}//${base.host}`
    const u = new URL(`/geoserver/dwd/${encodeURIComponent(m.path)}/wms`, root)
    u.searchParams.set('service', 'WMS')
    u.searchParams.set('version', '1.3.0')
    u.searchParams.set('request', 'GetCapabilities')
    return u.toString()
  }

  async availableTimes(product, force = false) {
    const cached = this._times.get(product)
    if (!force && cached && cached.expires > Date.now()) return cached.times
    const r = await fetch(this.capabilitiesUrl(product), {
      headers: { accept: 'application/xml,text/xml,*/*;q=0.5', 'user-agent': USER_AGENT },
      signal: timeoutSignal(this.cfg.requestTimeoutMs || 10000)
    })
    if (!r.ok) throw new Error(`DWD WMS capabilities HTTP ${r.status}`)
    const times = parseTimeDimension(await r.text())
    if (!times.length) throw new Error(`DWD WMS returned no time dimension for ${product}`)
    this._times.set(product, { times, expires: Date.now() + Math.max(15000, this.cfg.dwdCapabilitiesCacheSeconds * 1000 || 60000) })
    return times
  }

  async latest(product) {
    const m = this._meta(product)
    const times = await this.availableTimes(product)
    const epochMs = selectObservationEpoch(times)
    if (!Number.isFinite(epochMs)) throw new Error(`No current DWD ${product} frame available`)
    return { product, time: new Date(epochMs).toISOString(), epochMs, period: m.period || null, source: this.id, forecastAvailable: !!m.forecast }
  }

  async timeline(product, options = {}) {
    const times = await this.availableTimes(product)
    const now = Date.now(), minutes = Math.max(5, Math.min(24 * 60, Number(options.minutes) || 180))
    const latest = selectObservationEpoch(times, now)
    const lower = latest - minutes * 60000
    return times.filter(t => t >= lower && t <= latest).map(t => new Date(t).toISOString())
  }

  wmsUrl(product, bbox, time) {
    const m = this._meta(product)
    const u = new URL(this.cfg.dwdWmsBase || 'https://maps.dwd.de/geoserver/dwd/wms')
    const params = {
      service: 'WMS', version: '1.1.1', request: 'GetMap', layers: m.layer,
      styles: m.style || '', format: 'image/png', transparent: 'true', width: '256', height: '256',
      srs: 'EPSG:3857', bbox: bbox.join(',')
    }
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    if (time) u.searchParams.set('time', time)
    return u.toString()
  }

  async tile(product, tileRequest, time) {
    const bbox = Array.isArray(tileRequest) ? tileRequest : tileRequest?.bbox3857
    if (!Array.isArray(bbox)) throw new Error('DWD requires bbox3857 in tile request')
    // DWD RV/WN contain a 0-2h nowcast. Avoid silently showing a future frame when
    // the caller asks for "latest radar": resolve the newest non-future observation.
    let effectiveTime = time
    if (!effectiveTime) effectiveTime = (await this.latest(product)).time
    const r = await fetch(this.wmsUrl(product, bbox, effectiveTime), {
      headers: { accept: 'image/png,image/*;q=0.8', 'user-agent': USER_AGENT },
      signal: timeoutSignal(this.cfg.requestTimeoutMs || 10000)
    })
    if (!r.ok) throw new Error(`DWD WMS HTTP ${r.status}`)
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('image/png')) throw new Error(`DWD WMS returned ${ct}`)
    return Buffer.from(await r.arrayBuffer())
  }
}

module.exports = { DwdProvider, DWD_PRODUCTS, parseTimeDimension, selectObservationEpoch, parseIsoDurationMs }
