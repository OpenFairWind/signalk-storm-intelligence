'use strict'

const { describeInferenceAlgorithm } = require('./inference-algorithm-contract')
const STATE_RANK = Object.freeze({ normal: 0, warn: 1, alarm: 2 })
const RANK_STATE = Object.freeze(['normal', 'warn', 'alarm'])

function finiteNumber(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
function algorithmWeight(algorithm) { return Math.max(0, Math.min(5, finiteNumber(algorithm?.weight, 1))) }
function stateOf(value) { return value?.threat?.state || value?.state || 'normal' }
function contribution(candidate, algorithm) {
  const threat = candidate?.threat || {}
  return { state: stateOf(candidate), confidence: Math.max(0, Math.min(1, finiteNumber(threat.confidence, 0))), method: threat.method || null, weight: algorithmWeight(algorithm) }
}

function aggregateThreat(base, candidate, algorithm, strategy) {
  const baseThreat = base?.threat || {}, candidateThreat = candidate?.threat || {}
  const algorithms = { ...(baseThreat.evidence?.algorithms || {}), [algorithm.id]: contribution(candidate, algorithm) }
  const weighted = Object.values(algorithms).filter(item => item.weight > 0)
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  let state, confidence
  if (strategy === 'weighted-confidence') {
    confidence = totalWeight > 0 ? weighted.reduce((sum, item) => sum + item.confidence * item.weight, 0) / totalWeight : 0
    // Preserve the most severe positively weighted categorical state. Confidence
    // is averaged, but must not silently lower a detector's safety state.
    state = RANK_STATE[weighted.reduce((rank, item) => Math.max(rank, STATE_RANK[item.state] ?? 0), 0)]
  } else {
    state = RANK_STATE[Math.max(STATE_RANK[stateOf(base)] ?? 0, STATE_RANK[stateOf(candidate)] ?? 0)]
    confidence = Math.max(...Object.values(algorithms).map(item => item.confidence), 0)
  }
  return { ...baseThreat, ...candidateThreat, state, confidence: Math.max(0, Math.min(1, confidence)), evidence: { ...(baseThreat.evidence || {}), ...(candidateThreat.evidence || {}), algorithms } }
}

function mergeThreat(base, candidate, algorithm, strategy) { return aggregateThreat(base, candidate, algorithm, strategy) }
function mergeCells(baseCells, candidateCells, algorithm, strategy) {
  const byId = new Map((baseCells || []).map(cell => [cell.trackId || cell.id, cell]))
  for (const candidate of candidateCells || []) {
    const id = candidate.trackId || candidate.id
    if (!id) continue
    const previous = byId.get(id)
    const threat = aggregateThreat(previous || {}, candidate, algorithm, strategy)
    byId.set(id, { ...(previous || {}), ...candidate, threat, state: threat.state })
  }
  return [...byId.values()]
}

function isDetector(algorithm) { return algorithm?.capabilities?.detector !== false && algorithm?.capabilities?.candidateRefiner !== true }
function cycleHealth(runs, cellCount) {
  const failures = runs.filter(run => !run.ok), authoritative = runs.some(run => run.detector && run.ok)
  const state = !authoritative ? 'unavailable' : failures.length ? 'degraded' : cellCount ? 'healthy' : 'no-candidates'
  return { state, authoritative, usable: authoritative, candidateCount: cellCount, failedAlgorithms: failures.map(run => run.id) }
}

class InferenceEngine {
  constructor(algorithms, { strategy = 'max-severity' } = {}) {
    this.algorithms = algorithms; this.strategy = strategy; this.lastRuns = []
    this.lastHealth = { state: 'unavailable', authoritative: false, usable: false, candidateCount: 0, failedAlgorithms: [] }
  }
  async infer(context) {
    let cells = []; this.lastRuns = []
    for (const [id, algorithm] of this.algorithms) {
      const started = Date.now(), detector = isDetector(algorithm)
      try {
        const result = await algorithm.infer({ ...context, baseCells: cells })
        const candidateCells = Array.isArray(result) ? result : result?.cells || []
        cells = mergeCells(cells, candidateCells, algorithm, this.strategy)
        this.lastRuns.push({ id, ok: true, detector, durationMs: Date.now() - started, count: candidateCells.length })
      } catch (error) {
        this.lastRuns.push({ id, ok: false, detector, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) })
      }
    }
    this.lastHealth = cycleHealth(this.lastRuns, cells.length)
    return cells
  }
  describe() { return { strategy: this.strategy, health: this.lastHealth, algorithms: [...this.algorithms.values()].map(describeInferenceAlgorithm), lastRuns: this.lastRuns } }
}

module.exports = { InferenceEngine, mergeCells, mergeThreat, stateOf, algorithmWeight, cycleHealth }
