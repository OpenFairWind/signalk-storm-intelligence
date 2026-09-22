'use strict'

const { NoaaPrRadarProvider, PRODUCTS } = require('../lib/noaa-pr-provider')

// NOAA NEXRAD Puerto Rico / USVI via the Iowa Environmental Mesonet WMS
// (keyless). Separate from the CONUS provider (providers/noaa.js) because the
// CONUS XYZ mosaic does not reach the Caribbean territories.

const defaults = Object.freeze({
  wmsUrl: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi',
  layer: 'nexrad-n0q'
})

module.exports = {
  id: 'noaa-pr',
  name: 'NOAA NEXRAD Puerto Rico',
  products: PRODUCTS,
  defaults,
  recommended: { enabled: false, display: [], prefetch: [], acquire: [] },
  settingsSchema: {
    properties: {
      wmsUrl: { title: 'NEXRAD WMS endpoint', type: 'string', default: defaults.wmsUrl },
      layer: { title: 'WMS layer', type: 'string', default: defaults.layer }
    }
  },
  create ({ common, settings }) {
    return new NoaaPrRadarProvider({
      requestTimeoutMs: common.requestTimeoutMs,
      wmsUrl: settings.wmsUrl || defaults.wmsUrl,
      layer: settings.layer || defaults.layer
    })
  }
}
