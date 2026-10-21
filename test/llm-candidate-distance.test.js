'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const def = require('../inference-algorithms/llm-openai-compatible')

const NM = 1852
const geometry = { type: 'Polygon', coordinates: [[[14, 40], [14.1, 40], [14.1, 40.1], [14, 40.1], [14, 40]]] }

// Mock Responses API: assesses every candidate it is sent as 'warn' and records the ids.
function mockFetch(sent) {
  return async (url, init) => {
    const request = JSON.parse(JSON.parse(init.body).input)
    const ids = request.candidates.map(c => c.id)
    sent.push(ids)
    const assessments = ids.map(id => ({ id, state: 'warn', confidence: 0.9, uncertainty: 'low', summary: 'ok', factors: [] }))
    return {
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({ id: 'r1', model: 'mock-model', usage: {}, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ assessments }) }] }] })
    }
  }
}

function cell(trackId, distanceNm, extra = {}) {
  return { trackId, geometry, severity: 3, distanceMeters: distanceNm * NM, motion: { speed: 10, confidence: 0.8 }, threat: { state: 'normal', confidence: 0.5, evidence: {} }, ...extra }
}

function context(baseCells) {
  return { baseCells, vessel: { position: { latitude: 40, longitude: 14 } }, config: { horizonMinutes: 60 }, lightningStrikes: [], environmentContext: { available: false }, weatherApiContext: { available: false }, now: Date.now() }
}

function create(settings, sent) {
  return def.create({ settings: { model: 'mock-model', baseUrl: 'https://example.invalid/v1', apiKeyEnv: '', requireApiKey: false, ...settings }, common: { fetch: mockFetch(sent) } })
}

test('LLM only assesses candidates within 40 NM by default', async () => {
  const sent = []
  const rows = await create({}, sent).infer(context([cell('near', 12), cell('far', 140), cell('edge', 40)]))
  assert.equal(sent.length, 1)
  assert.deepEqual(rows.map(r => r.trackId).sort(), ['edge', 'near'])
  assert.ok(rows.every(r => r.llm.accepted))
})

test('LLM assesses a far candidate predicted to come within range', async () => {
  const sent = []
  const rows = await create({}, sent).infer(context([
    cell('path', 90, { pathThreat: { minDistanceMeters: 15 * NM, intersects: false } }),
    cell('closing', 90, { cpa: { dcpaMeters: 30 * NM, closing: true } }),
    cell('opening', 90, { cpa: { dcpaMeters: 30 * NM, closing: false } })
  ]))
  assert.deepEqual(rows.map(r => r.trackId).sort(), ['closing', 'path'])
})

test('LLM makes no request when every candidate is beyond the limit', async () => {
  const sent = []
  const rows = await create({ maxCandidateDistanceNm: 20 }, sent).infer(context([cell('a', 60), cell('b', 180)]))
  assert.equal(sent.length, 0)
  assert.deepEqual(rows, [])
})

test('maxCandidateDistanceNm 0 assesses every candidate', async () => {
  const sent = []
  const rows = await create({ maxCandidateDistanceNm: 0 }, sent).infer(context([cell('a', 60), cell('b', 180)]))
  assert.equal(rows.length, 2)
})

test('a candidate without any distance is still assessed', async () => {
  const sent = []
  const rows = await create({}, sent).infer(context([{ trackId: 'unknown', geometry, severity: 3, threat: { state: 'normal', confidence: 0.5, evidence: {} } }]))
  assert.equal(rows.length, 1)
})

test('candidates left out keep the state the other algorithms gave them', async () => {
  const { InferenceEngine } = require('../lib/inference-engine')
  const sent = []
  const detector = { id: 'detector', weight: 1, capabilities: { detector: true }, infer: async () => [cell('near', 10), cell('far', 150, { threat: { state: 'warn', confidence: 0.7, evidence: {} }, state: 'warn' })] }
  const engine = new InferenceEngine(new Map([['detector', detector], ['llm', create({}, sent)]]))
  const cells = await engine.infer(context([]))
  const far = cells.find(c => c.trackId === 'far')
  assert.equal(far.state, 'warn')
  assert.equal(far.llm, undefined)
  assert.equal(cells.find(c => c.trackId === 'near').llm.accepted, true)
})
