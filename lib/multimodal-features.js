'use strict'

const { attachLightning } = require('./lightning-engine')
const { evidenceForCell } = require('./weather-api-fusion')

const NM = 1852
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0))
const scale = (v, den, positiveOnly = true) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  const x = positiveOnly ? Math.max(0, n) : Math.abs(n)
  return clamp01(x / den)
}
const proximity = (meters, maxNm) => Number.isFinite(Number(meters)) ? clamp01(1 - Number(meters) / (maxNm * NM)) : 0

const FEATURE_NAMES = Object.freeze([
  'radar.severity', 'radar.distanceProximity', 'radar.motionSpeed', 'radar.motionConfidence',
  'radar.pathProximity', 'radar.pathIntersects', 'radar.uncertaintyQuality', 'radar.cpaProximity',
  'lightning.count10', 'lightning.rate', 'lightning.jump', 'lightning.nearestProximity', 'lightning.trendIncreasing', 'lightning.associated',
  'onboard.evidence', 'onboard.windIncrease', 'onboard.windShift', 'onboard.temperatureDrop', 'onboard.humidityRise',
  'weather.evidence', 'weather.precipitation', 'weather.pressureDrop', 'weather.gustIncrease', 'weather.windIncrease',
  'vessel.closing', 'vessel.interceptSoon', 'vessel.minimumDistanceProximity',
  'mask.radar', 'mask.lightning', 'mask.onboard', 'mask.weather', 'mask.vessel'
])

function lightningForCell(cell, context) {
  if (cell?.lightning) return cell.lightning
  if (!context?.lightningStrikes?.length || !cell?.geometry) return null
  return attachLightning([cell], context.lightningStrikes, context.now || Date.now())[0]?.lightning || null
}

function weatherForCell(cell, context) {
  if (cell?.weatherObservations) return cell.weatherObservations
  if (!context?.weatherApiContext?.available) return null
  const ev = evidenceForCell(cell, context.weatherApiContext)
  return ev?.available ? ev : null
}

function extractMultimodalFeatures(cell, context = {}) {
  const x = []
  const radarPresent = !!(cell && (cell.geometry || cell.severity != null || cell.properties))
  const severity = Number.isFinite(Number(cell?.severity)) ? Number(cell.severity) : Number(cell?.properties?.severity)
  const distance = Number(cell?.distanceMeters)
  const motion = cell?.motion || {}
  const path = cell?.pathThreat || cell?.threat || {}
  const cpa = cell?.cpa || {}
  x.push(scale(severity, 5), proximity(distance, 40), scale(motion.speed, 30), clamp01(motion.confidence), proximity(path.minDistanceMeters, 40), path.intersects ? 1 : 0, Number.isFinite(Number(path.uncertaintyMeters)) ? clamp01(1 - Number(path.uncertaintyMeters) / (20 * NM)) : 0, proximity(cpa.dcpaMeters, 40))

  const lightning = lightningForCell(cell, context)
  const lightningPresent = !!lightning
  x.push(scale(lightning?.count10min, 50), scale(lightning?.ratePerMinute, 8), lightning?.jump?.detected ? 1 : 0, proximity(lightning?.nearestStrikeMeters, 30), lightning?.trend === 'increasing' ? 1 : 0, scale(lightning?.countAssociated, 50))

  const onboard = context.environmentContext?.available ? context.environmentContext : cell?.onboardEnvironment?.available ? cell.onboardEnvironment : null
  const onboardPresent = !!onboard
  const ot = onboard?.trends || {}
  x.push(clamp01(onboard?.evidenceScore), scale(ot.windSpeedIncrease, 8), scale(ot.windDirectionShift, Math.PI / 3, false), scale(ot.temperatureDrop, 5), scale(ot.relativeHumidityRise, 0.25))

  const weather = weatherForCell(cell, context)
  const weatherPresent = !!weather
  const ws = weather?.signals || {}
  x.push(clamp01(weather?.score), scale(ws.upstreamPrecipitation, 4), scale(ws.pressureDrop, 600), scale(ws.gustIncrease, 12), scale(ws.windIncrease, 8))

  const vesselPresent = !!context.vessel?.position
  const horizonSec = Math.max(1, (Number(context.config?.horizonMinutes) || 60) * 60)
  const interceptSec = Number(path.interceptSec)
  x.push(cpa.closing ? 1 : 0, Number.isFinite(interceptSec) ? clamp01(1 - interceptSec / horizonSec) : 0, proximity(path.minDistanceMeters, 30))

  x.push(radarPresent ? 1 : 0, lightningPresent ? 1 : 0, onboardPresent ? 1 : 0, weatherPresent ? 1 : 0, vesselPresent ? 1 : 0)
  if (x.length !== FEATURE_NAMES.length) throw new Error(`Feature vector length ${x.length} != ${FEATURE_NAMES.length}`)
  const modalityCompleteness = (x.slice(-5).reduce((a, b) => a + b, 0)) / 5
  return { values: Float32Array.from(x), names: FEATURE_NAMES, modalityCompleteness, masks: { radar:radarPresent, lightning:lightningPresent, onboard:onboardPresent, weather:weatherPresent, vessel:vesselPresent } }
}

module.exports = { FEATURE_NAMES, extractMultimodalFeatures }
