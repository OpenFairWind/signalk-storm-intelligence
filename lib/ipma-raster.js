'use strict'

// Deterministic decode / reprojection / render core for the IPMA (Portugal)
// national radar composite. Network-free so it can be unit-tested with a PNG
// fixture (see test/ipma-raster.test.js).
//
// The IPMA product (`.../transf/radar/por/pcr-<ISO>.png`) is a rendered,
// palette-indexed PNG reflectivity composite (1500x2331). Unlike the AEMET
// product it is a PNG, but PNG palette decode needs only Node's built-in zlib,
// so this module carries no image-codec dependency (contrast lib/aemet-*).
//
// Display tier only: the composite is a rendered image with IPMA's own
// reflectivity colour ramp (~150 colours, no published per-colour dBZ legend
// we map here), so this adapter renders the native echo colours and advertises
// neither `downloadRaw` nor `cellsFromRaw` — same stance as the AEMET adapter.
//
// Georeferencing: the composite is treated as an equirectangular (plate-carrée,
// EPSG:4326) image over mainland Portugal. Bounds below are an initial fit
// [west, south, east, north]; refine against the IPMA GeoServer WMS
// (divgmwebgis.ipma.pt) GetCapabilities bbox or known coastline landmarks.
// Accurate to a few km across the mainland arc, deteriorating at the edges.
//
// Licensing: © IPMA. Attribution surfaced in product metadata; callers must
// honour IPMA's terms for any caching/redistribution.

const zlib = require('node:zlib')

// --- Georeference (linear EPSG:4326, plate-carrée) ------------------------
// lon = minLon + (x + 0.5)/width  * (maxLon - minLon)
// lat = maxLat - (y + 0.5)/height * (maxLat - minLat)
const GEOREF = Object.freeze({
  minLon: -9.6,
  minLat: 36.8,
  maxLon: -6.0,
  maxLat: 42.2,
  width: 1500,
  height: 2331
})

function pxToLonLat (x, y) {
  return [
    GEOREF.minLon + ((x + 0.5) / GEOREF.width) * (GEOREF.maxLon - GEOREF.minLon),
    GEOREF.maxLat - ((y + 0.5) / GEOREF.height) * (GEOREF.maxLat - GEOREF.minLat)
  ]
}
function lonLatToPx (lon, lat) {
  return [
    ((lon - GEOREF.minLon) / (GEOREF.maxLon - GEOREF.minLon)) * GEOREF.width - 0.5,
    ((GEOREF.maxLat - lat) / (GEOREF.maxLat - GEOREF.minLat)) * GEOREF.height - 0.5
  ]
}
function georefBounds () {
  return [GEOREF.minLon, GEOREF.minLat, GEOREF.maxLon, GEOREF.maxLat]
}

// --- Web Mercator (EPSG:3857) -> lon/lat ----------------------------------
const R3857 = 6378137
function merToLonLat (mx, my) {
  const lon = (mx / R3857) * (180 / Math.PI)
  const lat = (Math.atan(Math.exp(my / R3857)) * 2 - Math.PI / 2) * (180 / Math.PI)
  return [lon, lat]
}

// --- PNG (8-bit palette, colour type 3) decoder ---------------------------
// Minimal, dependency-free: parse chunks, inflate IDAT, reverse the per-row
// filters (bytes-per-pixel = 1 for an 8-bit indexed image). Returns the raw
// palette indices plus PLTE/tRNS so the caller decides colour semantics.
function paeth (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}
function decodePalettePng (buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('IPMA raster: not a PNG')
  }
  let pos = 8
  let width = 0; let height = 0; let bitDepth = 0; let colorType = 0; let interlace = 0
  let palette = null; let trns = null
  const idat = []
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') trns = Buffer.from(data)
    else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (colorType !== 3 || bitDepth !== 8 || interlace !== 0 || !palette) {
    throw new Error(`IPMA raster: unsupported PNG (${width}x${height} colorType=${colorType} bitDepth=${bitDepth} interlace=${interlace})`)
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width + 1
  if (raw.length < height * stride) throw new Error('IPMA raster: short IDAT')
  const index = new Uint8Array(width * height)
  const prev = new Uint8Array(width)
  const cur = new Uint8Array(width)
  for (let y = 0; y < height; y++) {
    const ft = raw[y * stride]
    const base = y * stride + 1
    for (let x = 0; x < width; x++) {
      const v = raw[base + x]
      const a = x ? cur[x - 1] : 0
      const b = prev[x]
      const c = x ? prev[x - 1] : 0
      let out
      switch (ft) {
        case 0: out = v; break
        case 1: out = v + a; break
        case 2: out = v + b; break
        case 3: out = v + ((a + b) >> 1); break
        case 4: out = v + paeth(a, b, c); break
        default: throw new Error(`IPMA raster: bad PNG filter ${ft}`)
      }
      cur[x] = out & 255
    }
    index.set(cur, y * width)
    prev.set(cur)
  }
  return { width, height, index, palette, trns }
}

