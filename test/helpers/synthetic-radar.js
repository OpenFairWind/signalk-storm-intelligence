'use strict'

// Synthetic AEMET-shaped radar GIF for deterministic tests — no copyrighted
// sample data is committed. It is a 480x530 palette GIF (matching the product
// geometry) carrying: one pixel of every legend dBZ colour on a known row, a
// coastline-coloured pixel (pure yellow, shared with 48 dBZ) at a known
// position, a real 48 dBZ echo elsewhere, plus banner and legend pixels that
// must be excluded as furniture.

const { GifWriter } = require('omggif')
const { GEOREF, BANNER_ROWS, LEGEND_ROW } = require('../../lib/aemet-raster')

// RGB (hex) for each legend step; index in this array is the GIF palette index.
// 0 = black background; 12 = grey (out-of-range furniture colour).
const PALETTE = [
  0x000000, // 0 background
  0x0000fc, // 1  -> 12 dBZ
  0x0094fc, // 2  -> 18
  0x00fcfc, // 3  -> 24
  0x438323, // 4  -> 30
  0x00c000, // 5  -> 36
  0x00ff00, // 6  -> 42
  0xffff00, // 7  -> 48  (also the coastline colour)
  0xffbb00, // 8  -> 54
  0xff7f00, // 9  -> 60
  0xff0000, // 10 -> 66
  0xc8005a, // 11 -> 72
  0x7f7f7f, // 12 grey
  0x000000, 0x000000, 0x000000 // pad to 16
]

// Known content positions [x, y, paletteIndex, expected dBZ | null].
const ECHO_ROW = 100
const ECHOES = [
  [200, ECHO_ROW, 1, 12], [201, ECHO_ROW, 2, 18], [202, ECHO_ROW, 3, 24],
  [203, ECHO_ROW, 4, 30], [204, ECHO_ROW, 5, 36], [205, ECHO_ROW, 6, 42],
  [206, ECHO_ROW, 7, 48], [207, ECHO_ROW, 8, 54], [208, ECHO_ROW, 9, 60],
  [209, ECHO_ROW, 10, 66], [210, ECHO_ROW, 11, 72]
]
const COAST_PX = [251, 268] // pure yellow coastline (must be masked -> null)
const BANNER_PX = [10, 5] // yellow in the banner (row < BANNER_ROWS) -> null
const LEGEND_PX = [300, 500] // red in the legend (row >= LEGEND_ROW) -> null

function makeSyntheticGif () {
  const { width: W, height: H } = GEOREF
  const idx = new Uint8Array(W * H) // all background (index 0)
  for (const [x, y, i] of ECHOES) idx[y * W + x] = i
  idx[COAST_PX[1] * W + COAST_PX[0]] = 7 // coastline (yellow)
  idx[BANNER_PX[1] * W + BANNER_PX[0]] = 7 // banner furniture
  idx[LEGEND_PX[1] * W + LEGEND_PX[0]] = 10 // legend furniture
  const buf = Buffer.alloc(W * H * 2 + 4096)
  const gw = new GifWriter(buf, W, H, { palette: PALETTE })
  const n = gw.addFrame(0, 0, W, H, idx, { palette: PALETTE })
  return Buffer.from(buf.slice(0, n))
}

// Packed 1-bit row-major mask (little-endian) covering the given [x,y] pixels.
function makeMask (pixels) {
  const { width: W, height: H } = GEOREF
  const mask = Buffer.alloc(Math.ceil(W * H / 8))
  for (const [x, y] of pixels) {
    const i = y * W + x
    mask[i >> 3] |= (1 << (i & 7))
  }
  return mask
}

module.exports = {
  makeSyntheticGif,
  makeMask,
  ECHOES,
  COAST_PX,
  BANNER_PX,
  LEGEND_PX,
  ECHO_ROW,
  BANNER_ROWS,
  LEGEND_ROW
}
