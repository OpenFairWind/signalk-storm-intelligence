'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { assertInferenceAlgorithm } = require('./inference-algorithm-contract')

function validateInferenceDefinition(definition, file = '<algorithm>') {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError(`Invalid inference algorithm definition in ${file}`)
  }
  if (typeof definition.id !== 'string' || !definition.id) {
    throw new TypeError(`Inference algorithm definition missing id in ${file}`)
  }
  if (typeof definition.create !== 'function') {
    throw new TypeError(`Inference algorithm ${definition.id} missing create()`)
  }
  return definition
}

function discoverInferenceAlgorithms(directory = path.join(__dirname, '..', 'inference-algorithms')) {
  const algorithms = new Map()
  if (!fs.existsSync(directory)) return algorithms

  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort()) {
    const fullPath = path.join(directory, file)
    const definition = validateInferenceDefinition(require(fullPath), fullPath)
    if (algorithms.has(definition.id)) {
      throw new Error(`Duplicate inference algorithm id: ${definition.id}`)
    }
    algorithms.set(definition.id, definition)
  }

  return algorithms
}

function instantiateInferenceAlgorithms(definitions, enabledIds, settings = {}, common = {}) {
  const algorithms = new Map()
  for (const id of enabledIds || []) {
    const definition = definitions.get(id)
    if (!definition) continue

    const algorithm = assertInferenceAlgorithm(definition.create({
      settings: { ...(definition.defaults || {}), ...(settings?.[id] || {}) },
      common
    }))
    if (algorithm.id !== id) {
      throw new Error(`Inference definition ${id} created algorithm with mismatched id ${algorithm.id}`)
    }
    algorithms.set(id, algorithm)
  }
  return algorithms
}

function inferenceSettingsSchema(definitions) {
  const properties = {}
  for (const [id, definition] of definitions) {
    properties[id] = {
      title: definition.name || id,
      type: 'object',
      additionalProperties: false,
      properties: definition.settingsSchema?.properties || {},
      default: Object.fromEntries(Object.entries(definition.defaults || {}).filter(([key]) => key !== 'enabled'))
    }
  }
  return {
    title: 'Inference algorithm settings',
    type: 'object',
    additionalProperties: false,
    properties
  }
}

module.exports = {
  discoverInferenceAlgorithms,
  instantiateInferenceAlgorithms,
  inferenceSettingsSchema,
  validateInferenceDefinition
}