// Decode the composite into an RGBA echo grid: transparent (tRNS==0) pixels are
// no-echo, pure-black opaque pixels are map furniture (coastline/borders) and
// are dropped, everything else keeps IPMA's native ramp colour (alpha 255 here;
// a display alpha is applied at render time).
function decodeEchoes (buffer) {
  const { width, height, index, palette, trns } = decodePalettePng(buffer)
  if (width !== GEOREF.width || height !== GEOREF.height) {
    throw new Error(`IPMA raster: unexpected image size ${width}x${height} (expected ${GEOREF.width}x${GEOREF.height})`)
  }
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const idx = index[i]
    const alpha = trns && idx < trns.length ? trns[idx] : 255
    if (alpha === 0) continue // no echo
    const r = palette[idx * 3]; const g = palette[idx * 3 + 1]; const b = palette[idx * 3 + 2]
    if (r === 0 && g === 0 && b === 0) continue // furniture (coastline/borders)
    const o = i * 4
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255
  }
  return { width, height, rgba }
}

// --- Rendering -------------------------------------------------------------
const DISPLAY_ALPHA = 190

// Bilinear warp of the echo grid into a web-map tile, with coverage-weighted
// alpha for soft echo edges. Colour is averaged only over valid (opaque) source
// neighbours, so transparent no-echo pixels never bleed into the colour; the
// covered fraction of the 2x2 footprint drives the alpha, so echo edges fade
// instead of rendering as hard blocks.
// `bbox3857 = [minX, minY, maxX, maxY]`. Returns PNG bytes (Buffer).
function renderTile (raster, bbox3857, size) {
  const [minX, minY, maxX, maxY] = bbox3857
  const out = new Uint8Array(size * size * 4)
  const { width, height, rgba } = raster
  for (let j = 0; j < size; j++) {
    const my = maxY - ((j + 0.5) / size) * (maxY - minY)
    for (let i = 0; i < size; i++) {
      const mx = minX + ((i + 0.5) / size) * (maxX - minX)
      const [lon, lat] = merToLonLat(mx, my)
      const [gx, gy] = lonLatToPx(lon, lat)
      const x0 = Math.floor(gx); const y0 = Math.floor(gy)
      const fx = gx - x0; const fy = gy - y0
      let ws = 0; let rs = 0; let gs = 0; let bs = 0
      for (let c = 0; c < 4; c++) {
        const dx = c & 1; const dy = c >> 1
        const xi = x0 + dx; const yi = y0 + dy
        if (xi < 0 || yi < 0 || xi >= width || yi >= height) continue
        const s = (yi * width + xi) * 4
        if (rgba[s + 3] === 0) continue
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy)
        ws += w; rs += w * rgba[s]; gs += w * rgba[s + 1]; bs += w * rgba[s + 2]
      }
      if (ws <= 0) continue
      const o = (j * size + i) * 4
      out[o] = Math.round(rs / ws); out[o + 1] = Math.round(gs / ws); out[o + 2] = Math.round(bs / ws); out[o + 3] = Math.round(DISPLAY_ALPHA * ws)
    }
  }
  return encodePng(size, size, out)
}

// --- Minimal PNG encoder (RGBA, no filtering) — identical to lib/aemet-raster.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32 (buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function pngChunk (type, data) {
  const name = Buffer.from(type, 'ascii')
  const out = Buffer.allocUnsafe(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  name.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return out
}
function encodePng (width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc(height * (width * 4 + 1))
  for (let row = 0; row < height; row++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4)
      .copy(scanlines, row * (width * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
function transparentPng (size) {
  return encodePng(size, size, new Uint8Array(size * size * 4))
}

module.exports = {
  GEOREF,
  pxToLonLat,
  lonLatToPx,
  georefBounds,
  merToLonLat,
  decodePalettePng,
  decodeEchoes,
  renderTile,
  encodePng,
  transparentPng
}
