'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { DpcProvider } = require('../lib/dpc-provider')

function provider() {
  return new DpcProvider({
    dpcApiBase: 'https://radar-api.protezionecivile.it',
    dpcOrigin: 'https://radar.protezionecivile.it',
    requestTimeoutMs: 1000
  })
}

test('Radar-DPC latest-product lookup uses the documented product API route', async () => {
  const oldFetch = global.fetch
  let request
  global.fetch = async (url, options) => {
    request = { url: String(url), options }
    return {
      ok: true,
      status: 200,
      json: async () => ({ lastProducts: [{ productType: 'HRD', time: 1787082000000, period: 300000 }] })
    }
  }
  try {
    const latest = await provider().latest('HRD')
    assert.equal(request.url, 'https://radar-api.protezionecivile.it/wide/product/findLastProductByType?type=HRD')
    assert.equal(request.options.headers.origin, 'https://radar.protezionecivile.it')
    assert.equal(latest.product, 'HRD')
    assert.equal(latest.epochMs, 1787082000000)
  } finally {
    global.fetch = oldFetch
  }
})

test('Radar-DPC raw download uses the documented product API route', async () => {
  const oldFetch = global.fetch
  const requests = []
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (requests.length === 1) {
      return { ok: true, status: 200, json: async () => ({ url: 'https://download.example/HRD.zip', key: 'HRD.zip' }) }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/zip' },
      arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer
    }
  }
  try {
    const result = await provider().downloadRaw('HRD', 1787082000000)
    assert.equal(requests[0].url, 'https://radar-api.protezionecivile.it/wide/product/downloadProduct')
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(requests[0].options.body), { productType: 'HRD', productDate: 1787082000000 })
    assert.equal(result.contentType, 'application/zip')
    assert.deepEqual([...result.buffer], [80, 75, 3, 4])
  } finally {
    global.fetch = oldFetch
  }
})
