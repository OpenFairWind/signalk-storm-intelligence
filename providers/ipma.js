'use strict'

const { IpmaRadarProvider, PRODUCTS } = require('../lib/ipma-provider')

// IPMA national radar composite. Keyless public feed, so unlike AEMET there is
// no API key and no injected image codec: the palette PNG is decoded with
// Node's built-in zlib inside lib/ipma-raster.js.

const defaults = Object.freeze({
  metadataUrl: 'https://www.ipma.pt/resources.www/transf/radar/imgs-radar.json',
  imageBase: 'https://www.ipma.pt/resources.www/transf/radar/por/',
  frameCacheSeconds: 60
})

module.exports = {
  id: 'ipma',
  name: 'IPMA Portugal Radar',
  products: PRODUCTS,
  defaults,
  recommended: { enabled: false, display: [], prefetch: [], acquire: [] },
  settingsSchema: {
    properties: {
      metadataUrl: {
        title: 'IPMA radar metadata URL',
        type: 'string',
        default: defaults.metadataUrl
      },
      imageBase: {
        title: 'IPMA radar image base URL',
        type: 'string',
        default: defaults.imageBase
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
    return new IpmaRadarProvider({
      requestTimeoutMs: common.requestTimeoutMs,
      metadataUrl: settings.metadataUrl || defaults.metadataUrl,
      imageBase: settings.imageBase || defaults.imageBase,
      frameCacheSeconds: settings.frameCacheSeconds || defaults.frameCacheSeconds
    })
  }
}
