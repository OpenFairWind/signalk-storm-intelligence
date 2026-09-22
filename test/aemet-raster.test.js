'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const { GifReader } = require('omggif')

const {
  GEOREF, NODATA, pxToLonLat, lonLatToPx, merToLonLat,
  decodeReflectivity, dbzToRGBA, renderTile, transparentPng
} = require('../lib/aemet-raster')
const { makeSyntheticGif, makeMask, ECHOES, COAST_PX, BANNER_PX, LEGEND_PX } = require('./helpers/synthetic-radar')

function decodeRGBA (buffer) {
  const r = new GifReader(buffer)
  const rgba = new Uint8Array(r.width * r.height * 4)
  r.decodeAndBlitFrameRGBA(0, rgba)
  return { width: r.width, height: r.height, rgba }
}

function isPng (buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
}

// Decode the alpha channel of a PNG produced by encodePng (RGBA, filter 0).
function pngAlphas (buf) {
  let p = 8; let width = 0; let height = 0; const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4) }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4 + 1 // one filter byte per scanline
  const alphas = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alphas.push(raw[y * stride + 1 + x * 4 + 3])
  return { width, height, alphas }
}

function lonLatToMer (lon, lat) {
  const W = 20037508.342789244
  return [(lon / 180) * W, Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * W / 180]
}

test('georef round-trips and lands known capes within pixel tolerance', () => {
  // Cap de Formentor (Mallorca N tip) and Maó (Menorca E) — known WGS84.
  for (const [lon, lat, px, py] of [[3.212, 39.962, 273, 175], [4.317, 39.870, 371, 185]]) {
    const [x, y] = lonLatToPx(lon, lat)
    assert.ok(Math.abs(x - px) <= 5, `x ${x} ~ ${px}`)
    assert.ok(Math.abs(y - py) <= 5, `y ${y} ~ ${py}`)
    const [lo, la] = pxToLonLat(x, y)
    assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9, 'inverse consistent')
  }
})

test('web mercator inverse maps origin and a known point', () => {
  const [lon0, lat0] = merToLonLat(0, 0)
  assert.ok(Math.abs(lon0) < 1e-9 && Math.abs(lat0) < 1e-9)
  const mx = (2.65 / 180) * 20037508.342789244
  const my = Math.log(Math.tan((90 + 39.57) * Math.PI / 360)) / (Math.PI / 180) * 20037508.342789244 / 180
  const [lon, lat] = merToLonLat(mx, my)
  assert.ok(Math.abs(lon - 2.65) < 1e-6 && Math.abs(lat - 39.57) < 1e-6)
})

test('dbz palette ramp: nodata transparent, endpoints coloured and opaque', () => {
  assert.deepEqual(dbzToRGBA(NODATA), [0, 0, 0, 0])
  const lo = dbzToRGBA(12); const hi = dbzToRGBA(72)
  assert.equal(lo[3], 170)
  assert.equal(hi[3], 170)
  assert.ok(lo[2] > lo[0], '12 dBZ leans blue')
  assert.ok(hi[0] > hi[2], '72 dBZ leans red')
})

test('decodeReflectivity maps every legend colour to its dBZ and excludes furniture', () => {
  const r = decodeReflectivity(makeSyntheticGif(), decodeRGBA, null)
  assert.equal(r.width, GEOREF.width)
  assert.equal(r.height, GEOREF.height)
  for (const [x, y, , dbz] of ECHOES) {
    assert.equal(r.dbz[y * r.width + x], dbz, `echo at ${x},${y} -> ${dbz} dBZ`)
  }
  // Banner (top rows) and legend (bottom rows) pixels are furniture -> nodata.
  assert.equal(r.dbz[BANNER_PX[1] * r.width + BANNER_PX[0]], NODATA, 'banner excluded')
  assert.equal(r.dbz[LEGEND_PX[1] * r.width + LEGEND_PX[0]], NODATA, 'legend excluded')
})

test('static mask removes coastline (yellow) without dropping real 48 dBZ echoes', () => {
  const gif = makeSyntheticGif()
  const [echo48x, echo48y] = ECHOES.find(e => e[3] === 48) // real 48 dBZ echo
  // Without a mask, the coastline pixel decodes as 48 (shares the colour).
  const bare = decodeReflectivity(gif, decodeRGBA, null)
  assert.equal(bare.dbz[COAST_PX[1] * bare.width + COAST_PX[0]], 48)
  // With the coastline masked, it becomes nodata but the real echo survives.
  const masked = decodeReflectivity(gif, decodeRGBA, makeMask([COAST_PX]))
  assert.equal(masked.dbz[COAST_PX[1] * masked.width + COAST_PX[0]], NODATA, 'coast masked')
  assert.equal(masked.dbz[echo48y * masked.width + echo48x], 48, 'real 48 dBZ echo kept')
})

test('decodeReflectivity rejects an unexpected image size', () => {
  const badRGBA = () => ({ width: 100, height: 100, rgba: new Uint8Array(100 * 100 * 4) })
  assert.throws(() => decodeReflectivity(Buffer.alloc(0), badRGBA, null), /unexpected image size/)
})

test('renderTile returns a PNG of the requested size for a Balearic tile', () => {
  const raster = decodeReflectivity(makeSyntheticGif(), decodeRGBA, null)
  const bbox = [0, 4600000, 500000, 5000000] // web-mercator, ~Balearics extent
  const png = renderTile(raster, bbox, 256)
  assert.ok(Buffer.isBuffer(png) && isPng(png))
})

test('renderTile bilinear smoothing feathers echo edges (partial alpha)', () => {
  const raster = decodeReflectivity(makeSyntheticGif(), decodeRGBA, null)
  // Zoom tight over one synthetic echo so a source cell is upsampled across many
  // output pixels: nearest-neighbour would give only 0 or 170 alpha, whereas the
  // coverage-weighted bilinear warp must produce intermediate alpha at the edge.
  const [ex, ey] = ECHOES[0]
  const [lon, lat] = pxToLonLat(ex, ey)
  const [mx, my] = lonLatToMer(lon, lat)
  const H = 4000 // metres half-extent -> heavy upsampling of ~1 km grid cells
  const png = renderTile(raster, [mx - H, my - H, mx + H, my + H], 256)
  assert.ok(Buffer.isBuffer(png) && isPng(png))
  const { alphas } = pngAlphas(png)
  const drawn = alphas.filter(a => a > 0).length
  const partial = alphas.filter(a => a > 0 && a < 170).length
  assert.ok(drawn > 0, 'the echo is rendered')
  assert.ok(partial > 0, 'edges are feathered with partial alpha (not hard blocks)')
})

test('transparentPng is a valid PNG', () => {
  assert.ok(isPng(transparentPng(256)))
})
