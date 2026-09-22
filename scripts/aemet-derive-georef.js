'use strict'

// Reproduce the linear EPSG:4326 georeference baked into lib/aemet-raster.js
// for the AEMET Palma (`pm`) regional radar.
//
// The product GIF carries no georeference. The static yellow coastline overlay
// is matched against known Balearic capes (published WGS84 coordinates); a
// north-up EPSG:4326 image is linear in each axis, so an ordinary least-squares
// fit of lon = A·x + B and lat = C·y + D recovers the transform. Pixel
// coordinates below were read from the coastline components of a sample frame
// (see docs/aemet-provider.md). Run: `node scripts/aemet-derive-georef.js`.

// [pixelX, pixelY, lon, lat, name]
const GCPS = [
  [273, 175, 3.212, 39.962, 'Cap de Formentor (Mallorca N)'],
  [299, 202, 3.485, 39.715, 'Cap de Capdepera (Mallorca E)'],
  [264, 253, 3.052, 39.264, 'Cap de ses Salines (Mallorca S)'],
  [198, 218, 2.350, 39.585, 'Sant Elm / Dragonera (Mallorca W)'],
  [350, 160, 4.091, 40.088, 'Cap de Cavalleria (Menorca N)'],
  [371, 185, 4.317, 39.870, 'Punta de s\'Espero / Mao (Menorca E)'],
  [326, 168, 3.820, 40.055, 'Punta Nati (Menorca W)'],
  [129, 269, 1.520, 39.113, 'Portinatx (Ibiza N)'],
  [101, 297, 1.223, 38.920, 'Cap Nuno (Ibiza W)'],
  [118, 322, 1.386, 38.632, 'Cap de Barbaria (Formentera S)']
]

// Least-squares slope/intercept for v = m·u + c.
function linfit (us, vs) {
  const n = us.length
  const su = us.reduce((a, b) => a + b, 0)
  const sv = vs.reduce((a, b) => a + b, 0)
  const suu = us.reduce((a, b) => a + b * b, 0)
  const suv = us.reduce((a, b, i) => a + b * vs[i], 0)
  const m = (n * suv - su * sv) / (n * suu - su * su)
  const c = (sv - m * su) / n
  return [m, c]
}

function main () {
  const xs = GCPS.map(g => g[0]); const ys = GCPS.map(g => g[1])
  const lons = GCPS.map(g => g[2]); const lats = GCPS.map(g => g[3])
  const [A, B] = linfit(xs, lons)
  const [C, D] = linfit(ys, lats)
  process.stdout.write(`lon = ${A.toFixed(12)} * x + ${B.toFixed(12)}\n`)
  process.stdout.write(`lat = ${C.toFixed(12)} * y + ${D.toFixed(12)}\n`)
  const kmPerDegLat = 111.195
  let maxKm = 0
  for (const [x, y, lon, lat, name] of GCPS) {
    const plon = A * x + B; const plat = C * y + D
    const dkm = Math.hypot((plon - lon) * kmPerDegLat * Math.cos(lat * Math.PI / 180), (plat - lat) * kmPerDegLat)
    maxKm = Math.max(maxKm, dkm)
    process.stdout.write(`  ${name}: residual ${dkm.toFixed(2)} km\n`)
  }
  process.stdout.write(`max residual: ${maxKm.toFixed(2)} km; scale ${(Math.abs(C) * kmPerDegLat).toFixed(3)} km/px (N-S)\n`)
}

main()
