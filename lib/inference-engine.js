'use strict'

const { describeInferenceAlgorithm } = require('./inference-algorithm-contract')

const STATE_RANK = Object.freeze({ normal: 0, warn: 1, alarm: 2 })

function stateOf(value) {
  return value?.threat?.state || value?.state || 'normal'
}

function mergeThreat(base, candidate, algorithm, strategy) {
  const baseThreat = base?.threat || {}
  const candidateThreat = candidate?.threat || {}
  const baseState = stateOf(base)
  const candidateState = stateOf(candidate)

  let state = baseState
  if (strategy === 'max-severity' && STATE_RANK[candidateState] > STATE_RANK[baseState]) {
    state = candidateState
  }

  const baseConfidence = Number(baseThreat.confidence) || 0
  const candidateConfidence = Number(candidateThreat.confidence) || 0
  const weight = Math.max(0, Number(algorithm.weight) || 1)
  const confidence = strategy === 'weighted-confidence'
    ? Math.min(1, (baseConfidence + candidateConfidence * weight) / (1 + weight))
    : Math.max(baseConfidence, candidateConfidence)

  return {
    ...baseThreat,
    ...candidateThreat,
    state,
    confidence,
    evidence: {
      ...(baseThreat.evidence || {}),
      ...(candidateThreat.evidence || {}),
      algorithms: {
        ...(baseThreat.evidence?.algorithms || {}),
        [algorithm.id]: {
          state: candidateState,
          confidence: candidateConfidence,
          method: candidateThreat.method || null
        }
      }
    }
  }
}

function mergeCells(baseCells, candidateCells, algorithm, strategy) {
  const byId = new Map((baseCells || []).map(cell => [cell.trackId || cell.id, cell]))

  for (const candidate of candidateCells || []) {
    const id = candidate.trackId || candidate.id
    if (!id) continue

    const previous = byId.get(id)
    if (!previous) {
      byId.set(id, candidate)
      continue
    }

    const threat = mergeThreat(previous, candidate, algorithm, strategy)
    byId.set(id, { ...previous, ...candidate, threat, state: threat.state })
  }

  return [...byId.values()]
}

class InferenceEngine {
  constructor(algorithms, { strategy = 'max-severity' } = {}) {
    this.algorithms = algorithms
    this.strategy = strategy
    this.lastRuns = []
  }

  async infer(context) {
    let cells = []
    this.lastRuns = []

    for (const [id, algorithm] of this.algorithms) {
      const started = Date.now()
      try {
        const result = await algorithm.infer({ ...context, baseCells: cells })
        const candidateCells = Array.isArray(result) ? result : result?.cells || []
        cells = mergeCells(cells, candidateCells, algorithm, this.strategy)
        this.lastRuns.push({
          id,
          ok: true,
          durationMs: Date.now() - started,
          count: candidateCells.length
        })
      } catch (error) {
        this.lastRuns.push({
          id,
          ok: false,
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return cells
  }

  describe() {
    return {
      strategy: this.strategy,
      algorithms: [...this.algorithms.values()].map(describeInferenceAlgorithm),
      lastRuns: this.lastRuns
    }
  }
}

module.exports = { InferenceEngine, mergeCells, mergeThreat, stateOf }
