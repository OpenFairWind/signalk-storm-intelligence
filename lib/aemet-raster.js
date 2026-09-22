'use strict'

// Deterministic decode/reprojection/render core for the AEMET regional radar
// reflectivity product. Kept free of network I/O so it can be unit-tested with
// fixtures (see test/aemet-raster.test.js).
//
// The AEMET OpenData regional radar product is a rendered palette GIF (a PPI
// reflectivity image with a dBZ legend), not a gridded native raster. This
// module recovers the source physical quantity (reflectivity in dBZ, quantised
// to the published legend steps) by mapping each legend colour back to its dBZ
// value, and reprojects the image into web-map (EPSG:3857) tiles for display.
//
// Georeferencing is a linear EPSG:4326 fit derived by matching the static
// yellow coastline overlay against known Balearic geography (see
// scripts/aemet-derive-georef.js and docs). It is accurate to ~3-5 km across
// the populated arc of the disk (best near the centre) and is intentionally
// simple and deterministic. The radar disk furniture (banner, legend, coast
// overlay, out-of-range grey) is removed via a static mask so it is not
// mistaken for reflectivity.

const zlib = require('node:zlib')

// --- Palette: legend colour (R,G,B) -> reflectivity dBZ -------------------
// Read directly from the product legend bar (12..72 dBZ in 6 dBZ steps).
const PALETTE_DBZ = Object.freeze({
  '0,0,252': 12,
  '0,148,252': 18,
  '0,252,252': 24,
  '67,131,35': 30,
  '0,192,0': 36,
  '0,255,0': 42,
  '255,255,0': 48,
  '255,187,0': 54,
  '255,127,0': 60,
  '255,0,0': 66,
  '200,0,90': 72
})

const NODATA = -128

// --- Georeference (linear EPSG:4326) --------------------------------------
// lon = A*x + B ; lat = C*y + D  (x,y are image pixel coords, origin top-left)
const GEOREF = Object.freeze({
  A: 0.011553130857059692,
  B: 0.039344514820201015,
  C: -0.008921347094339253,
  D: 41.52681096151692,
  width: 480,
  height: 530
})

// Disk furniture excluded from reflectivity regardless of colour:
//   rows [0, BANNER_ROWS)     -> top copyright/logo banner
//   rows [LEGEND_ROW, height) -> bottom reflectivity legend + product line
const BANNER_ROWS = 22
const LEGEND_ROW = 486

function pxToLonLat (x, y) {
  return [GEOREF.A * x + GEOREF.B, GEOREF.C * y + GEOREF.D]
}
function lonLatToPx (lon, lat) {
  return [(lon - GEOREF.B) / GEOREF.A, (lat - GEOREF.D) / GEOREF.C]
}

// --- Web Mercator (EPSG:3857) <-> lon/lat ---------------------------------
const R3857 = 6378137
function merToLonLat (mx, my) {
  const lon = (mx / R3857) * (180 / Math.PI)
  const lat = (Math.atan(Math.exp(my / R3857)) * 2 - Math.PI / 2) * (180 / Math.PI)
  return [lon, lat]
}

// --- Static overlay mask ---------------------------------------------------
// The coastline overlay is drawn in the same pure yellow (255,255,0) as the
// 48 dBZ reflectivity level, so it cannot be separated by colour. Because the
// overlay is identical in every frame, its pixel positions are supplied as a
// static packed 1-bit mask (width*height bits, row-major). A pixel set in the
// mask is furniture and never reflectivity.
function isMasked (mask, x, y, width) {
  if (!mask) return false
  const i = y * width + x
  return (mask[i >> 3] & (1 << (i & 7))) !== 0
}

