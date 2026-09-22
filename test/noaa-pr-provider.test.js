'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NoaaPrRadarProvider, PRODUCTS, PR_BOUNDS } = require('../lib/noaa-pr-provider')

function withStubFetch (impl, fn) {
  const orig = globalThis.fetch
  globalThis.fetch = impl
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = orig })
}
const pngResponse = () => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer })

test('product PR is display-only over the Puerto Rico bounds', () => {
  const c = PRODUCTS.PR
  assert.equal(c.kind, 'raster')
  assert.equal(c.observationOnly, true)
  assert.equal(c.raw, false)
  assert.deepEqual(c.bounds, PR_BOUNDS)
})

test('latest floors to 5 minutes and is UTC ISO', () =>
  new NoaaPrRadarProvider().latest('PR').then((l) => {
    assert.equal(l.period, 'PT5M'); assert.equal(l.source, 'noaa-pr')
    assert.equal(l.epochMs % (5 * 60 * 1000), 0)
    assert.equal(new Date(l.epochMs).toISOString(), l.time)
  }))

test('tile builds a WMS 1.1.1 GetMap with the requested bbox3857', () => {
  let seen = null
  return withStubFetch(async (url) => { seen = new URL(url.toString()); return pngResponse() }, async () => {
    const p = new NoaaPrRadarProvider()
    const bbox = [-7625000, 1870000, -7070000, 2250000]
    const buf = await p.tile('PR', { bbox3857: bbox, size: 512 })
    const q = seen.searchParams
    assert.equal(q.get('service'), 'WMS')
    assert.equal(q.get('version'), '1.1.1')
    assert.equal(q.get('request'), 'GetMap')
    assert.equal(q.get('layers'), 'nexrad-n0q')
    assert.equal(q.get('srs'), 'EPSG:3857')
    assert.equal(q.get('transparent'), 'true')
    assert.equal(q.get('width'), '512')
    assert.equal(q.get('bbox'), bbox.join(','))
    assert.ok(Buffer.isBuffer(buf) && buf[0] === 137)
  })
})

test('tile without bbox3857 throws', async () => {
  await assert.rejects(() => new NoaaPrRadarProvider().tile('PR', {}), /bbox3857/)
})

test('unknown product throws', async () => {
  await assert.rejects(() => new NoaaPrRadarProvider().latest('CONUS'), /unknown product/)
})

test('non-200 WMS throws', () =>
  withStubFetch(async () => ({ ok: false, status: 500, headers: { get: () => '' } }), async () => {
    await assert.rejects(() => new NoaaPrRadarProvider().tile('PR', { bbox3857: [0, 0, 1, 1] }), /HTTP 500/)
  }))
