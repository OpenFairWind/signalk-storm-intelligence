'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { assertObservationProvider } = require('./observation-provider-contract')

function validateAdapter(adapter, file = '<adapter>') {
  if (!adapter || typeof adapter !== 'object') throw new TypeError(`Invalid observation adapter ${file}`)
  if (typeof adapter.id !== 'string' || !adapter.id) throw new TypeError(`Observation adapter missing id in ${file}`)
  if (typeof adapter.create !== 'function') throw new TypeError(`Observation adapter ${adapter.id} missing create()`)
  return adapter
}

function discoverObservationAdapters(directory = path.join(__dirname, '..', 'observation-providers')) {
  const adapters = new Map()
  if (!fs.existsSync(directory)) return adapters

  for (const name of fs.readdirSync(directory).filter(entry => entry.endsWith('.js')).sort()) {
    const file = path.join(directory, name)
    const adapter = validateAdapter(require(file), file)
    if (adapters.has(adapter.id)) throw new Error(`Duplicate observation provider id: ${adapter.id}`)
    adapters.set(adapter.id, adapter)
  }
  return adapters
}

function defaultsFromObservationAdapters(adapters) {
  const enabledProviders = []
  for (const [id, adapter] of adapters) {
    if (adapter.recommended?.enabled) enabledProviders.push(id)
  }
  return { enabledProviders }
}

function observationProviderSettingsSchema(adapters) {
  const properties = {}
  for (const [id, adapter] of adapters) {
    properties[id] = {
      title: `${adapter.name || id} observation settings`,
      type: 'object',
      additionalProperties: false,
      properties: adapter.settingsSchema?.properties || {},
      default: adapter.defaults || {}
    }
  }
  return {
    title: 'Observation provider settings',
    type: 'object',
    additionalProperties: false,
    properties,
    default: {}
  }
}

function instantiateObservationAdapters(adapters, ids, common, settings) {
  const providers = new Map()
  for (const id of ids || []) {
    const adapter = adapters.get(id)
    if (!adapter) continue

    const provider = assertObservationProvider(adapter.create({
      common,
      settings: { ...(adapter.defaults || {}), ...(settings?.[id] || {}) }
    }))
    if (provider.id !== id) {
      throw new Error(`Observation adapter ${id} created provider with mismatched id ${provider.id}`)
    }
    providers.set(id, provider)
  }
  return providers
}

module.exports = {
  discoverObservationAdapters,
  defaultsFromObservationAdapters,
  observationProviderSettingsSchema,
  instantiateObservationAdapters,
  validateAdapter
}
