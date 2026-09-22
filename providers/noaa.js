'use strict'

const { NoaaRadarProvider, PRODUCTS } = require('../lib/noaa-provider')

// NOAA NEXRAD (US) via the Iowa Environmental Mesonet XYZ tile cache. Keyless
// web-mercator passthrough — no API key and no injected image codec.

const defaults = Object.freeze({
  tileUrl: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'
})

module.exports = {
  id: 'noaa',
  name: 'NOAA NEXRAD Radar (US)',
  products: PRODUCTS,
  defaults,
  recommended: { enabled: false, display: [], prefetch: [], acquire: [] },
  settingsSchema: {
    properties: {
      tileUrl: {
        title: 'NEXRAD XYZ tile URL template',
        description: 'Web-mercator {z}/{x}/{y} PNG tiles. Default: Iowa State Mesonet nexrad-n0q.',
        type: 'string',
        default: defaults.tileUrl
      }
    }
  },
  create ({ common, settings }) {
    return new NoaaRadarProvider({
      requestTimeoutMs: common.requestTimeoutMs,
      tileUrl: settings.tileUrl || defaults.tileUrl
    })
  }
}
