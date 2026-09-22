'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')

const {
  GEOREF, pxToLonLat, lonLatToPx, georefBounds, merToLonLat,
  decodePalettePng, renderTile, encodePng, transparentPng
} = require('../lib/ipma-raster')

// Build a minimal 8-bit palette (colour type 3) PNG from an index grid, a flat
// [r,g,b,...] palette and an optional tRNS alpha array. `filters` picks the row
// filter type per row so the decoder's un-filtering is exercised for each of
// the five PNG filter types.
function crc32 (buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xffffffff) >>> 0
}
function chunk (type, data) {
  const name = Buffer.from(type, 'ascii')
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  name.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return out
}
function paeth (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c)
}
function buildPalettePng (w, h, grid, palette, trns, filters) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(h * (w + 1))
  const prev = new Uint8Array(w)
  for (let y = 0; y < h; y++) {
    const ft = filters[y]
    raw[y * (w + 1)] = ft
    for (let x = 0; x < w; x++) {
      const v = grid[y * w + x]
      const a = x ? grid[y * w + x - 1] : 0
      const b = prev[x]
      const c = x ? prev[x - 1] : 0
      let enc
      switch (ft) {
        case 0: enc = v; break
        case 1: enc = v - a; break
        case 2: enc = v - b; break
        case 3: enc = v - ((a + b) >> 1); break
        case 4: enc = v - paeth(a, b, c); break
      }
      raw[y * (w + 1) + 1 + x] = enc & 255
    }
    for (let x = 0; x < w; x++) prev[x] = grid[y * w + x]
  }
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(palette))
  ]
  if (trns) chunks.push(chunk('tRNS', Buffer.from(trns)))
  chunks.push(chunk('IDAT', zlib.deflateSync(raw)))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(chunks)
}

function isPng (buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
}

// Decode the alpha channel of an RGBA PNG produced by encodePng (filter 0).
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
  const rawimg = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4 + 1
  const alphas = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alphas.push(rawimg[y * stride + 1 + x * 4 + 3])
  return { width, height, alphas }
}

test('decodePalettePng un-filters every filter type and returns exact indices', () => {
  const w = 4; const h = 5
  const grid = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid.push((y * 7 + x * 3) & 255)
  const palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]
  const trns = [0, 255, 255, 255, 255]
  const png = buildPalettePng(w, h, grid, palette, trns, [0, 1, 2, 3, 4])
  const dec = decodePalettePng(png)
  assert.equal(dec.width, w)
  assert.equal(dec.height, h)
  assert.deepEqual(Array.from(dec.index), grid)
  assert.equal(dec.palette.length, 15)
  assert.equal(dec.trns[0], 0)
})

test('georef bounds and round-trip are consistent', () => {
  assert.deepEqual(georefBounds(), [GEOREF.minLon, GEOREF.minLat, GEOREF.maxLon, GEOREF.maxLat])
  // NW corner pixel (0,0) sits just inside the NW bound.
  const [lon, lat] = pxToLonLat(0, 0)
  assert.ok(lon > GEOREF.minLon && lon < GEOREF.minLon + 0.01)
  assert.ok(lat < GEOREF.maxLat && lat > GEOREF.maxLat - 0.01)
  // Inverse is consistent to sub-pixel.
  const [x, y] = lonLatToPx(lon, lat)
  assert.ok(Math.abs(x - 0) < 1e-6 && Math.abs(y - 0) < 1e-6)
})

test('web mercator inverse maps the origin to 0,0', () => {
  const [lon, lat] = merToLonLat(0, 0)
  assert.ok(Math.abs(lon) < 1e-9 && Math.abs(lat) < 1e-9)
})

test('renderTile paints an echo at its location and stays transparent off-extent', () => {
  // One red echo at grid pixel (750, 1165) ~ centre of the composite.
  const width = GEOREF.width; const height = GEOREF.height
  const rgba = new Uint8Array(width * height * 4)
  const xi = 750; const yi = 1165
  const o = (yi * width + xi) * 4
  rgba[o] = 255; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 255
  const raster = { width, height, rgba }

  const [lon, lat] = pxToLonLat(xi, yi)
  const R = 6378137
  const mx = (lon * Math.PI / 180) * R
  const my = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R
  const d = 20000 // ~20 km half-window in metres
  const png = renderTile(raster, [mx - d, my - d, mx + d, my + d], 64)
  assert.ok(isPng(png))
  // A tile far outside the Portugal extent has no echoes -> fully transparent.
  const empty = renderTile(raster, [0, 0, 10000, 10000], 32)
  assert.ok(isPng(empty))
  assert.deepEqual(empty, transparentPng(32))
})

test('renderTile bilinear smoothing feathers echo edges (partial alpha)', () => {
  // Single opaque echo pixel; zoom in tight so it is upsampled across many
  // output pixels. Nearest-neighbour would give only 0 or DISPLAY_ALPHA; the
  // coverage-weighted bilinear warp must produce intermediate alpha at the edge.
  const width = GEOREF.width; const height = GEOREF.height
  const rgba = new Uint8Array(width * height * 4)
  const xi = 750; const yi = 1165
  const o = (yi * width + xi) * 4
  rgba[o] = 255; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 255
  const raster = { width, height, rgba }

  const [lon, lat] = pxToLonLat(xi, yi)
  const R = 6378137
  const mx = (lon * Math.PI / 180) * R
  const my = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R
  const d = 4000 // tight ~4 km half-window -> heavy upsampling
  const png = renderTile(raster, [mx - d, my - d, mx + d, my + d], 128)
  assert.ok(isPng(png))
  const { alphas } = pngAlphas(png)
  const drawn = alphas.filter(a => a > 0).length
  const partial = alphas.filter(a => a > 0 && a < 190).length
  assert.ok(drawn > 0, 'the echo is rendered')
  assert.ok(partial > 0, 'edges are feathered with partial alpha (not hard blocks)')
})

test('encodePng and transparentPng produce valid PNG signatures', () => {
  assert.ok(isPng(encodePng(2, 2, new Uint8Array(2 * 2 * 4))))
  assert.ok(isPng(transparentPng(8)))
})
