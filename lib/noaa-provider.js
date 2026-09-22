'use strict'

// NOAA NEXRAD (United States) base-reflectivity mosaic provider.
//
// Data source: the NWS NEXRAD national mosaic served as web-map (EPSG:3857)
// XYZ tiles by the Iowa State University / Iowa Environmental Mesonet (IEM)
// tile cache — keyless and already reprojected, so this adapter is a plain XYZ
// passthrough (like RainViewer) with no image decode or georeferencing. The
// cache serves the current composite (~5-minute cadence); there is no
// per-frame query, so the adapter is live-only and advertises no historical
// tile(time) or timeline.
//
// Display tier only (products/latest/tile): the upstream tile is a rendered
// N0Q reflectivity image, so no downloadRaw/cellsFromRaw — same stance as the
// AEMET/IPMA adapters.
//
// Licensing: NWS/NOAA NEXRAD data is US public-domain; tiles courtesy of the
// Iowa Environmental Mesonet (IEM). Attribution surfaced in product metadata.

const DEFAULT_TILE_URL = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'
// Continental US coverage hint [west, south, east, north].
const CONUS_BOUNDS = [-127.5, 20.0, -66.0, 51.0]

const PRODUCTS = Object.freeze({
  COMPOSITE: Object.freeze({
    raw: false,
    layer: 'radar:composite',
    title: 'NOAA NEXRAD Composite (US)',
    description: 'NWS NEXRAD base reflectivity mosaic (CONUS) via Iowa State Mesonet, ~5-minute cadence',
    kind: 'raster',
    units: 'reflectivity (NEXRAD N0Q colour ramp)',
    period: 'PT5M',
    bounds: CONUS_BOUNDS,
    attribution: '© NOAA/NWS NEXRAD — Iowa State Mesonet (IEM)',
    minZoom: 0,
    maxZoom: 10,
    observationOnly: true
  })
})

function timeoutSignal (ms) {
  return AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : (() => { const c = new AbortController(); setTimeout(() => c.abort(), ms).unref?.(); return c.signal })()
}

class NoaaRadarProvider {
  constructor (cfg = {}) {
    this.id = 'noaa'
    this.name = 'NOAA NEXRAD Radar (US)'
    this.attribution = '© NOAA/NWS NEXRAD — Iowa State Mesonet (IEM)'
    this.bounds = CONUS_BOUNDS
    this.cfg = {
      tileUrl: DEFAULT_TILE_URL,
      requestTimeoutMs: 10000,
      ...cfg
    }
  }

  products () { return PRODUCTS }

  _assertProduct (product) {
    if (!PRODUCTS[product]) {
      throw new Error(`NOAA provider: unknown product '${product}' (have: ${Object.keys(PRODUCTS).join(', ')})`)
    }
  }

  _floorCadence (epochMs) {
    const p = 5 * 60 * 1000
    return Math.floor(epochMs / p) * p
  }

  async latest (product) {
    this._assertProduct(product)
    const epochMs = this._floorCadence(Date.now())
    return {
      product,
      time: new Date(epochMs).toISOString(),
      epochMs,
      period: 'PT5M',
      source: this.id
    }
  }

  // XYZ passthrough: fetch the upstream web-mercator tile and return its bytes.
  async tile (product, tileRequest) {
    this._assertProduct(product)
    const { z, x, y } = tileRequest || {}
    if (![z, x, y].every(Number.isInteger)) {
      throw new Error('NOAA provider requires XYZ tile coordinates')
    }
    const url = this.cfg.tileUrl
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
    const r = await fetch(url, {
      headers: { accept: 'image/png,image/*;q=0.8', 'user-agent': 'signalk-storm-intelligence' },
      signal: timeoutSignal(this.cfg.requestTimeoutMs)
    })
    if (!r.ok) throw new Error(`NOAA tile HTTP ${r.status}`)
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('image/png')) throw new Error(`NOAA tile returned ${ct}`)
    return Buffer.from(await r.arrayBuffer())
  }
}

module.exports = { NoaaRadarProvider, PRODUCTS, CONUS_BOUNDS }
