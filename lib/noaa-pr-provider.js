'use strict'

// NOAA NEXRAD Puerto Rico / US Virgin Islands base-reflectivity provider.
//
// The CONUS XYZ mosaic (lib/noaa-provider.js) does not reach Puerto Rico, so
// this adapter draws the TJUA (San Juan) coverage from the Iowa Environmental
// Mesonet WMS `nexrad-n0q` layer, which spans the full NWS network including
// the Caribbean territories. It is a WMS GetMap adapter: the generic tile
// request carries `bbox3857`, so the core stays free of WMS specifics (see the
// provider contract). Keyless, live-only, display tier only.
//
// Licensing: NWS/NOAA NEXRAD is US public-domain; imagery via the Iowa
// Environmental Mesonet (IEM).

// Puerto Rico + USVI + nearby approaches [west, south, east, north].
const PR_BOUNDS = [-68.5, 16.5, -63.5, 19.8]
const DEFAULT_WMS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi'

const PRODUCTS = Object.freeze({
  PR: Object.freeze({
    raw: false,
    layer: 'radar:pr',
    title: 'NOAA NEXRAD Puerto Rico (TJUA)',
    description: 'NWS NEXRAD base reflectivity over Puerto Rico / USVI via Iowa State Mesonet WMS, ~5-minute cadence',
    kind: 'raster',
    units: 'reflectivity (NEXRAD N0Q colour ramp)',
    period: 'PT5M',
    bounds: PR_BOUNDS,
    attribution: '© NOAA/NWS NEXRAD — Iowa State Mesonet (IEM)',
    minZoom: 0,
    maxZoom: 11,
    observationOnly: true
  })
})

function timeoutSignal (ms) {
  return AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : (() => { const c = new AbortController(); setTimeout(() => c.abort(), ms).unref?.(); return c.signal })()
}

class NoaaPrRadarProvider {
  constructor (cfg = {}) {
    this.id = 'noaa-pr'
    this.name = 'NOAA NEXRAD Puerto Rico'
    this.attribution = '© NOAA/NWS NEXRAD — Iowa State Mesonet (IEM)'
    this.bounds = PR_BOUNDS
    this.cfg = {
      wmsUrl: DEFAULT_WMS_URL,
      layer: 'nexrad-n0q',
      requestTimeoutMs: 12000,
      ...cfg
    }
  }

  products () { return PRODUCTS }

  _assertProduct (product) {
    if (!PRODUCTS[product]) {
      throw new Error(`NOAA-PR provider: unknown product '${product}' (have: ${Object.keys(PRODUCTS).join(', ')})`)
    }
  }

  _floorCadence (epochMs) {
    const p = 5 * 60 * 1000
    return Math.floor(epochMs / p) * p
  }

  async latest (product) {
    this._assertProduct(product)
    const epochMs = this._floorCadence(Date.now())
    return { product, time: new Date(epochMs).toISOString(), epochMs, period: 'PT5M', source: this.id }
  }

  // WMS GetMap over the requested web-mercator bbox. WMS 1.1.1 keeps the
  // EPSG:3857 axis order as minx,miny,maxx,maxy (no 1.3.0 axis swap).
  async tile (product, tileRequest) {
    this._assertProduct(product)
    const bbox = Array.isArray(tileRequest) ? tileRequest : tileRequest && tileRequest.bbox3857
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      throw new Error('NOAA-PR provider requires bbox3857 in the tile request')
    }
    const size = (tileRequest && tileRequest.size) || 256
    const u = new URL(this.cfg.wmsUrl)
    const q = u.searchParams
    q.set('service', 'WMS'); q.set('version', '1.1.1'); q.set('request', 'GetMap')
    q.set('layers', this.cfg.layer); q.set('styles', '')
    q.set('format', 'image/png'); q.set('transparent', 'true')
    q.set('srs', 'EPSG:3857')
    q.set('width', String(size)); q.set('height', String(size))
    q.set('bbox', bbox.join(','))
    const r = await fetch(u, {
      headers: { accept: 'image/png,image/*;q=0.8', 'user-agent': 'signalk-storm-intelligence' },
      signal: timeoutSignal(this.cfg.requestTimeoutMs)
    })
    if (!r.ok) throw new Error(`NOAA-PR WMS HTTP ${r.status}`)
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('image/png')) throw new Error(`NOAA-PR WMS returned ${ct}`)
    return Buffer.from(await r.arrayBuffer())
  }
}

module.exports = { NoaaPrRadarProvider, PRODUCTS, PR_BOUNDS }
