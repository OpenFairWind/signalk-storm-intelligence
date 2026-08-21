'use strict'

const fs = require('node:fs/promises')
const zlib = require('node:zlib')

const TILE_SIZE = 256
const NATIVE_MAX_ZOOM = 7
const V2_PRODUCTS = Object.freeze({
  VMI: { upstream: 'VMI', sourceMin: 0, sourceMax: 60, palette: 'vmi' },
  SRI: { upstream: 'SRI', sourceMin: 0, sourceMax: 100, palette: 'sri' },
  SRT1: { upstream: 'SRT1', sourceMin: 0, sourceMax: 200, palette: 'cum1' },
  CUM3: { upstream: 'CUM3', sourceMin: 0, sourceMax: 200, palette: 'cum' },
  CUM6: { upstream: 'CUM6', sourceMin: 0, sourceMax: 200, palette: 'cum' },
  CUM12: { upstream: 'CUM12', sourceMin: 0, sourceMax: 200, palette: 'cum' },
  CUM24: { upstream: 'CUM24', sourceMin: 0, sourceMax: 200, palette: 'cum' }
})

let decoderPromise

function clamp01(value) { return Math.max(0, Math.min(1, value)) }
function mix(a, b, t) { return a + (b - a) * t }
function smoothstep(a, b, value) {
  const t = clamp01((value - a) / Math.max(1e-9, b - a))
  return t * t * (3 - 2 * t)
}
function mixColor(a, b, t) { return a.map((value, index) => mix(value, b[index], t)) }

function vividVmi(color) {
  const luminance = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
  const saturated = color.map(value => clamp01(mix(luminance, value, 1.3)))
  const contrasted = saturated.map(value => clamp01((value - 0.5) * 1.08 + 0.5))
  return contrasted.map(value => Math.pow(value, 1 / 0.92))
}

function paletteVmi(value) {
  const t = clamp01(value / 100)
  const colors = [[0.53, 0.53, 0.53], [135 / 255, 135 / 255, 135 / 255], [0, 250 / 255, 250 / 255], [0, 250 / 255, 250 / 255], [0, 250 / 255, 0], [250 / 255, 250 / 255, 0], [250 / 255, 100 / 255, 0], [250 / 255, 0, 0]]
  const alphas = [0.1, 0, 0, 0.4, 0.8, 0.8, 0.8, 0.8]
  const stops = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1]
  let left = 0
  if (t > 0.1) left = t <= 0.2 ? 2 : t <= 0.3 ? 3 : t <= 0.4 ? 4 : t <= 0.5 ? 5 : 6
  else if (t > 0) left = 1
  const right = Math.min(colors.length - 1, left + 1)
  const start = left === 0 ? 0 : stops[left - 1]
  const end = stops[Math.min(left, stops.length - 1)]
  const factor = smoothstep(start, end, t)
  return [...vividVmi(mixColor(colors[left], colors[right], factor)), mix(alphas[left], alphas[right], factor)]
}

function paletteSri(value) {
  const t = clamp01(value / 100)
  const a = mixColor([0.75, 0.9, 0.5], [0, 0.8, 1], smoothstep(0, 0.08, t))
  const b = mixColor([0, 0.8, 0], [1, 1, 0], smoothstep(0.12, 0.3, t))
  const d = mixColor([1, 0.65, 0.3], [1, 0, 0.3], smoothstep(0.4, 0.7, t))
  const e = mixColor(d, [0.6, 0, 0.8], smoothstep(0.7, 1, t))
  const ab = t >= 0.2 ? b : a
  return [...mixColor(ab, e, smoothstep(0.35, 1, t)), smoothstep(0.01, 0.05, t)]
}

function paletteStops(value, stops) {
  for (let index = 0; index < stops.length - 1; index++) {
    if (value <= stops[index + 1][0]) {
      const factor = smoothstep(stops[index][0], stops[index + 1][0], value)
      return [...mixColor(stops[index][1], stops[index + 1][1], factor), mix(stops[index][2], stops[index + 1][2], factor)]
    }
  }
  return [...stops.at(-1)[1], stops.at(-1)[2]]
}

function paletteAccumulation(value) {
  return paletteStops(value, [
    [0, [1, 1, 1], 0], [0.1, [0, 250 / 255, 250 / 255], 0.4],
    [10.1, [0, 250 / 255, 0], 0.7], [20.1, [250 / 255, 250 / 255, 0], 0.7],
    [40.1, [250 / 255, 100 / 255, 0], 0.9], [60.1, [250 / 255, 0, 0], 0.9],
    [100.1, [250 / 255, 0, 240 / 255], 0.9]
  ])
}

