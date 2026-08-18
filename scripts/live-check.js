'use strict'

const assert = require('node:assert/strict')
const dpcAdapter = require('../providers/radar-dpc')
const dwdAdapter = require('../providers/dwd')
const rainViewerAdapter = require('../providers/rainviewer')
const { tileBBox3857, DEFAULTS } = require('../index')._test

function assertPng (tile, label) {
  assert.ok(tile.length > 100, `${label}: unexpectedly small PNG (${tile.length} bytes)`)
  assert.deepEqual([...tile.subarray(0, 8)], [137,80,78,71,13,10,26,10], `${label}: not a PNG signature`)
}
function req(z,x,y){ return { z,x,y,bbox3857:tileBBox3857(z,x,y),size:256,crs:'EPSG:3857' } }

async function main () {
  const common = { requestTimeoutMs: DEFAULTS.requestTimeoutMs }
  const dpc = dpcAdapter.create({ common, settings: dpcAdapter.defaults, rawSettings: {} })
  const dwd = dwdAdapter.create({ common, settings: dwdAdapter.defaults, rawSettings: {} })
  const rainviewer = rainViewerAdapter.create({ common, settings: rainViewerAdapter.defaults, rawSettings: {} })

  const vmi = await dpc.latest('VMI')
  assert.ok(vmi.epochMs > 0, 'No latest DPC VMI timestamp')
  const dpcTile = await dpc.tile('VMI', req(6,33,23), vmi.time)
  assertPng(dpcTile, 'DPC VMI')

  const hrd = await dpc.latest('HRD')
  assert.ok(hrd.epochMs > 0, 'No latest DPC HRD timestamp')
  const raw = await dpc.downloadRaw('HRD', hrd.epochMs)
  assert.ok(raw.buffer.length > 100, 'Unexpectedly small HRD archive')
  const cells = await dpc.cellsFromRaw('HRD', raw.buffer)
  assert.ok(Array.isArray(cells), 'HRD parser did not return a feature array')

  const rain = await dwd.latest('RAIN_RATE')
  assert.ok(rain.epochMs > 0, 'No latest DWD RAIN_RATE timestamp')
  assert.ok(rain.epochMs <= Date.now() + 2 * 60 * 1000, 'DWD latest selected a future nowcast frame')
  const dwdTimeline = await dwd.timeline('RAIN_RATE', { minutes: 60 })
  assert.ok(dwdTimeline.length > 0, 'No DWD observation timeline')
  const dwdTile = await dwd.tile('RAIN_RATE', req(6,33,21), rain.time)
  assertPng(dwdTile, 'DWD RAIN_RATE')

  const rv = await rainviewer.latest('COMPOSITE')
  assert.ok(rv.epochMs > 0, 'No latest RainViewer COMPOSITE timestamp')
  assert.ok(rv.epochMs <= Date.now() + 2 * 60 * 1000, 'RainViewer latest selected a future frame')
  const rvTimeline = await rainviewer.timeline('COMPOSITE', { minutes: 120 })
  assert.ok(rvTimeline.length > 0, 'No RainViewer observation timeline')
  const rvTile = await rainviewer.tile('COMPOSITE', req(6,33,23), rv.time)
  assertPng(rvTile, 'RainViewer COMPOSITE')

  console.log(JSON.stringify({
    ok: true,
    providers: {
      dpc: { latestVmi: vmi.time, vmiPeriod: vmi.period, tileBytes: dpcTile.length, latestHrd: hrd.time, hrdCells: cells.length },
      dwd: { latestRainRate: rain.time, period: rain.period, timelineFrames: dwdTimeline.length, tileBytes: dwdTile.length },
      rainviewer: { latestComposite: rv.time, period: rv.period, timelineFrames: rvTimeline.length, tileBytes: rvTile.length, forecastAvailable: rv.forecastAvailable }
    }
  }, null, 2))
}

main().catch(err => {
  console.error(err.stack || err)
  process.exit(1)
})
