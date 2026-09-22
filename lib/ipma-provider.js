'use strict'

// IPMA national radar reflectivity composite provider (Portugal / eastern
// Atlantic approaches).
//
// Data source: IPMA public web assets, a two-step handshake like AEMET but
// keyless. A metadata JSON (`.../transf/radar/imgs-radar.json`) lists the most
// recent 5-minute frames as `{ "Portugal": [ { date, path }, ... ] }` newest
// first, where `path` is null for frames not yet published; the current frame
// is the first entry with a non-null path, served from `imageBase + path`
// (a palette PNG composite). The feed exposes only recent frames and no
// per-frame query, so this adapter is live-only: it advertises neither
// `timeline` nor historical `tile(time)`.
//
// Display tier only (`products/latest/tile`): the upstream product is a
// rendered image, so per the provider specification §7 this adapter does NOT
// advertise `downloadRaw`/`cellsFromRaw`.
//
// Licensing: © IPMA (https://www.ipma.pt). Attribution surfaced in product
// metadata; callers must honour IPMA's terms for any caching/redistribution.

const { georefBounds, decodeEchoes, renderTile, transparentPng } = require('./ipma-raster')

const DEFAULT_METADATA_URL = 'https://www.ipma.pt/resources.www/transf/radar/imgs-radar.json'
const DEFAULT_IMAGE_BASE = 'https://www.ipma.pt/resources.www/transf/radar/por/'

const PRODUCTS = Object.freeze({
  COMPOSITE: Object.freeze({
    raw: false,
    layer: 'radar:composite',
    title: 'IPMA Radar Composite (Portugal)',
    description: 'IPMA national radar reflectivity composite, 5-minute cadence',
    kind: 'raster',
    units: 'reflectivity (IPMA native colour ramp)',
    period: 'PT5M',
    bounds: georefBounds(),
    attribution: '© IPMA',
    palette: 'IPMA native reflectivity ramp (~150 colours); not mapped to dBZ',
    nodata: 'transparent: no echo, or map furniture (coastline/borders)',
    observationOnly: true
  })
})

function timeoutSignal (ms) {
  return AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : (() => { const c = new AbortController(); setTimeout(() => c.abort(), ms).unref?.(); return c.signal })()
}

// IPMA frame timestamps ("YYYY-MM-DD HH:mm") carry no zone; treated as UTC.
function parseFrameEpoch (date) {
  const t = Date.parse(`${String(date).trim().replace(' ', 'T')}:00Z`)
  return Number.isFinite(t) ? t : Date.now()
}

class IpmaRadarProvider {
  constructor (cfg = {}) {
    this.id = 'ipma'
    this.name = 'IPMA Portugal Radar'
    this.attribution = '© IPMA'
    this.bounds = georefBounds()
    this.cfg = {
      metadataUrl: DEFAULT_METADATA_URL,
      imageBase: DEFAULT_IMAGE_BASE,
      requestTimeoutMs: 10000,
      frameCacheSeconds: 60,
      ...cfg
    }
    // product -> { fetchedAt, imageUrl, epochMs, raster }
    this._cache = new Map()
  }

  products () { return PRODUCTS }

  _assertProduct (product) {
    if (!PRODUCTS[product]) {
      throw new Error(`IPMA provider: unknown product '${product}' (have: ${Object.keys(PRODUCTS).join(', ')})`)
    }
  }

  // Resolve the current frame: metadata GET -> newest entry with a non-null
  // path -> absolute image URL. Cached for frameCacheSeconds so latest()+tile()
  // share one round-trip.
  async _resolveFrame (product) {
    const now = Date.now()
    const cached = this._cache.get(product)
    if (cached && (now - cached.fetchedAt) < this.cfg.frameCacheSeconds * 1000) return cached
    const r = await fetch(this.cfg.metadataUrl, {
      headers: { accept: 'application/json' },
      signal: timeoutSignal(this.cfg.requestTimeoutMs)
    })
    if (!r.ok) throw new Error(`IPMA metadata HTTP ${r.status}`)
    const meta = await r.json()
    const frames = meta && Array.isArray(meta.Portugal) ? meta.Portugal : null
    if (!frames) throw new Error('IPMA metadata: missing "Portugal" frame list')
    const current = frames.find((f) => f && f.path)
    if (!current) throw new Error('IPMA metadata: no published frame available')
    const base = this.cfg.imageBase.endsWith('/') ? this.cfg.imageBase : this.cfg.imageBase + '/'
    const frame = {
      fetchedAt: now,
      imageUrl: base + current.path,
      epochMs: parseFrameEpoch(current.date),
      raster: null
    }
    this._cache.set(product, frame)
    return frame
  }

  async latest (product) {
    this._assertProduct(product)
    const frame = await this._resolveFrame(product)
    return {
      product,
      time: new Date(frame.epochMs).toISOString(),
      epochMs: frame.epochMs,
      period: 'PT5M',
      source: this.id
    }
  }

  async _raster (product) {
    const frame = await this._resolveFrame(product)
    if (frame.raster) return frame.raster
    const r = await fetch(frame.imageUrl, {
      headers: { accept: 'image/png,image/*;q=0.8' },
      signal: timeoutSignal(this.cfg.requestTimeoutMs)
    })
    if (!r.ok) throw new Error(`IPMA image HTTP ${r.status}`)
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('image/png')) throw new Error(`IPMA image returned ${ct}`)
    const buffer = Buffer.from(await r.arrayBuffer())
    frame.raster = decodeEchoes(buffer)
    return frame.raster
  }

  async tile (product, tileRequest, time) {
    this._assertProduct(product)
    const bbox = Array.isArray(tileRequest) ? tileRequest : tileRequest && tileRequest.bbox3857
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      throw new Error('IPMA provider requires bbox3857 in the tile request')
    }
    const size = (tileRequest && tileRequest.size) || 256
    const cached = this._cache.get(product)
    if (time && time.epochMs && cached && time.epochMs < cached.epochMs - 5 * 60 * 1000) {
      throw new Error('IPMA provider does not support historical frames')
    }
    const raster = await this._raster(product)
    return renderTile(raster, bbox, size)
  }
}

module.exports = { IpmaRadarProvider, PRODUCTS, georefBounds, transparentPng }
