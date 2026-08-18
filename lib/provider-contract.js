'use strict'

/**
 * Generic weather-radar mosaic provider contract. Only identity, product
 * discovery, latest-frame discovery and raster rendering are mandatory. tile(product, request, time) receives a normalized request with XYZ coordinates and bbox3857 so adapters can use native tiles or WMS without leaking either transport into the core.
 * Timeline, raw acquisition, cell extraction and forecast semantics are optional
 * capabilities advertised per product. No upstream provider semantics belong here.
 */
function assertProvider(provider) {
  const required = ['id', 'name', 'products', 'latest', 'tile']
  for (const key of required) {
    const value = provider?.[key]
    if ((key === 'id' || key === 'name') ? typeof value !== 'string' : typeof value !== 'function') {
      throw new TypeError(`Invalid weather-radar provider: missing ${key}`)
    }
  }
  return provider
}

function productCapabilities(provider, p) {
  return {
    map: p.map !== false && p.kind === 'raster' && typeof provider.tile === 'function',
    temporal: p.temporal !== false && typeof provider.latest === 'function',
    timeline: typeof provider.timeline === 'function' || !!p.period,
    raw: p.raw !== false && typeof provider.downloadRaw === 'function',
    cells: p.cells === true && typeof provider.cellsFromRaw === 'function',
    forecast: !!p.forecast
  }
}

function describeProvider(provider) {
  const products = provider.products()
  return {
    id: provider.id,
    name: provider.name,
    attribution: provider.attribution || null,
    bounds: provider.bounds || null,
    products: Object.fromEntries(Object.entries(products).map(([id, p]) => [id, {
      id,
      title: p.title,
      description: p.description,
      kind: p.kind,
      units: p.units || null,
      period: p.period || null,
      bounds: p.bounds || provider.bounds || null,
      minZoom: Number.isFinite(p.minZoom) ? p.minZoom : null,
      maxZoom: Number.isFinite(p.maxZoom) ? p.maxZoom : null,
      capabilities: productCapabilities(provider, p)
    }]))
  }
}

module.exports = { assertProvider, describeProvider, productCapabilities }
