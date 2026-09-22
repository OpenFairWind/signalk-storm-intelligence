'use strict'

// Build the static overlay mask for an AEMET regional radar product.
//
// The coastline overlay is drawn in the same pure yellow (255,255,0) as the
// 48 dBZ reflectivity level, so colour alone cannot separate them. The overlay
// is invariant across frames while weather moves, so a pixel that is yellow in
// EVERY sampled frame is coastline (a transient 48 dBZ echo would not be yellow
// in all of them). Intersecting several frames yields a clean coast mask.
//
// Usage:
//   node scripts/aemet-build-mask.js <code> <frame1.gif> <frame2.gif> ...
// Writes assets/aemet-<code>-mask.bin (packed 1-bit, row-major, little-endian).
// Use >= 4 frames spaced by the product cadence for a robust result.

const fs = require('node:fs')
const path = require('node:path')
const { GifReader } = require('omggif')
const { GEOREF, BANNER_ROWS, LEGEND_ROW } = require('../lib/aemet-raster')

const YELLOW = [255, 255, 0]

function decodeRGBA (file) {
  const r = new GifReader(fs.readFileSync(file))
  const rgba = new Uint8Array(r.width * r.height * 4)
  r.decodeAndBlitFrameRGBA(0, rgba)
  return { width: r.width, height: r.height, rgba }
}

function main () {
  const [code, ...frames] = process.argv.slice(2)
  if (!code || frames.length < 2) {
    throw new Error('usage: aemet-build-mask.js <code> <frame1.gif> <frame2.gif> ...')
  }
  const { width, height } = GEOREF
  const isYellowAll = new Uint8Array(width * height).fill(1)
  for (const file of frames) {
    const img = decodeRGBA(file)
    if (img.width !== width || img.height !== height) {
      throw new Error(`${file}: size ${img.width}x${img.height} != ${width}x${height}`)
    }
    for (let i = 0; i < width * height; i++) {
      const p = i * 4
      if (!(img.rgba[p] === YELLOW[0] && img.rgba[p + 1] === YELLOW[1] && img.rgba[p + 2] === YELLOW[2])) {
        isYellowAll[i] = 0
      }
    }
  }
  // Restrict to data rows (banner/legend are excluded by the decoder anyway).
  const packed = Buffer.alloc(Math.ceil(width * height / 8))
  let count = 0
  for (let y = BANNER_ROWS; y < LEGEND_ROW; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (isYellowAll[i]) { packed[i >> 3] |= (1 << (i & 7)); count++ }
    }
  }
  const out = path.join(__dirname, '..', 'assets', `aemet-${code}-mask.bin`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, packed)
  process.stdout.write(`aemet-${code}-mask.bin: ${count} static pixels from ${frames.length} frames -> ${out}\n`)
}

main()
