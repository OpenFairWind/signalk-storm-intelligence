'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { GifReader } = require('omggif')
const { AemetRadarProvider, PRODUCTS } = require('../lib/aemet-provider')

// GIF -> RGBA. omggif is a single-file, zero-dependency GIF codec; the AEMET
// product is a palette GIF and needs a decoder the runtime does not otherwise
// carry. Kept here (a provider concern) so lib/aemet-raster.js stays codec-free.
function decodeRGBA (buffer) {
  const reader = new GifReader(buffer)
  const rgba = new Uint8Array(reader.width * reader.height * 4)
  reader.decodeAndBlitFrameRGBA(0, rgba)
  return { width: reader.width, height: reader.height, rgba }
}

// Static overlay masks by product code (packed 1-bit, row-major). The coastline
// overlay shares the 48 dBZ colour, so its fixed pixel positions are shipped as
// an asset and removed at decode time. A missing asset just means the coastline
// may render as 48 dBZ; the provider still works.
function loadMasks () {
  const masks = {}
  for (const product of Object.keys(PRODUCTS)) {
    try {
      const code = product.toLowerCase() // asset filename uses the API radar code
      masks[product] = fs.readFileSync(path.join(__dirname, '..', 'assets', `aemet-${code}-mask.bin`))
    } catch { /* no mask asset for this product */ }
  }
  return masks
}

const defaults = Object.freeze({
  apiBase: 'https://opendata.aemet.es/opendata/api',
  frameCacheSeconds: 120
})

module.exports = {
  id: 'aemet',
  name: 'AEMET Regional Radar (Spain)',
  products: PRODUCTS,
  defaults,
  recommended: { enabled: false, display: [], prefetch: [], acquire: [] },
  settingsSchema: {
    properties: {
      apiKey: {
        title: 'AEMET OpenData API key',
        description: 'Free key from https://opendata.aemet.es. Sent only to AEMET; never placed in tile/chart URLs.',
        type: 'string',
        default: ''
      },
      frameCacheSeconds: {
        title: 'Frame cache (seconds)',
        type: 'integer',
        minimum: 30,
        maximum: 600,
        default: defaults.frameCacheSeconds
      }
    }
  },
  create ({ common, settings }) {
    return new AemetRadarProvider({
      requestTimeoutMs: common.requestTimeoutMs,
      apiBase: settings.apiBase || defaults.apiBase,
      apiKey: settings.apiKey,
      frameCacheSeconds: settings.frameCacheSeconds || defaults.frameCacheSeconds,
      decodeRGBA,
      staticMasks: loadMasks()
    })
  }
}
