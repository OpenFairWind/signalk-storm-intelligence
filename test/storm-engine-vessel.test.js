'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { StormEngine } = require('../lib/storm-engine')

const NM = 1852
const CFG = { warnDistanceM: 20 * NM, alarmDistanceM: 8 * NM, warnSeverity: 3, alarmSeverity: 4 }
const stateOf = v => v?.threat?.state || v?.state || 'normal'

// A single severe cell whose polygon sits ~33 NM north of (2.50, 39.30).
function farCellSnapshot () {
  return {
    epochMs: 1700000000000,
    features: [{
      type: 'Feature',
      properties: { severity: 4 },
      geometry: { type: 'Polygon', coordinates: [[[2.45, 39.85], [2.55, 39.85], [2.55, 39.95], [2.45, 39.95], [2.45, 39.85]]] }
    }]
  }
}

test('far cell is normal with plain {latitude,longitude} position', () => {
  const r = new StormEngine(CFG).evaluate(farCellSnapshot(), { position: { latitude: 39.30, longitude: 2.50 } })
  assert.equal(stateOf(r[0]), 'normal')
  assert.ok(Number.isFinite(r[0].distanceMeters) && r[0].distanceMeters > 40000, 'finite distance computed')
})

test('node-form position {value:{...}} is unwrapped and yields the same result (no false alarm)', () => {
  const plain = new StormEngine(CFG).evaluate(farCellSnapshot(), { position: { latitude: 39.30, longitude: 2.50 } })
  const node = new StormEngine(CFG).evaluate(farCellSnapshot(), { position: { value: { latitude: 39.30, longitude: 2.50 }, timestamp: 't' } })
  assert.equal(stateOf(node[0]), 'normal', 'node-form must not spuriously alarm')
  assert.ok(Number.isFinite(node[0].distanceMeters), 'node-form yields a finite distance')
  assert.equal(Math.round(node[0].distanceMeters), Math.round(plain[0].distanceMeters), 'node-form == plain-form')
})

test('position without finite coordinates degrades safely to normal (no false alarm)', () => {
  for (const bad of [{ position: {} }, { position: null }, {}, { position: { latitude: 39.3 } }, { position: { value: {} } }]) {
    const r = new StormEngine(CFG).evaluate(farCellSnapshot(), bad)
    assert.equal(stateOf(r[0]), 'normal', `bad position ${JSON.stringify(bad)} -> normal`)
    assert.equal(r[0].distanceMeters, null, 'no distance is fabricated')
  }
})

test('a genuinely close severe cell still raises the alarm', () => {
  const snap = {
    epochMs: 1700000000000,
    features: [{
      type: 'Feature',
      properties: { severity: 5 },
      geometry: { type: 'Polygon', coordinates: [[[2.49, 39.29], [2.51, 39.29], [2.51, 39.31], [2.49, 39.31], [2.49, 39.29]]] }
    }]
  }
  const r = new StormEngine(CFG).evaluate(snap, { position: { value: { latitude: 39.30, longitude: 2.50 }, timestamp: 't' } })
  assert.equal(stateOf(r[0]), 'alarm', 'a cell at the vessel must alarm even from node-form position')
})
