'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { GifReader } = require('omggif')
const { AemetRadarProvider } = require('../lib/aemet-provider')
const { makeSyntheticGif, makeMask, COAST_PX } = require('./helpers/synthetic-radar')

const GIF = makeSyntheticGif()
const MASK = makeMask([COAST_PX])

function decodeRGBA (buffer) {
  const r = new GifReader(buffer)
  const rgba = new Uint8Array(r.width * r.height * 4)
  r.decodeAndBlitFrameRGBA(0, rgba)
  return { width: r.width, height: r.height, rgba }
}

// Minimal fetch stub: metadata JSON on the API path, the synthetic GIF on the
// keyless `datos` URL. Records call count and the URLs seen.
function makeFetch (opts = {}) {
  const state = { calls: 0, urls: [] }
  const fn = async (url) => {
    state.calls++
    const u = String(url)
    state.urls.push(u)
    if (u.includes('/red/radar/regional/')) {
      const body = opts.apiBody || { descripcion: 'exito', estado: 200, datos: 'https://opendata.aemet.es/opendata/sh/deadbeef' }
      return { ok: opts.apiOk !== false, status: opts.apiStatus || 200, async json () { return body } }
    }
    return {
      ok: opts.dataOk !== false,
      status: opts.dataStatus || 200,
      headers: { get: () => opts.contentType || 'image/gif;charset=ISO-8859-15' },
      async arrayBuffer () { return GIF.buffer.slice(GIF.byteOffset, GIF.byteOffset + GIF.byteLength) }
    }
  }
  fn.state = state
  return fn
}

function newProvider () {
  return new AemetRadarProvider({
    apiKey: 'k', requestTimeoutMs: 5000, frameCacheSeconds: 120,
    decodeRGBA,
    staticMasks: { PM: MASK }
  })
}

const bbox = [-33396, 4481006, 578861, 5071522]

test('latest() floors to the 10-min cadence and never leaks the key', async () => {
  const p = newProvider()
  const f = makeFetch(); global.fetch = f
  const l = await p.latest('PM')
  assert.equal(l.period, 'PT10M')
  assert.equal(l.source, 'aemet')
  assert.equal(l.epochMs % (10 * 60 * 1000), 0, 'epoch floored to cadence')
  assert.ok(f.state.urls.some(u => u.includes('api_key=k')))
  assert.ok(f.state.urls.every(u => !u.includes('sh/deadbeef') || !u.includes('api_key')), 'key not on datos URL')
})

test('tile() fetches, decodes and returns a PNG; second frame is cached', async () => {
  const p = newProvider()
  const f = makeFetch(); global.fetch = f
  const png = await p.tile('PM', { bbox3857: bbox, size: 128 }, null)
  assert.ok(Buffer.isBuffer(png) && png[0] === 0x89 && png[1] === 0x50)
  const afterFirst = f.state.calls
  await p.tile('PM', { bbox3857: bbox, size: 128 }, null)
  assert.equal(f.state.calls, afterFirst, 'cached frame: no extra network calls')
})

test('API error surfaces without the key in the message', async () => {
  const p = newProvider()
  global.fetch = makeFetch({ apiBody: { estado: 404, descripcion: 'no encontrado' } })
  await assert.rejects(() => p.latest('PM'), (e) => !/k(?![a-z])/.test(e.message) && /no data/.test(e.message))
})

test('non-GIF data content-type is rejected', async () => {
  const p = newProvider()
  global.fetch = makeFetch({ contentType: 'text/html' })
  await assert.rejects(() => p.tile('PM', { bbox3857: bbox, size: 64 }), /returned text\/html/)
})

test('HTTP error on metadata is reported with status', async () => {
  const p = newProvider()
  global.fetch = makeFetch({ apiOk: false, apiStatus: 503 })
  await assert.rejects(() => p.latest('PM'), /HTTP 503/)
})

test.after(() => { delete global.fetch })
