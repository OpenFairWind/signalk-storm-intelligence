'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NoaaRadarProvider, PRODUCTS, CONUS_BOUNDS } = require('../lib/noaa-provider')

function withStubFetch (impl, fn) {
  const orig = globalThis.fetch
  globalThis.fetch = impl
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = orig })
}
const pngResponse = () => ({
  ok: true,
  headers: { get: () => 'image/png' },
  arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer
})

test('products advertises a display-only COMPOSITE over CONUS', () => {
  const p = new NoaaRadarProvider()
  const c = PRODUCTS.COMPOSITE
  assert.equal(c.kind, 'raster')
  assert.equal(c.observationOnly, true)
  assert.equal(c.raw, false)
  assert.deepEqual(c.bounds, CONUS_BOUNDS)
})

test('latest floors to the 5-minute cadence and is UTC ISO', () => {
  const p = new NoaaRadarProvider()
  return p.latest('COMPOSITE').then((l) => {
    assert.equal(l.period, 'PT5M')
    assert.equal(l.source, 'noaa')
    assert.equal(l.epochMs % (5 * 60 * 1000), 0)
    assert.equal(new Date(l.epochMs).toISOString(), l.time)
  })
})

test('unknown product throws', async () => {
  const p = new NoaaRadarProvider()
  await assert.rejects(() => p.latest('NOPE'), /unknown product/)
})

test('tile substitutes z/x/y into the URL template and returns the bytes', () => {
  let seen = null
  return withStubFetch(async (url) => { seen = url; return pngResponse() }, async () => {
    const p = new NoaaRadarProvider({ tileUrl: 'https://x/{z}/{x}/{y}.png' })
    const buf = await p.tile('COMPOSITE', { z: 5, x: 8, y: 12 })
    assert.equal(seen, 'https://x/5/8/12.png')
    assert.ok(Buffer.isBuffer(buf) && buf[0] === 137)
  })
})

test('tile rejects non-integer coordinates', async () => {
  const p = new NoaaRadarProvider()
  await assert.rejects(() => p.tile('COMPOSITE', { z: 5, x: 'a', y: 12 }), /XYZ tile coordinates/)
})

test('tile throws on a non-200 upstream', () => {
  return withStubFetch(async () => ({ ok: false, status: 503, headers: { get: () => '' } }), async () => {
    const p = new NoaaRadarProvider()
    await assert.rejects(() => p.tile('COMPOSITE', { z: 1, x: 0, y: 0 }), /HTTP 503/)
  })
})
