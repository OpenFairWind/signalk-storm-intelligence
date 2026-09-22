'use strict'

// AEMET regional radar reflectivity provider (Spain / western Mediterranean).
//
// Data source: AEMET OpenData REST API, product `red/radar/regional/{code}`.
// The API is a two-step handshake: a metadata request (carrying the API key)
// returns a short-lived, keyless `datos` URL that serves the actual product —
// a rendered palette GIF PPI reflectivity image. The API exposes only the most
// recent frame (no historical/time query), so this adapter is live-only and
// advertises neither `timeline` nor historical `tile(time)` support.
//
// Display tier only: `products/latest/tile`. The upstream product is a rendered
// image, so per the provider specification §7 this adapter deliberately does
// NOT advertise `downloadRaw`/`cellsFromRaw` (raw acquisition / cell inference).
//
// Licensing: © AEMET. Reuse and reproduction authorised citing AEMET as author
// (https://www.aemet.es/es/nota_legal). Attribution is surfaced in product
// metadata; callers must honour it and AEMET's terms for any caching/redistribution.

const { GEOREF, decodeReflectivity, renderTile, transparentPng, pxToLonLat } = require('./aemet-raster')

const DEFAULT_API_BASE = 'https://opendata.aemet.es/opendata/api'

// Coverage bounds [west, south, east, north] from the linear georef corners.
function georefBounds () {
  const [w, s] = pxToLonLat(0, GEOREF.height - 1)
  const [e, n] = pxToLonLat(GEOREF.width - 1, 0)
  return [w, s, e, n]
}

// Products = AEMET regional radar sites for which this adapter carries a
// georeference + static overlay mask. Product ids are upper-case per the
// runtime convention; the AEMET API radar code is the lower-cased id (used in
// the path `red/radar/regional/{code}`). Only Palma ('PM', Balearic Islands)
// is shipped today; sibling sites are a mechanical addition (derive the
// coastline georef + overlay mask for that site — see scripts/).
const PRODUCTS = Object.freeze({
  PM: Object.freeze({
    raw: false,
    layer: 'radar:pm',
    title: 'AEMET Radar Palma de Mallorca',
    description: 'AEMET single-site PPI reflectivity (Balearic Islands), ~240 km range',
    kind: 'raster',
    units: 'dBZ',
    period: 'PT10M',
    bounds: georefBounds(),
    attribution: '© AEMET',
    palette: 'reflectivity dBZ, 12..72 in 6 dBZ legend steps (quantised)',
    nodata: 'transparent: no echo, out-of-range, or map furniture',
    observationOnly: true
  })
})

function timeoutSignal (ms) {
  return AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : (() => { const c = new AbortController(); setTimeout(() => c.abort(), ms).unref?.(); return c.signal })()
}

// Coverage bounds [west, south, east, north] from the linear georef corners.
class AemetRadarProvider {
  constructor (cfg = {}) {
    this.id = 'aemet'
    this.name = 'AEMET Regional Radar (Spain)'
    this.attribution = '© AEMET'
    this.bounds = georefBounds()
    this.cfg = {
      apiBase: DEFAULT_API_BASE,
      apiKey: '',
      requestTimeoutMs: 15000,
      frameCacheSeconds: 120,
      ...cfg
    }
    // Injected GIF codec: (Buffer) -> { width, height, rgba: Uint8Array }.
    // Kept as a dependency so the deterministic core stays codec-free.
    this._decodeRGBA = cfg.decodeRGBA
    // Static overlay masks by product code (packed 1-bit, row-major) — the
    // coastline overlay shares the 48 dBZ colour and is removed by position.
    this._staticMasks = cfg.staticMasks || {}
    // Per-product frame cache: code -> { fetchedAt, datosUrl, epochMs, raster }.
    this._cache = new Map()
  }

  products () { return PRODUCTS }

  _assertProduct (product) {
    if (!PRODUCTS[product]) {
      throw new Error(`AEMET provider: unknown product '${product}' (have: ${Object.keys(PRODUCTS).join(', ')})`)
    }
  }

  // Floor an epoch to the product cadence (10 min). AEMET does not expose a
  // per-frame valid time in the API (it is burned into the image), so the
  // fetch time floored to the cadence is a best-effort observation time.
  _floorCadence (epochMs) {
    const p = 10 * 60 * 1000
    return Math.floor(epochMs / p) * p
  }

  // Resolve the current frame for a product: metadata GET (key) -> keyless
  // `datos` URL. Cached for frameCacheSeconds so latest()+tile() share one
  // round-trip.
  async _resolveFrame (product) {
    const now = Date.now()
    const cached = this._cache.get(product)
    if (cached && (now - cached.fetchedAt) < this.cfg.frameCacheSeconds * 1000) return cached
    const code = product.toLowerCase() // AEMET API radar code
    const url = new URL(`${this.cfg.apiBase}/red/radar/regional/${code}`)
    url.searchParams.set('api_key', this.cfg.apiKey)
    const r = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: timeoutSignal(this.cfg.requestTimeoutMs)
    })
    if (!r.ok) throw new Error(`AEMET API HTTP ${r.status}`) // never includes the key
    const meta = await r.json()
    if (!meta || meta.estado !== 200 || !meta.datos) {
      throw new Error(`AEMET API: no data (${meta && meta.descripcion ? meta.descripcion : 'unknown'})`)
    }
    const frame = {
      fetchedAt: now,
      datosUrl: meta.datos, // keyless short-lived URL
      epochMs: this._floorCadence(now),
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
      period: 'PT10M',
      source: this.id
    }
  }

  // Fetch + decode a product's current frame reflectivity grid (cached on the frame).
  async _raster (product) {
    const frame = await this._resolveFrame(product)
    if (frame.raster) return frame.raster
    const r = await fetch(frame.datosUrl, {
      headers: { accept: 'image/gif,image/*;q=0.8' },
      signal: timeoutSignal(this.cfg.requestTimeoutMs)
    })
    if (!r.ok) throw new Error(`AEMET data HTTP ${r.status}`)
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('image/gif')) throw new Error(`AEMET data returned ${ct}`)
    if (!this._decodeRGBA) throw new Error('AEMET provider: no GIF decoder configured')
    const buffer = Buffer.from(await r.arrayBuffer())
    frame.raster = decodeReflectivity(buffer, this._decodeRGBA, this._staticMasks[product] || null)
    return frame.raster
  }

  async tile (product, tileRequest, time) {
    this._assertProduct(product)
    const bbox = Array.isArray(tileRequest) ? tileRequest : tileRequest && tileRequest.bbox3857
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      throw new Error('AEMET provider requires bbox3857 in the tile request')
    }
    const size = (tileRequest && tileRequest.size) || 256
    // Live-only: an explicit historical time is not supported by the source.
    const cached = this._cache.get(product)
    if (time && time.epochMs && cached && time.epochMs < cached.epochMs - 10 * 60 * 1000) {
      throw new Error('AEMET provider does not support historical frames')
    }
    const raster = await this._raster(product)
    return renderTile(raster, bbox, size)
  }
}

module.exports = { AemetRadarProvider, PRODUCTS, georefBounds, transparentPng }
