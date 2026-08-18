'use strict'
const { DwdProvider, DWD_PRODUCTS } = require('../lib/dwd-provider')

const defaults = Object.freeze({
  wmsBase: 'https://maps.dwd.de/geoserver/dwd/wms',
  capabilitiesCacheSeconds: 60
})

module.exports = {
  id: 'dwd',
  name: 'Deutscher Wetterdienst (DWD)',
  products: DWD_PRODUCTS,
  defaults,
  recommended: { enabled: true, display: [], prefetch: [], acquire: [] },
  settingsSchema: { properties: {
    wmsBase: { title: 'WMS endpoint', type: 'string', default: defaults.wmsBase },
    capabilitiesCacheSeconds: { title: 'Capabilities cache (seconds)', type: 'integer', minimum: 15, maximum: 3600, default: 60 }
  } },
  create({ common, settings, rawSettings }) {
    return new DwdProvider({
      requestTimeoutMs: common.requestTimeoutMs,
      dwdWmsBase: rawSettings?.dwdWmsBase || settings.wmsBase,
      dwdCapabilitiesCacheSeconds: rawSettings?.dwdCapabilitiesCacheSeconds || settings.capabilitiesCacheSeconds
    })
  }
}
