'use strict'

function normalizeFrameList(frames) {
  const out = []
  for (const value of Array.isArray(frames) ? frames : []) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) out.push(d.toISOString())
  }
  return [...new Set(out)].sort((a, b) => Date.parse(a) - Date.parse(b))
}

function playbackSlots(frames, slotCount) {
  const list = normalizeFrameList(frames)
  const count = Math.max(1, Math.min(288, Number(slotCount) || 1))
  const selected = list.slice(-count).reverse()
  return selected.map((time, slot) => ({ slot, time, epochMs: Date.parse(time), live: slot === 0 }))
}

function resolveSlot(frames, slot) {
  const n = Number(slot)
  if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('Invalid playback slot'), { statusCode: 400 })
  const slots = playbackSlots(frames, n + 1)
  const hit = slots.find(x => x.slot === n)
  if (!hit) throw Object.assign(new Error('Playback frame is not available'), { statusCode: 404 })
  return hit
}

function playbackChartId(providerId, product, slot = 0) {
  const base = `weather-radar-${providerId}-${String(product).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return slot === 0 ? base : `${base}-replay-${slot}`
}

function playbackChartName(title, slot = 0) {
  return slot === 0 ? title : `${title} · replay ${slot}`
}

module.exports = { normalizeFrameList, playbackSlots, resolveSlot, playbackChartId, playbackChartName }