// Decode an AEMET regional radar GIF buffer into a reflectivity grid.
// `decodeRGBA(buffer) -> { width, height, rgba: Uint8Array }` is injected so
// the GIF codec stays a provider concern and this core has no runtime deps.
// Returns { width, height, dbz: Int8Array } with NODATA where there is no echo
// or the pixel is furniture.
function decodeReflectivity (buffer, decodeRGBA, staticMask) {
  const { width, height, rgba } = decodeRGBA(buffer)
  if (width !== GEOREF.width || height !== GEOREF.height) {
    throw new Error(`AEMET raster: unexpected image size ${width}x${height} (expected ${GEOREF.width}x${GEOREF.height})`)
  }
  const dbz = new Int8Array(width * height).fill(NODATA)
  for (let y = 0; y < height; y++) {
    if (y < BANNER_ROWS || y >= LEGEND_ROW) continue
    for (let x = 0; x < width; x++) {
      if (isMasked(staticMask, x, y, width)) continue
      const p = (y * width + x) * 4
      const v = PALETTE_DBZ[`${rgba[p]},${rgba[p + 1]},${rgba[p + 2]}`]
      if (v !== undefined) dbz[y * width + x] = v
    }
  }
  return { width, height, dbz }
}

// --- Rendering -------------------------------------------------------------
// Semi-transparent blue->red ramp over the 12..72 dBZ legend range.
function dbzToRGBA (d) {
  if (d === NODATA) return [0, 0, 0, 0]
  let t = (d - 12) / (72 - 12)
  if (t < 0) t = 0; else if (t > 1) t = 1
  // HSV hue 0.66 (blue) -> 0.0 (red), full sat/val
  const h = (1 - t) * 0.66
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const q = 1 - f
  let r, g, b
  switch (((i % 6) + 6) % 6) {
    case 0: r = 1; g = f; b = 0; break
    case 1: r = q; g = 1; b = 0; break
    case 2: r = 0; g = 1; b = f; break
    case 3: r = 0; g = q; b = 1; break
    case 4: r = f; g = 0; b = 1; break
    default: r = 1; g = 0; b = q; break
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 170]
}

// Bilinear warp of a decoded reflectivity grid into a web-map tile, with
// coverage-weighted alpha for soft echo edges. dBZ is interpolated only across
// valid (non-NODATA) neighbours, so NODATA never bleeds into the average; the
// covered fraction of the 2x2 footprint drives the alpha, so echo edges fade
// instead of rendering as hard blocks. Display-only: cell detection runs on the
// raw dbz grid (see lib/aemet-cells.js), not on this raster.
// `bbox3857 = [minX, minY, maxX, maxY]`. Returns PNG bytes (Buffer).
function renderTile (raster, bbox3857, size) {
  const [minX, minY, maxX, maxY] = bbox3857
  const out = new Uint8Array(size * size * 4)
  const { width, height, dbz } = raster
  for (let j = 0; j < size; j++) {
    const my = maxY - ((j + 0.5) / size) * (maxY - minY)
    for (let i = 0; i < size; i++) {
      const mx = minX + ((i + 0.5) / size) * (maxX - minX)
      const [lon, lat] = merToLonLat(mx, my)
      const [gx, gy] = lonLatToPx(lon, lat)
      const x0 = Math.floor(gx); const y0 = Math.floor(gy)
      const fx = gx - x0; const fy = gy - y0
      let ws = 0; let ds = 0
      for (let c = 0; c < 4; c++) {
        const dx = c & 1; const dy = c >> 1
        const xi = x0 + dx; const yi = y0 + dy
        if (xi < 0 || yi < 0 || xi >= width || yi >= height) continue
        const v = dbz[yi * width + xi]
        if (v === NODATA) continue
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy)
        ws += w; ds += w * v
      }
      if (ws <= 0) continue
      const [r, g, b] = dbzToRGBA(ds / ws)
      const o = (j * size + i) * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = Math.round(170 * ws)
    }
  }
  return encodePng(size, size, out)
}

// --- Minimal PNG encoder (RGBA, no filtering) ------------------------------
// Same approach as lib/dpc-v2-raster.js: hand-rolled chunks + zlib, no deps.
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
  header[8] = 8   // bit depth
  header[9] = 6   // colour type RGBA
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
  PALETTE_DBZ,
  GEOREF,
  NODATA,
  BANNER_ROWS,
  LEGEND_ROW,
  pxToLonLat,
  lonLatToPx,
  merToLonLat,
  decodeReflectivity,
  dbzToRGBA,
  renderTile,
  encodePng,
  transparentPng
}
