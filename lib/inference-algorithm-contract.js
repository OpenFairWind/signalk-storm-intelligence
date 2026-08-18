'use strict'

function assertInferenceAlgorithm(algorithm) {
  if (!algorithm || typeof algorithm !== 'object') throw new TypeError('Inference algorithm must be an object')
  if (!algorithm.id || typeof algorithm.id !== 'string') throw new TypeError('Inference algorithm id is required')
  if (!algorithm.name || typeof algorithm.name !== 'string') throw new TypeError(`Inference algorithm ${algorithm.id} name is required`)
  if (typeof algorithm.infer !== 'function') throw new TypeError(`Inference algorithm ${algorithm.id} must implement infer(context)`)
  return algorithm
}

function describeInferenceAlgorithm(algorithm) {
  assertInferenceAlgorithm(algorithm)
  return {
    id: algorithm.id,
    name: algorithm.name,
    version: algorithm.version || '1',
    description: algorithm.description || '',
    capabilities: algorithm.capabilities || {},
    weight: Number.isFinite(algorithm.weight) ? algorithm.weight : 1,
    model: algorithm.model || null
  }
}

module.exports = { assertInferenceAlgorithm, describeInferenceAlgorithm }
