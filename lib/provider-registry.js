'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { assertProvider } = require('./provider-contract')

function validateAdapter(adapter, file = '<adapter>') {
  if (!adapter || typeof adapter !== 'object') throw new TypeError(`Invalid weather-radar adapter in ${file}`)
  if (typeof adapter.id !== 'string' || !adapter.id) throw new TypeError(`Weather-radar adapter missing id in ${file}`)
  if (typeof adapter.create !== 'function') throw new TypeError(`Weather-radar adapter ${adapter.id} missing create()`)
  if (!adapter.products || typeof adapter.products !== 'object') throw new TypeError(`Weather-radar adapter ${adapter.id} missing products catalog`)
  return adapter
}

function discoverAdapters(directory = path.join(__dirname, '..', 'providers')) {
  const adapters = new Map()
  for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.js')).sort()) {
    const file = path.join(directory, name)
    const adapter = validateAdapter(require(file), file)
    if (adapters.has(adapter.id)) throw new Error(`Duplicate weather-radar provider adapter id: ${adapter.id}`)
    adapters.set(adapter.id, adapter)
  }
  return adapters
}

function knownProducts(adapters) {
  return Object.fromEntries([...adapters].map(([id, a]) => [id, a.products]))
}

function defaultsFromAdapters(adapters) {
  const enabledProviders = [], displayLayers = [], acquisitionTargets = [], prefetchTargets = []
  let stormSource = null
  for (const [id, adapter] of adapters) {
    const r = adapter.recommended || {}
    if (r.enabled !== false) enabledProviders.push(id)
    for (const p of r.display || []) displayLayers.push(`${id}:${String(p).toUpperCase()}`)
    for (const p of r.acquire || []) acquisitionTargets.push(`${id}:${String(p).toUpperCase()}`)
    for (const p of r.prefetch || r.display || []) prefetchTargets.push(`${id}:${String(p).toUpperCase()}`)
    if (!stormSource && r.stormSource) stormSource = `${id}:${String(r.stormSource).toUpperCase()}`
  }
  return { enabledProviders, displayLayers, acquisitionTargets, prefetchTargets, stormSource }
}

function providerSettingsSchema(adapters) {
  const properties = {}
  for (const [id, adapter] of adapters) {
    properties[id] = {
      title: `${adapter.name || id} provider settings`,
      type: 'object',
      additionalProperties: false,
      properties: adapter.settingsSchema?.properties || {},
      default: adapter.defaults || {}
    }
  }
  return { title: 'Provider-specific settings', type: 'object', additionalProperties: false, properties, default: {} }
}

function instantiateAdapters(adapters, enabledIds, commonCfg, providerSettings, rawSettings) {
  const providers = new Map()
  for (const id of enabledIds) {
    const adapter = adapters.get(id)
    if (!adapter) continue
    const settings = { ...(adapter.defaults || {}), ...(providerSettings?.[id] || {}) }
    const provider = assertProvider(adapter.create({ common: commonCfg, settings, rawSettings }))
    if (provider.id !== id) throw new Error(`Adapter ${id} created provider with mismatched id ${provider.id}`)
    providers.set(id, provider)
  }
  return providers
}

module.exports = { discoverAdapters, knownProducts, defaultsFromAdapters, providerSettingsSchema, instantiateAdapters, validateAdapter }
