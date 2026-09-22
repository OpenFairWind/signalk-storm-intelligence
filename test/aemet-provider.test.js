'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const definition = require('../providers/aemet')
const { assertProvider, describeProvider, productCapabilities } = require('../lib/provider-contract')

test('definition shape matches the adapter contract', () => {
  assert.equal(definition.id, 'aemet')
  assert.equal(typeof definition.name, 'string')
  assert.equal(typeof definition.products, 'object')
  assert.ok(definition.products.PM, 'exposes the pm product statically')
  assert.equal(typeof definition.create, 'function')
  assert.equal(definition.recommended.enabled, false, 'opt-in (needs API key)')
})

test('created instance satisfies assertProvider and describes cleanly', () => {
  const p = definition.create({ common: { requestTimeoutMs: 15000 }, settings: { apiKey: 'test' } })
  assertProvider(p) // throws if id/name/products/latest/tile missing
  assert.equal(p.id, 'aemet')
  assert.equal(typeof p.latest, 'function')
  assert.equal(typeof p.tile, 'function')
  // Display-only: no raw acquisition / cell inference advertised (spec §7).
  assert.equal(typeof p.downloadRaw, 'undefined')
  assert.equal(typeof p.cellsFromRaw, 'undefined')

  const d = describeProvider(p)
  assert.equal(d.id, 'aemet')
  assert.ok(Array.isArray(d.bounds) && d.bounds.length === 4)
  const pm = d.products.PM
  assert.equal(pm.units, 'dBZ')
  assert.equal(pm.capabilities.map, true, 'raster display capable')
  assert.equal(pm.capabilities.raw, false, 'no raw acquisition')
  assert.equal(pm.capabilities.cells, false, 'no cell inference')
  assert.equal(pm.capabilities.temporal, true)
})

test('unknown product is rejected', async () => {
  const p = definition.create({ common: { requestTimeoutMs: 15000 }, settings: { apiKey: 'test' } })
  await assert.rejects(() => p.latest('zz'), /unknown product/)
  await assert.rejects(() => p.tile('zz', { bbox3857: [0, 0, 1, 1] }), /unknown product/)
})

test('tile requires a bbox3857', async () => {
  const p = definition.create({ common: { requestTimeoutMs: 15000 }, settings: { apiKey: 'test' } })
  await assert.rejects(() => p.tile('PM', {}), /bbox3857/)
})
