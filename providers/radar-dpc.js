'use strict'
const { DpcProvider, PRODUCTS } = require('../lib/dpc-provider')

const defaults = Object.freeze({
  wmsBase: 'https://radar-geowebcache.protezionecivile.it/service/wms',
  apiBase: 'https://radar-api.protezionecivile.it',
  hrdBinaryBase: 'https://s3-prod-dpc-radar-webp-cache.s3.eu-south-1.amazonaws.com',
  origin: 'https://radar.protezionecivile.it'
})

module.exports = {
  id: 'radar-dpc',
  name: 'Italian Civil Protection Radar-DPC',
  products: PRODUCTS,
  defaults,
  legacyDefault: true,
  recommended: { enabled: true, display: ['VMI', 'SRI'], prefetch: ['VMI', 'SRI'], acquire: ['HRD'], stormSource: 'HRD' },
  settingsSchema: { properties: {
    wmsBase: { title: 'WMS endpoint', type: 'string', default: defaults.wmsBase },
    apiBase: { title: 'Product API endpoint', type: 'string', default: defaults.apiBase },
    hrdBinaryBase: { title: 'HRD binary product endpoint', type: 'string', default: defaults.hrdBinaryBase },
    origin: { title: 'HTTP Origin/Referer base', type: 'string', default: defaults.origin }
  } },
  create({ common, settings, rawSettings }) {
    // Legacy flat settings are consumed here, never by the generic core.
    return new DpcProvider({
      requestTimeoutMs: common.requestTimeoutMs,
      dpcWmsBase: rawSettings?.dpcWmsBase || settings.wmsBase,
      dpcApiBase: rawSettings?.dpcApiBase || settings.apiBase,
      dpcHrdBinaryBase: settings.hrdBinaryBase,
      dpcOrigin: rawSettings?.dpcOrigin || settings.origin
    })
  }
}
