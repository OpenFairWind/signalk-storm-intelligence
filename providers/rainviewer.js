'use strict'

const { RainViewerProvider, RAINVIEWER_PRODUCTS } = require('../lib/rainviewer-provider')

const defaults = Object.freeze({
  metadataUrl: 'https://api.rainviewer.com/public/weather-maps.json',
  metadataCacheSeconds: 60,
  tileSize: 256,
  colorScheme: 2,
  smooth: true,
  showSnow: true
})

module.exports = {
  id: 'rainviewer',
  name: 'RainViewer Global Radar',
  products: RAINVIEWER_PRODUCTS,
  defaults,
  recommended: { enabled: true, display: [], prefetch: [], acquire: [] },
  settingsSchema: { properties: {
    metadataUrl: { title: 'Weather Maps API URL', type: 'string', default: defaults.metadataUrl },
    metadataCacheSeconds: { title: 'Metadata cache (seconds)', type: 'integer', minimum: 15, maximum: 3600, default: defaults.metadataCacheSeconds },
    tileSize: { title: 'Tile size', type: 'integer', enum: [256, 512], default: defaults.tileSize },
    colorScheme: { title: 'Color scheme', type: 'integer', minimum: 0, maximum: 8, default: defaults.colorScheme },
    smooth: { title: 'Smooth radar pixels', type: 'boolean', default: defaults.smooth },
    showSnow: { title: 'Render snow separately', type: 'boolean', default: defaults.showSnow }
  } },
  create({ common, settings }) {
    return new RainViewerProvider({
      requestTimeoutMs: common.requestTimeoutMs,
      metadataUrl: settings.metadataUrl,
      metadataCacheSeconds: settings.metadataCacheSeconds,
      tileSize: settings.tileSize,
      colorScheme: settings.colorScheme,
      smooth: settings.smooth,
      showSnow: settings.showSnow
    })
  }
}