function colorFor(product, value) {
  const palette = V2_PRODUCTS[product]?.palette
  if (palette === 'vmi') return paletteVmi(value)
  if (palette === 'sri') return paletteSri(value)
  return paletteAccumulation(value)
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const out = Buffer.allocUnsafe(data.length + 12)
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return out
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 6
  const scanlines = Buffer.alloc(height * (width * 4 + 1))
  for (let row = 0; row < height; row++) Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(scanlines, row * (width * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))])
}

async function decoder() {
  if (!decoderPromise) decoderPromise = (async () => {
    const [{ default: decode, init }, wasm] = await Promise.all([
      import('@jsquash/webp/decode.js'),
      fs.readFile(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))
    ])
    init(await WebAssembly.compile(wasm))
    return decode
  })()
  return decoderPromise
}

function sourceTile(z, x, y) {
  if (![z, x, y].every(Number.isInteger) || z < 0 || x < 0 || y < 0) throw new Error('Radar-DPC v2 requires non-negative integer XYZ coordinates')
  if (z <= NATIVE_MAX_ZOOM) return { z, x, y, scale: 1, offsetX: 0, offsetY: 0 }
  const scale = 2 ** (z - NATIVE_MAX_ZOOM)
  return { z: NATIVE_MAX_ZOOM, x: Math.floor(x / scale), y: Math.floor(y / scale), scale, offsetX: x % scale, offsetY: y % scale }
}

function v2TileUrl(base, product, time, request) {
  const meta = V2_PRODUCTS[product]
  if (!meta) throw new Error(`Radar-DPC v2 does not support ${product}`)
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) throw new Error('Radar-DPC v2 requires a valid UTC frame time')
  const yyyy = date.getUTCFullYear(), mm = String(date.getUTCMonth() + 1).padStart(2, '0'), dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0'), min = String(Math.floor(date.getUTCMinutes() / 5) * 5).padStart(2, '0')
  const tile = sourceTile(request.z, request.x, request.y)
  const filename = `${meta.upstream.toLowerCase()}.webp`
  return { url: new URL(`${meta.upstream}/${yyyy}/${mm}/${dd}/${hh}${min}/${tile.z}/${tile.x}/${tile.y}/${filename}`, `${base.replace(/\/?$/, '/')}`).toString(), tile }
}

function renderRgba(product, image, tile) {
  if (image.width !== TILE_SIZE || image.height !== TILE_SIZE || image.data.length !== TILE_SIZE * TILE_SIZE * 4) throw new Error(`Radar-DPC v2 tile has invalid dimensions ${image.width}x${image.height}`)
  const meta = V2_PRODUCTS[product], out = new Uint8Array(TILE_SIZE * TILE_SIZE * 4)
  const crop = TILE_SIZE / tile.scale
  for (let oy = 0; oy < TILE_SIZE; oy++) for (let ox = 0; ox < TILE_SIZE; ox++) {
    const sx = Math.min(255, Math.floor(tile.offsetX * crop + ox / tile.scale))
    const sy = Math.min(255, Math.floor(tile.offsetY * crop + oy / tile.scale))
    const source = (sy * TILE_SIZE + sx) * 4, target = (oy * TILE_SIZE + ox) * 4
    if (image.data[source + 3] < 2) continue
    const value = mix(meta.sourceMin, meta.sourceMax, image.data[source] / 255)
    const color = colorFor(product, value)
    out[target] = Math.round(clamp01(color[0]) * 255); out[target + 1] = Math.round(clamp01(color[1]) * 255)
    out[target + 2] = Math.round(clamp01(color[2]) * 255); out[target + 3] = Math.round(clamp01(color[3]) * 255)
  }
  return out
}

async function decodeV2Tile(product, bytes, tile) {
  const decode = await decoder()
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const image = await decode(data)
  return encodePng(TILE_SIZE, TILE_SIZE, renderRgba(product, image, tile))
}

function transparentPng() { return encodePng(TILE_SIZE, TILE_SIZE, new Uint8Array(TILE_SIZE * TILE_SIZE * 4)) }

module.exports = { V2_PRODUCTS, sourceTile, v2TileUrl, renderRgba, encodePng, decodeV2Tile, transparentPng, colorFor }
