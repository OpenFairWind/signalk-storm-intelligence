'use strict'

const path = require('node:path')
const fs = require('node:fs/promises')
const { discoverAdapters, knownProducts, defaultsFromAdapters, providerSettingsSchema, instantiateAdapters } = require('./lib/provider-registry')
const { RecyclingStorage } = require('./lib/storage')
const { TileStore, tilesAroundPosition } = require('./lib/tile-store')
const { discoverInferenceAlgorithms, instantiateInferenceAlgorithms, inferenceSettingsSchema } = require('./lib/inference-registry')
const { InferenceEngine } = require('./lib/inference-engine')
const { playbackSlots, resolveSlot, playbackChartId, playbackChartName } = require('./lib/playback')
const { assertProvider, describeProvider, productCapabilities } = require('./lib/provider-contract')
const { hazardsFromCells, renderHazardTile, geometryBounds } = require('./lib/hazard-overlay')
const { discoverObservationAdapters, defaultsFromObservationAdapters, observationProviderSettingsSchema, instantiateObservationAdapters } = require('./lib/observation-provider-registry')
const { describeObservationProvider } = require('./lib/observation-provider-contract')
const { lightningSummary, attachLightning } = require('./lib/lightning-engine')
const { WeatherApiFusion, attachWeatherApiEvidence } = require('./lib/weather-api-fusion')
const { renderLightningTile } = require('./lib/lightning-overlay')
const { EnvironmentFusion } = require('./lib/environment-fusion')
const { PACKAGE_VERSION } = require('./lib/version')

const ADAPTERS = discoverAdapters()
const OBSERVATION_ADAPTERS = discoverObservationAdapters()
const OBSERVATION_DEFAULTS = defaultsFromObservationAdapters(OBSERVATION_ADAPTERS)
const INFERENCE_ALGORITHMS = discoverInferenceAlgorithms()
const KNOWN_PRODUCTS = Object.freeze(knownProducts(ADAPTERS))
const ADAPTER_DEFAULTS = defaultsFromAdapters(ADAPTERS)
const DEFAULTS = Object.freeze({
  enabledProviders: ADAPTER_DEFAULTS.enabledProviders,
  displayLayers: ADAPTER_DEFAULTS.displayLayers,
  acquisitionTargets: ADAPTER_DEFAULTS.acquisitionTargets,
  minZoom: 4, maxZoom: 13, cacheSeconds: 60, cacheEntries: 512, requestTimeoutMs: 10000,
  providerSettings: {},
  backgroundEnabled: true, pollSeconds: 60, storageEnabled: true, storageMaxMB: 1024, storageMaxAgeHours: 24,
  prefetchEnabled: true, prefetchTargets: ADAPTER_DEFAULTS.prefetchTargets, prefetchRadiusNm: 40, prefetchZooms: [5, 6, 7, 8],
  prefetchMaxTilesPerCycle: 1024, prefetchStorageMaxMB: 512, prefetchStorageMaxAgeHours: 6, prefetchConcurrency: 6,
  playbackEnabled: true, playbackSlots: 13, playbackTimelineMinutes: 180, playbackIntervalMs: 900,
  hazardOverlayEnabled: true, hazardOverlaySlots: 24, hazardPredictionMinutes: [15, 30, 60], hazardOverlayOpacity: 0.8,
  stormEnabled: true, stormSource: ADAPTER_DEFAULTS.stormSource, warnDistanceNm: 20, alarmDistanceNm: 8,
  horizonMinutes: 60, warnSeverity: 3, alarmSeverity: 4, matchDistanceNm: 30,
  notificationPath: 'notifications.environment.weather.storm',
  stormHistoryFrames: 8, stormPathStepSec: 60, stormBaseUncertaintyNm: 1, stormMaxUncertaintyNm: 10,
  lightningEnabled: false, lightningProviders: OBSERVATION_DEFAULTS.enabledProviders, lightningProviderSettings: {}, lightningLookbackMinutes: 30, lightningQueryRadiusNm: 120, lightningAssociationRadiusNm: 8, lightningEvidenceWeight: 0.15, lightningOverlayEnabled: true, lightningOverlayOpacity: 0.9, lightningWarningNm: 15, lightningAlarmNm: 8, lightningMinStrikes: 2, lightningNotificationPath: 'notifications.environment.weather.lightning',
  onboardEnvironmentEnabled: true, onboardEnvironmentHistoryMinutes: 30, onboardEnvironmentMaxAgeSeconds: 180, onboardEnvironmentEvidenceWeight: 0.12,
  weatherApiObservationsEnabled: true, weatherApiSampleRadiusNm: 40, weatherApiSampleBearings: 8, weatherApiMaxCount: 3, weatherApiMaxAgeMinutes: 30, weatherApiEvidenceWeight: 0.15,
  inferenceAlgorithms: ['kinematic-polygon','multisensor-evidence'], inferenceStrategy: 'max-severity', inferenceAlgorithmSettings: {}
})
const NM = 1852

function splitTarget(value) {
  const s = String(value || '')
  const i = s.indexOf(':')
  if (i < 1 || i === s.length - 1) return null
  return { providerId: s.slice(0, i), product: s.slice(i + 1).toUpperCase(), key: `${s.slice(0, i)}:${s.slice(i + 1).toUpperCase()}` }
}

function validTarget(value) {
  const t = splitTarget(value)
  return !!(t && KNOWN_PRODUCTS[t.providerId]?.[t.product])
}

function parseTargets(value, fallback) {
  const input = Array.isArray(value) ? value : fallback
  const seen = new Set(), out = []
  for (const raw of input) {
    const t = splitTarget(raw)
    if (t && KNOWN_PRODUCTS[t.providerId]?.[t.product] && !seen.has(t.key)) {
      seen.add(t.key); out.push(t.key)
    }
  }
  return out.length ? out : [...fallback]
}

function tileBBox3857(z, x, y) {
  if (![z, x, y].every(Number.isInteger) || z < 0) throw new Error('Invalid tile coordinates')
  const n = 2 ** z
  if (x < 0 || y < 0 || x >= n || y >= n) throw new Error('Tile coordinates out of range')
  const w = 20037508.342789244, s = 2 * w / n
  const minX = -w + x * s, maxX = minX + s, maxY = w - y * s, minY = maxY - s
  return [minX, minY, maxX, maxY]
}

function normalizeTime(v) {
  if (v == null || v === '' || v === 'latest') return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new Error('Invalid time')
  return d.toISOString()
}

function makeCache(max) {
  const m = new Map()
  return {
    get(k) { const i = m.get(k); if (!i) return; if (i.e <= Date.now()) { m.delete(k); return } m.delete(k); m.set(k, i); return i.v },
    set(k, v, ttl) { m.delete(k); m.set(k, { v, e: Date.now() + ttl }); while (m.size > max) m.delete(m.keys().next().value) },
    clear() { m.clear() }, size() { return m.size }
  }
}

function chartRecord(pluginId, provider, product, cfg, slot = 0) {
  const m = provider.products()[product]
  if (!m || m.kind !== 'raster') throw new Error(`Not a raster product: ${provider.id}:${product}`)
  const id = playbackChartId(provider.id, product, slot)
  const bounds = m.bounds || provider.bounds || [-180, -85, 180, 85]
  const suffix = slot > 0 ? `?slot=${slot}` : ''
  return [id, {
    identifier: id,
    name: playbackChartName(m.title, slot),
    description: `${m.description}. Source: ${provider.name}.${slot > 0 ? ` Historical playback slot ${slot}.` : ''}`,
    type: 'tilelayer', format: 'png', minzoom: Math.max(cfg.minZoom, Number.isFinite(m.minZoom) ? m.minZoom : cfg.minZoom), maxzoom: Math.min(cfg.maxZoom, Number.isFinite(m.maxZoom) ? m.maxZoom : cfg.maxZoom), bounds,
    url: `/stormintelligence/${pluginId}/tiles/${provider.id}/${product}/{z}/{x}/{y}.png${suffix}`,
    attribution: provider.attribution || provider.name,
    provider: provider.id, product,
    stormIntelligence: {
      apiVersion: '2.0-draft', provider: provider.id, product,
      temporal: m.temporal !== false, playbackSlot: slot, live: slot === 0,
      latest: `/plugins/${pluginId}/latest/${provider.id}/${product}`,
      timeline: `/plugins/${pluginId}/timeline/${provider.id}/${product}`,
      playback: `/plugins/${pluginId}/playback/${provider.id}/${product}`,
      capabilities: { ...productCapabilities(provider, m), playback: m.temporal !== false }
    },
    weatherRadar: { deprecated: true, replacement: 'stormIntelligence', provider: provider.id, product, playbackSlot: slot }
  }]
}

function chartRecords(pluginId, provider, product, cfg) {
  const count = cfg.playbackEnabled ? Math.max(1, Math.min(72, Number(cfg.playbackSlots) || 1)) : 1
  return Array.from({ length: count }, (_, slot) => chartRecord(pluginId, provider, product, cfg, slot))
}

function hazardChartId(slot) { return `storm-intelligence-hazards${slot > 0 ? `-slot-${slot}` : ''}` }
function hazardChartName(slot) { return `Storm Intelligence · Storm cells${slot > 0 ? ` · frame ${slot}` : ' · current'}` }
function hazardChartRecords(pluginId, cfg) {
  if (!cfg.hazardOverlayEnabled) return []
  const count = Math.max(1, Math.min(72, Number(cfg.hazardOverlaySlots) || 1))
  return Array.from({ length: count }, (_, slot) => {
    const id = hazardChartId(slot)
    return [id, { identifier:id, name:hazardChartName(slot), description:'Normalized storm cells, motion tracks and predicted cell envelope.', type:'tilelayer', format:'png', minzoom:cfg.minZoom, maxzoom:cfg.maxZoom, bounds:[-180,-85,180,85], url:`/stormintelligence/${pluginId}/hazards/${slot}/{z}/{x}/{y}.png`, attribution:'Storm Intelligence hazard providers', stormIntelligence:{apiVersion:'2.0-draft',kind:'hazards',hazardSlot:slot,capabilities:{cells:true,prediction:true,cpa:true}} }]
  })
}


function lightningChartId(){ return 'storm-intelligence-lightning' }
function lightningDensityChartId(providerId){return `storm-intelligence-lightning-density-${String(providerId).replace(/[^a-z0-9-]/gi,'-').toLowerCase()}`}
function lightningDensityChartRecords(pluginId,cfg,observationProviders){if(!cfg.lightningEnabled||!cfg.lightningOverlayEnabled)return[];const out=[];for(const [id,p] of observationProviders||[]){if(typeof p.densityTile!=='function')continue;const cid=lightningDensityChartId(id);out.push([cid,{identifier:cid,name:`Storm Intelligence · Lightning density · ${p.name}`,description:'Provider-agnostic lightning density/frequency field.',type:'tilelayer',format:'png',minzoom:cfg.minZoom,maxzoom:cfg.maxZoom,bounds:[-180,-85,180,85],url:`/stormintelligence/${pluginId}/lightning-density/${id}/{z}/{x}/{y}.png`,attribution:p.attribution||p.name,stormIntelligence:{apiVersion:'2.0-draft',kind:'lightning-density',observationProvider:id,capabilities:{density:true}}}])}return out}
function lightningChartRecord(pluginId,cfg){
  if(!cfg.lightningEnabled || !cfg.lightningOverlayEnabled) return []
  const id=lightningChartId()
  return [[id,{identifier:id,name:'Storm Intelligence · Lightning strikes',description:'Provider-agnostic recent lightning observations.',type:'tilelayer',format:'png',minzoom:cfg.minZoom,maxzoom:cfg.maxZoom,bounds:[-180,-85,180,85],url:`/stormintelligence/${pluginId}/lightning/{z}/{x}/{y}.png`,attribution:'Configured lightning observation providers',stormIntelligence:{apiVersion:'2.0-draft',kind:'lightning',capabilities:{points:true,age:true}}}]]
}

function extensionManifest(pluginId, version) {
  const base = `/plotterext/${pluginId}`
  return {
    name: 'Storm Intelligence',
    description: 'Multisensor storm intelligence, weather radar mosaics, lightning, environmental evidence, inference and approaching-storm warnings.',
    version, apiVersion: '1',
    requires: ['panels.iframe', 'buttons', 'resources'],
    optional: ['widgets', 'signalk.stream', 'map', 'ui', 'charts'],
    panels: [{ id: 'storm-intelligence-panel', title: 'Storm Intelligence', type: 'iframe', url: `${base}/radar-panel.html`, lifecycle: 'keepAlive' }],
    widgets: [{ id: 'storm-status', title: 'Storm Intelligence', type: 'iframe', url: `${base}/storm-widget.html`, size: '2x1', lifecycle: 'whileEnabled' }],
    buttons: [{ id: 'storm-intelligence', title: 'Storm Intelligence', slot: 'mapToolbar', icon: 'radar', action: { type: 'togglePanel', panel: 'storm-intelligence-panel' } }]
  }
}

module.exports = function (app) {
  const plugin = { id: 'signalk-storm-intelligence', name: 'Storm Intelligence', version: PACKAGE_VERSION }
  let cfg = { ...DEFAULTS }, providers = new Map(), observationProviders = new Map(), inferenceAlgorithms = new Map(), inferenceEngine, cache = makeCache(DEFAULTS.cacheEntries), charts = {}, storage, tileStore, environmentFusion, weatherApiFusion
  let timer = null, running = false, busy = false, lastAcquired = {}, lastPrefetched = {}, cells = [], lightningStrikes = [], lightningState = 'normal', lightningMessage = '', environmentContext = {available:false}, weatherApiContext = {available:false}, hazardSnapshots = new Map(), hazardSequence = 0, activeHazardSlot = 0, lastAlarm = 'normal', lastAlarmText = '', lastError = null, assetsMounted = false
  const activeErrors = new Map()
  const syncLastError = () => { lastError = [...activeErrors.values()].at(-1)?.message || null }
  const err = (message, component = 'runtime') => { activeErrors.set(component, { message, at: new Date().toISOString() }); syncLastError(); app.error?.(message) }
  const recovered = component => { activeErrors.delete(component); syncLastError() }
  const status = m => app.setPluginStatus?.(m)

  function dataDir() { return app.getDataDirPath?.() || path.join(process.cwd(), 'storm-intelligence-data') }
  function vessel() { return { position: app.getSelfPath?.('navigation.position') || null, sog: app.getSelfPath?.('navigation.speedOverGround'), cog: app.getSelfPath?.('navigation.courseOverGroundTrue') } }
  function getProvider(id) { const p = providers.get(id); if (!p) throw Object.assign(new Error(`Radar mosaic provider not enabled: ${id}`), { statusCode: 404 }); return p }
  function getProduct(provider, product) { const m = provider.products()[product]; if (!m) throw Object.assign(new Error(`Unsupported product ${provider.id}:${product}`), { statusCode: 404 }); return m }

  function notifyPath(path,state,message,details={}) {
    app.handleMessage?.(plugin.id,{context:'vessels.self',updates:[{source:{label:plugin.id},timestamp:new Date().toISOString(),values:[{path,value:{state,method:['visual','sound'],message,stormIntelligence:details}}]}]})
  }

  function notify(state, message, details = {}) {
    if (state === lastAlarm && message === lastAlarmText) return
    lastAlarm = state; lastAlarmText = message
    notifyPath(cfg.notificationPath,state,message,details)
  }

  function stormMessage(cell) {
    if (!cell) return 'No approaching severe-weather cell detected'
    const d = cell.distanceMeters / NM, dcpa = (cell.cpa?.dcpaMeters ?? cell.distanceMeters) / NM, tcpa = Math.round((cell.cpa?.tcpaSec || 0) / 60), sev = cell.severity == null ? 'unknown' : cell.severity
    const intercept = cell.threat?.intersects ? `, projected path intersects in ${Math.round((cell.threat.interceptSec||0)/60)} min` : ''
    const conf = Number.isFinite(cell.threat?.confidence) ? `, confidence ${Math.round(cell.threat.confidence*100)}%` : ''
    return `Weather radar storm cell ${cell.state}: ${d.toFixed(1)} NM away, CPA ${dcpa.toFixed(1)} NM in ${tcpa} min${intercept}, severity ${sev}${conf}`
  }

  async function fetchLatest(providerId, product) {
    const provider = getProvider(providerId), k = `latest:${provider.id}:${product}`, c = cache.get(k)
    if (c) return c
    getProduct(provider, product)
    const v = await provider.latest(product)
    cache.set(k, v, Math.min(60000, Math.max(5000, cfg.cacheSeconds * 1000)))
    return v
  }

  async function fetchTimeline(providerId, product, minutes = 180) {
    const provider = getProvider(providerId), meta = getProduct(provider, product), latest = await fetchLatest(providerId, product)
    if (typeof provider.timeline === 'function') {
      const frames = await provider.timeline(product, { minutes, latest })
      return { provider: providerId, product, period: latest.period || meta.period || null, latest: latest.time, frames }
    }
    const m = /^PT(\d+)M$/.exec(latest.period || meta.period || ''), step = m ? Number(m[1]) : 5, frames = []
    for (let t = latest.epochMs - minutes * 60000; t <= latest.epochMs; t += step * 60000) frames.push(new Date(t).toISOString())
    return { provider: providerId, product, period: latest.period || meta.period || null, latest: latest.time, frames }
  }

  async function playbackFrames(providerId, product) {
    try {
      const timeline = await fetchTimeline(providerId, product, cfg.playbackTimelineMinutes)
      return { ...timeline, source: 'provider', stale: false, frames: playbackSlots(timeline.frames, cfg.playbackSlots) }
    } catch (upstreamError) {
      const local = tileStore?.enabled ? await tileStore.frames(providerId, product) : []
      if (!local.length) throw upstreamError
      const times = local.map(epochMs => new Date(epochMs).toISOString())
      const frames = playbackSlots(times, cfg.playbackSlots)
      return { provider: providerId, product, period: null, latest: frames[0]?.time || null, source: 'prefetch-replay', stale: true, upstreamError: upstreamError.message, frames }
    }
  }

  async function resolvePlaybackSlot(providerId, product, slot) {
    const playback = await playbackFrames(providerId, product)
    const n = Number(slot)
    if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('Invalid playback slot'), { statusCode: 400 })
    const hit = playback.frames.find(x => x.slot === n)
    if (!hit) throw Object.assign(new Error('Playback frame is not available'), { statusCode: 404 })
    return hit
  }

  async function frameEpoch(providerId, product, time) {
    if (time && time !== 'latest') {
      const iso = normalizeTime(time)
      return { epochMs: new Date(iso).getTime(), time: iso }
    }
    return fetchLatest(providerId, product)
  }

  async function fetchTileNetwork(providerId, product, z, x, y, iso) {
    const provider = getProvider(providerId)
    return provider.tile(product, { z, x, y, bbox3857: tileBBox3857(z, x, y), size: 256, crs: 'EPSG:3857' }, iso)
  }

  async function fetchTilePersistent(providerId, product, z, x, y, time) {
    let frame
    try { frame = await frameEpoch(providerId, product, time) }
    catch (e) {
      if (!time && tileStore?.enabled) {
        const fallback = await tileStore.newestTile(providerId, product, z, x, y)
        if (fallback) return { buffer: fallback.buffer, frame: { epochMs: fallback.epochMs, time: new Date(fallback.epochMs).toISOString(), stale: true }, source: 'prefetch-offline' }
      }
      throw e
    }
    const iso = frame.time || new Date(frame.epochMs).toISOString()
    if (tileStore?.enabled) {
      const local = await tileStore.get(providerId, product, frame.epochMs, z, x, y)
      if (local) return { buffer: local, frame, source: 'prefetch' }
    }
    try {
      const buffer = await fetchTileNetwork(providerId, product, z, x, y, iso)
      return { buffer, frame, source: 'upstream' }
    } catch (e) {
      // Never substitute a different timestamp for an explicitly selected replay frame.
      // Cross-frame fallback is only valid for live/latest display in degraded connectivity.
      if (!time && tileStore?.enabled) {
        const fallback = await tileStore.newestTile(providerId, product, z, x, y)
        if (fallback) return { buffer: fallback.buffer, frame: { epochMs: fallback.epochMs, time: new Date(fallback.epochMs).toISOString(), stale: true }, source: 'prefetch-stale' }
      }
      throw e
    }
  }

  async function fetchTile(providerId, product, z, x, y, time, slot) {
    const target = `${providerId}:${product}`
    if (!cfg.displayLayers.includes(target)) throw Object.assign(new Error('Radar layer not enabled'), { statusCode: 404 })
    if (z < cfg.minZoom || z > cfg.maxZoom) throw Object.assign(new Error('Zoom outside configured range'), { statusCode: 404 })
    const provider = getProvider(providerId), meta = getProduct(provider, product)
    const productMinZoom = Number.isFinite(meta.minZoom) ? meta.minZoom : cfg.minZoom
    const productMaxZoom = Number.isFinite(meta.maxZoom) ? meta.maxZoom : cfg.maxZoom
    if (z < productMinZoom || z > productMaxZoom) throw Object.assign(new Error('Zoom outside product range'), { statusCode: 404 })
    if (meta.kind !== 'raster') throw Object.assign(new Error('Product is not renderable'), { statusCode: 400 })
    let iso = normalizeTime(time)
    if (!iso && slot != null && slot !== '') iso = (await resolvePlaybackSlot(providerId, product, Number(slot))).time
    const k = `tile:${providerId}:${product}:${z}:${x}:${y}:${iso || 'latest'}`, c = cache.get(k)
    if (c) return c
    const result = await fetchTilePersistent(providerId, product, z, x, y, iso)
    cache.set(k, result.buffer, cfg.cacheSeconds * 1000)
    return result.buffer
  }

  function publishHazardSnapshot(frameTime) {
    if (!cfg.hazardOverlayEnabled) return
    const count = Math.max(1, Math.min(72, Number(cfg.hazardOverlaySlots) || 1))
    activeHazardSlot = hazardSequence % count
    hazardSequence++
    hazardSnapshots.set(activeHazardSlot, { time: frameTime || new Date().toISOString(), cells: cells.map(c => ({ ...c })) })
  }

  function currentHazards() {
    return { source: cfg.stormSource, state: lastAlarm, activeSlot: activeHazardSlot, chartId: hazardChartId(activeHazardSlot), chartName: hazardChartName(activeHazardSlot), predictionMinutes: cfg.hazardPredictionMinutes, ...hazardsFromCells(cells, cfg.hazardPredictionMinutes) }
  }

  function hazardOverlayStatus() {
    const snap = hazardSnapshots.get(activeHazardSlot)
    return { enabled: cfg.hazardOverlayEnabled, activeSlot: activeHazardSlot, resourceId: hazardChartId(activeHazardSlot), name: hazardChartName(activeHazardSlot), time: snap?.time || cells[0]?.time || null, slots: Math.max(1, Math.min(72, Number(cfg.hazardOverlaySlots) || 1)), predictionMinutes: cfg.hazardPredictionMinutes, opacity: cfg.hazardOverlayOpacity }
  }

  function isoDurationMs(value) {
    const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(value || ''))
    if (!m) return null
    return ((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000
  }

  function operationalRisk(cell) {
    const state = cell?.threat?.state || cell?.state || 'normal'
    const confidence = Math.max(0, Math.min(1, Number(cell?.threat?.confidence) || 0))
    const severity = Math.max(0, Math.min(5, Number(cell?.severity) || 0))
    let score = state === 'alarm' ? 65 : state === 'warn' ? 38 : 8
    score += confidence * 16 + severity * 2.5
    if (cell?.threat?.intersects || cell?.pathThreat?.intersects) score += 10
    if (cell?.lightning?.jump?.detected) score += 4
    if ((Number(cell?.lightning?.count10min) || 0) >= 10) score += 3
    score = Math.max(0, Math.min(100, Math.round(score)))
    const label = score >= 85 ? 'critical' : score >= 65 ? 'high' : score >= 40 ? 'moderate' : 'low'
    return { score, label, state, confidence }
  }

  function operationalCell(cell) {
    const risk = operationalRisk(cell)
    const path = cell?.pathThreat || cell?.threat || {}
    const interceptSec = Number(path?.interceptSec)
    const minDistanceSec = Number(path?.minDistanceSec)
    const minDistanceMeters = Number(path?.minDistanceMeters)
    const distanceMeters = Number(cell?.distanceMeters)
    const closing = cell?.cpa?.closing === true
    const intersects = path?.intersects === true
    const etaType = intersects && Number.isFinite(interceptSec) ? 'impact' : Number.isFinite(minDistanceSec) ? 'closest-approach' : null
    const etaSec = etaType === 'impact' ? interceptSec : etaType === 'closest-approach' ? minDistanceSec : null
    const approaching = intersects || closing || (Number.isFinite(minDistanceSec) && minDistanceSec >= 0 && minDistanceSec <= cfg.horizonMinutes * 60)
    return {
      id: cell.trackId || cell.id,
      sourceId: cell.sourceId || null,
      provider: cell.provider || null,
      product: cell.product || null,
      observedAt: cell.time || null,
      state: risk.state,
      risk,
      severity: Number.isFinite(Number(cell.severity)) ? Number(cell.severity) : null,
      confidence: risk.confidence,
      approaching,
      eta: etaType ? { type: etaType, seconds: etaSec, at: new Date(Date.now() + Math.max(0, etaSec) * 1000).toISOString() } : null,
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
      closestApproach: Number.isFinite(minDistanceMeters) ? { distanceMeters: minDistanceMeters, seconds: Number.isFinite(minDistanceSec) ? minDistanceSec : null } : null,
      motion: cell.motion ? { speed: cell.motion.speed ?? null, course: cell.motion.course ?? null, confidence: cell.motion.confidence ?? null } : null,
      lightning: cell.lightning ? { count10min: cell.lightning.count10min ?? 0, ratePerMinute: cell.lightning.ratePerMinute ?? null, trend: cell.lightning.trend ?? null, jump: !!cell.lightning.jump?.detected, nearestStrikeMeters: cell.lightning.nearestStrikeMeters ?? null } : null,
      threatMethod: cell?.threat?.method || null,
      uncertaintyMeters: cell?.threat?.uncertaintyMeters ?? path?.uncertaintyMeters ?? null
    }
  }

  function componentState(id, name, state, details = {}) { return { id, name, state, ...details } }

  async function operationalStatus() {
    const status = await radarStatus()
    const now = Date.now()
    const components = []
    components.push(componentState('runtime', 'Storm Intelligence runtime', lastError ? 'warning' : running ? 'healthy' : 'stopped', { busy, message: lastError || (busy ? 'Acquisition/inference cycle running' : 'Runtime active') }))
    for (const overlay of status.overlays || []) {
      const latestMs = Number(overlay.latest?.epochMs) || Date.parse(overlay.latest?.time || '')
      const periodMs = isoDurationMs(overlay.latest?.period || overlay.playback?.period) || 5 * 60 * 1000
      const ageMs = Number.isFinite(latestMs) ? Math.max(0, now - latestMs) : null
      const stale = ageMs != null && ageMs > Math.max(periodMs * 3, 15 * 60 * 1000)
      components.push(componentState(`radar:${overlay.key}`, `Radar · ${overlay.providerName} · ${overlay.name}`, overlay.latest?.error ? 'error' : stale ? 'warning' : 'healthy', { provider: overlay.provider, product: overlay.product, latest: overlay.latest, ageMs }))
    }
    components.push(componentState('acquisition', 'Background acquisition', !cfg.backgroundEnabled ? 'disabled' : cfg.acquisitionTargets.length && Object.keys(lastAcquired).length === 0 ? 'waiting' : 'healthy', { targets: cfg.acquisitionTargets, lastAcquired, storage: status.acquisition?.storage || null }))
    components.push(componentState('prefetch', 'Offline prefetch', !cfg.prefetchEnabled ? 'disabled' : 'healthy', { targets: cfg.prefetchTargets, lastPrefetched, storage: status.prefetch?.storage || null }))
    components.push(componentState('storm-source', 'Storm-cell source', !cfg.stormEnabled ? 'disabled' : cells.length ? 'healthy' : 'waiting', { source: cfg.stormSource, cellCount: cells.length, state: lastAlarm }))
    components.push(componentState('lightning', 'Lightning observations', !cfg.lightningEnabled ? 'disabled' : observationProviders.size === 0 ? 'warning' : lightningStrikes.length ? 'healthy' : 'waiting', { providers: [...observationProviders.keys()], observationCount: lightningStrikes.length, state: lightningState }))
    components.push(componentState('onboard-environment', 'Onboard environmental sensors', !cfg.onboardEnvironmentEnabled ? 'disabled' : environmentContext?.available ? 'healthy' : 'waiting', { evidence: environmentContext }))
    components.push(componentState('weather-api', 'Signal K Weather API observations', !cfg.weatherApiObservationsEnabled ? 'disabled' : weatherApiContext?.available ? 'healthy' : 'waiting', { sampleCount: weatherApiContext?.samples?.length || 0, evidence: weatherApiContext }))
    const inf = inferenceEngine?.describe() || { algorithms: [], lastRuns: [] }
    for (const algorithm of inf.algorithms || []) {
      const run = (inf.lastRuns || []).find(r => r.id === algorithm.id)
      components.push(componentState(`inference:${algorithm.id}`, `Inference · ${algorithm.name || algorithm.id}`, !run ? 'waiting' : run.ok ? 'healthy' : 'error', { algorithm, lastRun: run || null }))
    }
    const approachingCells = cells.map(operationalCell).filter(c => c.approaching).sort((a, b) => {
      const stateRank = { alarm: 2, warn: 1, normal: 0 }
      const sr = (stateRank[b.state] || 0) - (stateRank[a.state] || 0)
      if (sr) return sr
      const ae = a.eta?.seconds ?? Infinity, be = b.eta?.seconds ?? Infinity
      if (ae !== be) return ae - be
      return b.risk.score - a.risk.score
    })
    const counts = components.reduce((acc, c) => { acc[c.state] = (acc[c.state] || 0) + 1; return acc }, {})
    return {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      runtime: { running, busy, state: lastAlarm, message: lastAlarmText, lastError, version: plugin.version },
      componentSummary: counts,
      components,
      approachingCells,
      storm: { state: lastAlarm, message: lastAlarmText, totalCells: cells.length, approachingCells: approachingCells.length, horizonMinutes: cfg.horizonMinutes },
      vessel: vessel(),
      semantics: { etaImpact: 'Projected first vessel-path intersection with moving storm polygon.', etaClosestApproach: 'Projected time of minimum polygon separation when no path intersection is predicted.', risk: 'Operational 0-100 ranking score derived from threat state, confidence, severity, path interception and lightning evidence; it is not a probability.' }
    }
  }

  async function radarStatus() {
    const overlays = await Promise.all(cfg.displayLayers.map(async key => {
      const t = splitTarget(key), provider = getProvider(t.providerId), m = getProduct(provider, t.product)
      let latest
      try { latest = await fetchLatest(t.providerId, t.product) } catch (e) { latest = { error: e.message } }
      const resourceId = chartRecord(plugin.id, provider, t.product, cfg, 0)[0]
      let playback = { enabled: cfg.playbackEnabled, frames: [] }
      if (cfg.playbackEnabled && m.temporal !== false) {
        try {
          const pf = await playbackFrames(t.providerId, t.product)
          playback = { enabled: true, period: pf.period, latest: pf.latest, intervalMs: cfg.playbackIntervalMs, frames: pf.frames.map(f => ({ ...f, resourceId: playbackChartId(t.providerId, t.product, f.slot), name: playbackChartName(m.title, f.slot) })) }
        } catch (e) { playback = { enabled: true, frames: [], error: e.message } }
      }
      return { key, provider: t.providerId, providerName: provider.name, product: t.product, name: m.title, resourceId, latest, playback }
    }))
    return {
      providers: Object.fromEntries([...providers].map(([id, p]) => [id, { id, name: p.name, attribution: p.attribution || null }])),
      products: cfg.displayLayers, overlays,
      acquisition: { enabled: cfg.backgroundEnabled, targets: cfg.acquisitionTargets, lastAcquired, storage: await storage?.stats() },
      prefetch: { enabled: cfg.prefetchEnabled, targets: cfg.prefetchTargets, radiusNm: cfg.prefetchRadiusNm, zooms: cfg.prefetchZooms, lastPrefetched, storage: await tileStore?.stats() },
      storm: { enabled: cfg.stormEnabled, source: cfg.stormSource, state: lastAlarm, message: lastAlarmText, cells, overlay: hazardOverlayStatus() },
      lightning: { enabled: cfg.lightningEnabled, providers:[...observationProviders].map(([id,p])=>describeObservationProvider(p)), state:lightningState, message:lightningMessage, summary:lightningSummary(lightningStrikes,vessel().position), observations:lightningStrikes },
      onboardEnvironment: environmentContext,
      weatherObservations: weatherApiContext,
      inference: inferenceEngine?.describe() || null,
      lastError
    }
  }

  async function radarResources() {
    const resources = { status: { id: 'status', kind: 'status', apiVersion: '2.0-draft', ...(await radarStatus()) }, hazards: { id:'hazards', kind:'hazards', apiVersion:'2.0-draft', ...currentHazards() }, lightning:{id:'lightning',kind:'observations',type:'lightning',apiVersion:'2.0-draft',providers:[...observationProviders.keys()],summary:lightningSummary(lightningStrikes,vessel().position),observations:lightningStrikes}, onboardEnvironment:{id:'onboardEnvironment',kind:'observations',type:'environment',apiVersion:'2.0-draft',...environmentContext}, weatherObservations:{id:'weatherObservations',kind:'observations',type:'weather-api',apiVersion:'2.0-draft',...weatherApiContext}, inference:{id:'inference',kind:'inference',apiVersion:'2.0-draft',...(inferenceEngine?.describe()||{})} }
    for (const [id, provider] of providers) resources[`provider:${id}`] = { id: `provider:${id}`, kind: 'provider', ...describeProvider(provider) }
    return resources
  }

  function mountAssets() {
    if (assetsMounted || typeof app.get !== 'function') return
    const base = `/plotterext/${plugin.id}`
    const serve = (name, type) => async (req, res) => { try { res.set('Content-Type', type); res.send(await fs.readFile(path.join(__dirname, 'public', name))) } catch { res.status(404).end() } }
    app.get(`${base}/radar-panel.html`, serve('radar-panel.html', 'text/html; charset=utf-8'))
    app.get(`${base}/storm-widget.html`, serve('storm-widget.html', 'text/html; charset=utf-8'))
    app.get(`${base}/plotter-bus.js`, serve('plotter-bus.js', 'text/javascript; charset=utf-8'))
    const tileBase = `/stormintelligence/${plugin.id}`
    app.get(`${tileBase}/tiles/:provider/:product/:z/:x/:y.png`, async (req, res) => {
      try {
        const product = String(req.params.product).toUpperCase(), z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y)
        if (![z, x, y].every(Number.isInteger)) return res.status(400).json({ error: 'Invalid tile coordinates' })
        const b = await fetchTile(req.params.provider, product, z, x, y, req.query.time, req.query.slot)
        res.set('Content-Type', 'image/png')
        res.set('Cache-Control', `public, max-age=${cfg.cacheSeconds}`)
        res.send(b)
      } catch (e) { res.status(e.statusCode || 502).json({ error: e.message }) }
    })
    app.get(`${tileBase}/lightning/:z/:x/:y.png`, async (req,res)=>{
      try{if(!cfg.lightningEnabled||!cfg.lightningOverlayEnabled)return res.status(404).end();const z=Number(req.params.z),x=Number(req.params.x),y=Number(req.params.y);if(![z,x,y].every(Number.isInteger)||z<cfg.minZoom||z>cfg.maxZoom)return res.status(400).end();const b=renderLightningTile(lightningStrikes,z,x,y);res.set('Content-Type','image/png');res.set('Cache-Control','public, max-age=30');res.send(b)}catch(e){res.status(500).end()}
    })
    app.get(`${tileBase}/lightning-density/:provider/:z/:x/:y.png`, async (req,res)=>{try{if(!cfg.lightningEnabled||!cfg.lightningOverlayEnabled)return res.status(404).end();const p=observationProviders.get(req.params.provider);if(!p||typeof p.densityTile!=='function')return res.status(404).end();const z=Number(req.params.z),x=Number(req.params.x),y=Number(req.params.y);if(![z,x,y].every(Number.isInteger)||z<cfg.minZoom||z>cfg.maxZoom)return res.status(400).end();const b=await p.densityTile({z,x,y,bbox3857:tileBBox3857(z,x,y),size:256,time:req.query.time?normalizeTime(req.query.time):null});res.set('Content-Type','image/png');res.set('Cache-Control','public, max-age=60');res.send(b)}catch(e){res.status(502).end()}})
    app.get(`${tileBase}/hazards/:slot/:z/:x/:y.png`, async (req, res) => {
      try {
        if (!cfg.hazardOverlayEnabled) return res.status(404).end()
        const slot=Number(req.params.slot),z=Number(req.params.z),x=Number(req.params.x),y=Number(req.params.y)
        if (![slot,z,x,y].every(Number.isInteger) || slot < 0 || slot >= cfg.hazardOverlaySlots || z < cfg.minZoom || z > cfg.maxZoom) return res.status(400).end()
        const snap=hazardSnapshots.get(slot)
        const b=renderHazardTile(snap?.cells || [],z,x,y,{predictionMinutes:cfg.hazardPredictionMinutes})
        res.set('Content-Type','image/png'); res.set('Cache-Control','public, max-age=15'); res.send(b)
      } catch (e) { res.status(500).end() }
    })
    assetsMounted = true
  }

  async function processStorm(target, latest, buffer) {
    if (!cfg.stormEnabled || target !== cfg.stormSource) return
    const t = splitTarget(target), provider = getProvider(t.providerId), meta = getProduct(provider, t.product)
    if (!productCapabilities(provider, meta).cells) return
    const features = await provider.cellsFromRaw(t.product, buffer)
    const inferred = await inferenceEngine.infer({ snapshot:{epochMs:latest.epochMs,features}, vessel:vessel(), lightningStrikes, environmentContext, weatherApiContext, config:cfg, now:Date.now() })
    const inferenceHealth = inferenceEngine.describe().health
    if (!inferenceHealth.usable) {
      notify('warn', 'Storm inference unavailable; no all-clear can be established', { provider: t.providerId, product: t.product, time: latest.time, inference: inferenceHealth })
      throw new Error(`storm inference unavailable (${inferenceHealth.failedAlgorithms.join(', ') || 'no authoritative detector'})`)
    }
    cells = inferred.map(c => ({ ...c, provider: t.providerId, product: t.product, time: latest.time }))
    publishHazardSnapshot(latest.time)
    const threatening = cells.find(c => c.state === 'alarm') || cells.find(c => c.state === 'warn')
    if (threatening) notify(threatening.state, stormMessage(threatening), { provider: t.providerId, product: t.product, time: latest.time, cell: threatening })
    else if (inferenceHealth.state === 'degraded') notify('warn', 'Storm inference degraded; no authoritative all-clear is available', { provider: t.providerId, product: t.product, time: latest.time, inference: inferenceHealth })
    else notify('normal', 'No approaching severe-weather cell detected', { provider: t.providerId, product: t.product, time: latest.time, inference: inferenceHealth })
  }

  async function acquireOne(target) {
    const t = splitTarget(target), provider = getProvider(t.providerId), meta = getProduct(provider, t.product), caps = productCapabilities(provider, meta)
    if (!caps.raw) throw new Error(`${target} does not advertise raw acquisition`)
    const latest = await fetchLatest(t.providerId, t.product)
    if (lastAcquired[target] === latest.epochMs) return false
    const storageProduct = `${t.providerId}--${t.product}`
    const expectedExt = typeof provider.rawExtension === 'function' ? provider.rawExtension(t.product, '') : '.bin'
    let raw
    if (await storage.has(storageProduct, latest.epochMs, expectedExt)) raw = await storage.get(storageProduct, latest.epochMs, expectedExt)
    else {
      const d = await provider.downloadRaw(t.product, latest.epochMs)
      raw = d.buffer
      const ext = typeof provider.rawExtension === 'function' ? provider.rawExtension(t.product, d.key) : '.bin'
      await storage.put(storageProduct, latest.epochMs, raw, ext)
    }
    await processStorm(target, latest, raw)
    lastAcquired[target] = latest.epochMs
    return true
  }

  async function prefetchOne(target) {
    if (!cfg.prefetchEnabled || !tileStore?.enabled) return { target, skipped: 'disabled' }
    const pos = vessel().position
    if (!pos) return { target, skipped: 'no-position' }
    const t = splitTarget(target), provider = getProvider(t.providerId), meta = getProduct(provider, t.product)
    if (!productCapabilities(provider, meta).map) return { target, skipped: 'not-renderable' }
    const latest = await fetchLatest(t.providerId, t.product)
    const productMinZoom = Number.isFinite(meta.minZoom) ? meta.minZoom : cfg.minZoom
    const productMaxZoom = Number.isFinite(meta.maxZoom) ? meta.maxZoom : cfg.maxZoom
    const zooms = cfg.prefetchZooms.filter(z => z >= productMinZoom && z <= productMaxZoom)
    if (!zooms.length) return { target, skipped: 'no-supported-prefetch-zooms' }
    const tiles = tilesAroundPosition(pos, cfg.prefetchRadiusNm * NM, zooms, cfg.prefetchMaxTilesPerCycle)
    const signature = `${latest.epochMs}:${tiles.length}:${tiles[0] ? `${tiles[0].z}/${tiles[0].x}/${tiles[0].y}` : '-'}:${tiles.at(-1) ? `${tiles.at(-1).z}/${tiles.at(-1).x}/${tiles.at(-1).y}` : '-'}`
    if (lastPrefetched[target]?.signature === signature) return { target, skipped: 'already-current-area', epochMs: latest.epochMs }
    let next = 0, stored = 0, reused = 0, failed = 0
    const workers = Array.from({ length: Math.max(1, Math.min(cfg.prefetchConcurrency, tiles.length || 1)) }, async () => {
      while (next < tiles.length) {
        const tile = tiles[next++]
        const existing = await tileStore.get(t.providerId, t.product, latest.epochMs, tile.z, tile.x, tile.y)
        if (existing) { reused++; continue }
        try {
          const b = await fetchTileNetwork(t.providerId, t.product, tile.z, tile.x, tile.y, latest.time)
          await tileStore.put(t.providerId, t.product, latest.epochMs, tile.z, tile.x, tile.y, b); stored++
        } catch (e) { failed++; if (failed === 1) err(`Prefetch ${target}: ${e.message}`) }
      }
    })
    await Promise.all(workers)
    if (stored + reused > 0) lastPrefetched[target] = { epochMs: latest.epochMs, frame: latest.time, signature, position: { latitude: Number(pos.latitude), longitude: Number(pos.longitude) }, tiles: tiles.length, stored, reused, failed, completedAt: new Date().toISOString() }
    return { target, epochMs: latest.epochMs, frame: latest.time, tiles: tiles.length, stored, reused, failed, signature }
  }

  async function prefetchCycle() {
    const results = []
    if (!cfg.prefetchEnabled) return results
    for (const target of cfg.prefetchTargets) {
      try { results.push(await prefetchOne(target)); recovered(`prefetch:${target}`) } catch (e) { err(`Prefetch ${target}: ${e.message}`, `prefetch:${target}`); results.push({ target, error: e.message }) }
    }
    await tileStore?.recycle()
    return results
  }

  async function lightningCycle(){
    if(!cfg.lightningEnabled)return
    const pos=vessel().position;if(!pos)return
    const dlat=cfg.lightningQueryRadiusNm*NM/111320,dlon=dlat/Math.max(.1,Math.cos(Number(pos.latitude)*Math.PI/180));const bounds=[Number(pos.longitude)-dlon,Number(pos.latitude)-dlat,Number(pos.longitude)+dlon,Number(pos.latitude)+dlat]
    const now=Date.now(),since=new Date(now-cfg.lightningLookbackMinutes*60000).toISOString(),until=new Date(now).toISOString(),all=[]
    for(const [id,p] of observationProviders){if(typeof p.observations!=='function')continue;try{const rows=await p.observations({type:'lightning',bounds,since,until,vessel:vessel()});for(const r of rows||[])all.push({...r,provider:r.provider||id})}catch(e){err(`Lightning ${id}: ${e.message}`)}}
    const seen=new Set();lightningStrikes=all.filter(r=>{const k=`${r.provider}:${r.id}`;if(seen.has(k))return false;seen.add(k);const t=new Date(r.time).getTime(),age=now-t;return Number.isFinite(t)&&age>=0&&age<=cfg.lightningLookbackMinutes*60000}).sort((a,b)=>new Date(b.time)-new Date(a.time))
    const summary=lightningSummary(lightningStrikes,pos,now),nearest=(summary.nearestStrikeMeters??Infinity)/NM
    let st='normal';if(summary.count30min>=cfg.lightningMinStrikes&&nearest<=cfg.lightningAlarmNm)st='alarm';else if(summary.count30min>=cfg.lightningMinStrikes&&nearest<=cfg.lightningWarningNm)st='warn'
    const msg=st==='normal'?'No nearby recent lightning detected':`Lightning ${st}: ${nearest.toFixed(1)} NM nearest strike, ${summary.count10min} strikes in 10 min${summary.jump.detected?', rapid increase detected':''}`
    if(st!==lightningState||msg!==lightningMessage){lightningState=st;lightningMessage=msg;notifyPath(cfg.lightningNotificationPath,st,msg,{summary,providers:[...observationProviders.keys()]})}
  }

  async function acquireCycle() {
    if (!running || busy || !cfg.backgroundEnabled) return
    busy = true
    try {
      if(cfg.onboardEnvironmentEnabled) environmentContext=environmentFusion.sample(app)
      if(cfg.weatherApiObservationsEnabled){const pos=vessel().position;weatherApiContext=pos?await weatherApiFusion.sample(app,pos):{available:false,reason:'no-position',samples:[]}}
      await lightningCycle()
      for (const target of cfg.acquisitionTargets) try { await acquireOne(target); recovered(`acquisition:${target}`) } catch (e) { err(`Acquisition ${target}: ${e.message}`, `acquisition:${target}`) }
      await prefetchCycle()
      await storage.recycle()
      status(`Weather radar active; ${cfg.displayLayers.length} overlays; ${providers.size} providers; storm ${lastAlarm}`)
    } finally { busy = false }
  }

  function schedule() {
    if (timer) clearInterval(timer)
    if (cfg.backgroundEnabled) {
      timer = setInterval(() => acquireCycle().catch(e => err(e.message)), cfg.pollSeconds * 1000); timer.unref?.()
      const t = setTimeout(() => acquireCycle().catch(e => err(e.message)), 100); t.unref?.()
    }
  }

  plugin.start = function (settings = {}) {
    // Provider-specific legacy migrations belong to adapters. The only historical
    // core migration retained here is the old unqualified product-list shape; it
    // is assigned to the first adapter that explicitly declares itself legacyDefault.
    const legacyAdapter = [...ADAPTERS.values()].find(a => a.legacyDefault)
    const legacyDisplay = legacyAdapter && Array.isArray(settings.displayProducts) ? settings.displayProducts.map(p => `${legacyAdapter.id}:${p}`) : null
    const legacyAcquire = legacyAdapter && Array.isArray(settings.acquireProducts) ? settings.acquireProducts.map(p => `${legacyAdapter.id}:${p}`) : null
    cfg = {
      ...DEFAULTS, ...settings,
      providerSettings: settings.providerSettings && typeof settings.providerSettings === 'object' ? settings.providerSettings : {},
      lightningProviderSettings: settings.lightningProviderSettings && typeof settings.lightningProviderSettings==='object'?settings.lightningProviderSettings:{},
      lightningProviders: Array.isArray(settings.lightningProviders)?[...new Set(settings.lightningProviders.filter(id=>OBSERVATION_ADAPTERS.has(id)))]:[...DEFAULTS.lightningProviders],
      enabledProviders: Array.isArray(settings.enabledProviders) ? [...new Set(settings.enabledProviders.filter(id => KNOWN_PRODUCTS[id]))] : [...DEFAULTS.enabledProviders],
      displayLayers: parseTargets(settings.displayLayers || legacyDisplay, DEFAULTS.displayLayers),
      acquisitionTargets: parseTargets(settings.acquisitionTargets || legacyAcquire, DEFAULTS.acquisitionTargets),
      stormSource: validTarget(settings.stormSource) ? splitTarget(settings.stormSource).key : DEFAULTS.stormSource,
      pollSeconds: Math.max(15, Number(settings.pollSeconds) || DEFAULTS.pollSeconds),
      storageMaxMB: Number.isFinite(Number(settings.storageMaxMB)) ? Math.max(0, Number(settings.storageMaxMB)) : DEFAULTS.storageMaxMB,
      storageMaxAgeHours: Number.isFinite(Number(settings.storageMaxAgeHours)) ? Math.max(0, Number(settings.storageMaxAgeHours)) : DEFAULTS.storageMaxAgeHours,
      prefetchTargets: parseTargets(settings.prefetchTargets, DEFAULTS.prefetchTargets),
      prefetchRadiusNm: Number.isFinite(Number(settings.prefetchRadiusNm)) ? Math.max(1, Number(settings.prefetchRadiusNm)) : DEFAULTS.prefetchRadiusNm,
      prefetchZooms: Array.isArray(settings.prefetchZooms) ? [...new Set(settings.prefetchZooms.map(Number).filter(z => Number.isInteger(z) && z >= 0 && z <= 22))].sort((a,b)=>a-b) : [...DEFAULTS.prefetchZooms],
      prefetchMaxTilesPerCycle: Math.max(1, Number(settings.prefetchMaxTilesPerCycle) || DEFAULTS.prefetchMaxTilesPerCycle),
      prefetchStorageMaxMB: Number.isFinite(Number(settings.prefetchStorageMaxMB)) ? Math.max(0, Number(settings.prefetchStorageMaxMB)) : DEFAULTS.prefetchStorageMaxMB,
      prefetchStorageMaxAgeHours: Number.isFinite(Number(settings.prefetchStorageMaxAgeHours)) ? Math.max(0, Number(settings.prefetchStorageMaxAgeHours)) : DEFAULTS.prefetchStorageMaxAgeHours,
      prefetchConcurrency: Math.max(1, Math.min(32, Number(settings.prefetchConcurrency) || DEFAULTS.prefetchConcurrency)),
      playbackSlots: Math.max(1, Math.min(72, Number(settings.playbackSlots) || DEFAULTS.playbackSlots)),
      playbackTimelineMinutes: Math.max(5, Math.min(24 * 60, Number(settings.playbackTimelineMinutes) || DEFAULTS.playbackTimelineMinutes)),
      playbackIntervalMs: Math.max(250, Math.min(10000, Number(settings.playbackIntervalMs) || DEFAULTS.playbackIntervalMs)),
      hazardOverlaySlots: Math.max(1, Math.min(72, Number(settings.hazardOverlaySlots) || DEFAULTS.hazardOverlaySlots)),
      hazardPredictionMinutes: Array.isArray(settings.hazardPredictionMinutes) ? [...new Set(settings.hazardPredictionMinutes.map(Number).filter(v => Number.isFinite(v) && v > 0 && v <= 180))].sort((a,b)=>a-b) : [...DEFAULTS.hazardPredictionMinutes],
      hazardOverlayOpacity: Number.isFinite(Number(settings.hazardOverlayOpacity)) ? Math.max(0, Math.min(1, Number(settings.hazardOverlayOpacity))) : DEFAULTS.hazardOverlayOpacity,
      stormHistoryFrames: Math.max(2, Math.min(24, Number(settings.stormHistoryFrames) || DEFAULTS.stormHistoryFrames)),
      stormPathStepSec: Math.max(15, Math.min(300, Number(settings.stormPathStepSec) || DEFAULTS.stormPathStepSec)),
      stormBaseUncertaintyNm: Number.isFinite(Number(settings.stormBaseUncertaintyNm)) ? Math.max(0, Math.min(20, Number(settings.stormBaseUncertaintyNm))) : DEFAULTS.stormBaseUncertaintyNm,
      stormMaxUncertaintyNm: Math.max(1, Math.min(50, Number(settings.stormMaxUncertaintyNm) || DEFAULTS.stormMaxUncertaintyNm)),
      lightningLookbackMinutes:Math.max(5,Math.min(180,Number(settings.lightningLookbackMinutes)||DEFAULTS.lightningLookbackMinutes)),lightningQueryRadiusNm:Math.max(10,Math.min(500,Number(settings.lightningQueryRadiusNm)||DEFAULTS.lightningQueryRadiusNm)),lightningAssociationRadiusNm:Math.max(.5,Math.min(100,Number(settings.lightningAssociationRadiusNm)||DEFAULTS.lightningAssociationRadiusNm)),lightningEvidenceWeight:Number.isFinite(Number(settings.lightningEvidenceWeight))?Math.max(0,Math.min(.3,Number(settings.lightningEvidenceWeight))):DEFAULTS.lightningEvidenceWeight,lightningWarningNm:Math.max(1,Number(settings.lightningWarningNm)||DEFAULTS.lightningWarningNm),lightningAlarmNm:Math.max(.5,Number(settings.lightningAlarmNm)||DEFAULTS.lightningAlarmNm),lightningMinStrikes:Math.max(1,Number(settings.lightningMinStrikes)||DEFAULTS.lightningMinStrikes),onboardEnvironmentHistoryMinutes:Math.max(5,Math.min(180,Number(settings.onboardEnvironmentHistoryMinutes)||DEFAULTS.onboardEnvironmentHistoryMinutes)),onboardEnvironmentMaxAgeSeconds:Math.max(10,Math.min(3600,Number(settings.onboardEnvironmentMaxAgeSeconds)||DEFAULTS.onboardEnvironmentMaxAgeSeconds)),onboardEnvironmentEvidenceWeight:Number.isFinite(Number(settings.onboardEnvironmentEvidenceWeight))?Math.max(0,Math.min(.3,Number(settings.onboardEnvironmentEvidenceWeight))):DEFAULTS.onboardEnvironmentEvidenceWeight,weatherApiSampleRadiusNm:Math.max(1,Math.min(300,Number(settings.weatherApiSampleRadiusNm)||DEFAULTS.weatherApiSampleRadiusNm)),weatherApiSampleBearings:Math.max(4,Math.min(16,Number(settings.weatherApiSampleBearings)||DEFAULTS.weatherApiSampleBearings)),weatherApiMaxCount:Math.max(1,Math.min(12,Number(settings.weatherApiMaxCount)||DEFAULTS.weatherApiMaxCount)),weatherApiMaxAgeMinutes:Math.max(5,Math.min(180,Number(settings.weatherApiMaxAgeMinutes)||DEFAULTS.weatherApiMaxAgeMinutes)),weatherApiEvidenceWeight:Number.isFinite(Number(settings.weatherApiEvidenceWeight))?Math.max(0,Math.min(.3,Number(settings.weatherApiEvidenceWeight))):DEFAULTS.weatherApiEvidenceWeight,
      inferenceAlgorithms:Array.isArray(settings.inferenceAlgorithms)?[...new Set(settings.inferenceAlgorithms.filter(id=>INFERENCE_ALGORITHMS.has(id)))]:[...DEFAULTS.inferenceAlgorithms], inferenceStrategy:['max-severity','weighted-confidence'].includes(settings.inferenceStrategy)?settings.inferenceStrategy:DEFAULTS.inferenceStrategy, inferenceAlgorithmSettings:settings.inferenceAlgorithmSettings&&typeof settings.inferenceAlgorithmSettings==='object'?settings.inferenceAlgorithmSettings:{}
    }
    // Any configured layer/acquisition/storm source implicitly enables its provider.
    for (const key of [...cfg.displayLayers, ...cfg.acquisitionTargets, ...cfg.prefetchTargets, cfg.stormSource]) {
      const t = splitTarget(key); if (t && !cfg.enabledProviders.includes(t.providerId)) cfg.enabledProviders.push(t.providerId)
    }
    providers = instantiateAdapters(ADAPTERS, cfg.enabledProviders, cfg, cfg.providerSettings, settings)
    observationProviders=instantiateObservationAdapters(OBSERVATION_ADAPTERS,cfg.lightningProviders,cfg,cfg.lightningProviderSettings)
    cache = makeCache(Math.max(16, Number(cfg.cacheEntries) || DEFAULTS.cacheEntries))
    mountAssets()
    hazardSnapshots = new Map(); hazardSequence = 0; activeHazardSlot = 0
    charts = Object.fromEntries([...cfg.displayLayers.flatMap(key => { const t = splitTarget(key); return chartRecords(plugin.id, getProvider(t.providerId), t.product, cfg) }), ...hazardChartRecords(plugin.id, cfg), ...lightningChartRecord(plugin.id,cfg), ...lightningDensityChartRecords(plugin.id,cfg,observationProviders)])
    storage = new RecyclingStorage(path.join(dataDir(), 'archive'), { enabled: cfg.storageEnabled, maxBytes: cfg.storageMaxMB * 1024 * 1024, maxAgeMs: cfg.storageMaxAgeHours * 3600 * 1000 })
    storage.init().catch(e => err(e.message))
    tileStore = new TileStore(path.join(dataDir(), 'prefetch'), { enabled: cfg.prefetchEnabled, maxBytes: cfg.prefetchStorageMaxMB * 1024 * 1024, maxAgeMs: cfg.prefetchStorageMaxAgeHours * 3600 * 1000 })
    tileStore.init().catch(e => err(e.message))
    environmentFusion=new EnvironmentFusion({historyMinutes:cfg.onboardEnvironmentHistoryMinutes,maxAgeSec:cfg.onboardEnvironmentMaxAgeSeconds})
    weatherApiFusion=new WeatherApiFusion({radiusNm:cfg.weatherApiSampleRadiusNm,bearings:cfg.weatherApiSampleBearings,maxCount:cfg.weatherApiMaxCount,maxAgeMinutes:cfg.weatherApiMaxAgeMinutes})
    const stormConfig = { warnDistanceM: cfg.warnDistanceNm * NM, alarmDistanceM: cfg.alarmDistanceNm * NM, horizonMinutes: cfg.horizonMinutes, warnSeverity: cfg.warnSeverity, alarmSeverity: cfg.alarmSeverity, matchDistanceM: cfg.matchDistanceNm * NM, historyFrames: cfg.stormHistoryFrames, pathStepSec: cfg.stormPathStepSec, baseUncertaintyM: cfg.stormBaseUncertaintyNm * NM, maxUncertaintyM: cfg.stormMaxUncertaintyNm * NM }
    inferenceAlgorithms=instantiateInferenceAlgorithms(INFERENCE_ALGORITHMS,cfg.inferenceAlgorithms,cfg.inferenceAlgorithmSettings,{stormConfig})
    inferenceEngine=new InferenceEngine(inferenceAlgorithms,{strategy:cfg.inferenceStrategy})

    app.registerResourceProvider({ type: 'stormIntelligence', methods: { listResources: async () => radarResources(), getResource: async id => { const all = await radarResources(); if (!all[id]) throw new Error(`Storm Intelligence resource not found: ${id}`); return all[id] }, setResource: async () => { throw new Error('read-only') }, deleteResource: async () => { throw new Error('read-only') } } })
    // v1.x compatibility alias; deprecated and scheduled for removal in v3.
    app.registerResourceProvider({ type: 'weatherRadar', methods: { listResources: async () => { const all = await radarResources(); return Object.fromEntries(Object.entries(all).map(([k,v]) => [k, { ...v, deprecated: true, replacement: 'stormIntelligence' }])) }, getResource: async id => { const all = await radarResources(); if (!all[id]) throw new Error(`Deprecated weatherRadar resource not found: ${id}`); return { ...all[id], deprecated: true, replacement: 'stormIntelligence' } }, setResource: async () => { throw new Error('read-only') }, deleteResource: async () => { throw new Error('read-only') } } })
    app.registerResourceProvider({ type: 'charts', methods: { listResources: async () => charts, getResource: async id => { if (!charts[id]) throw new Error(`Chart not found: ${id}`); return charts[id] }, setResource: async () => { throw new Error('read-only') }, deleteResource: async () => { throw new Error('read-only') } } })
    const manifest = extensionManifest(plugin.id, plugin.version)
    app.registerResourceProvider({ type: 'plotterExtensions', methods: { listResources: async () => ({ [plugin.id]: manifest }), getResource: async id => { if (id !== plugin.id) throw new Error('Extension not found'); return manifest }, setResource: async () => { throw new Error('read-only') }, deleteResource: async () => { throw new Error('read-only') } } })
    running = true; schedule(); status('Storm Intelligence starting')
  }

  plugin.stop = function () { running = false; if (timer) clearInterval(timer); timer = null; cache.clear(); notify('normal', 'Storm Intelligence plugin stopped'); status('Stopped') }

  plugin.registerWithRouter = function (router) {
    const r = typeof router.access === 'function' ? router.access('readonly') : router
    r.get('/ui/plotter-bus.js', async (req, res) => { res.set('Content-Type', 'text/javascript; charset=utf-8'); res.send(await fs.readFile(path.join(__dirname, 'public', 'plotter-bus.js'), 'utf8')) })
    r.get('/ui/radar-panel.html', async (req, res) => { res.set('Content-Type', 'text/html; charset=utf-8'); res.send(await fs.readFile(path.join(__dirname, 'public', 'radar-panel.html'), 'utf8')) })
    r.get('/ui/storm-widget.html', async (req, res) => { res.set('Content-Type', 'text/html; charset=utf-8'); res.send(await fs.readFile(path.join(__dirname, 'public', 'storm-widget.html'), 'utf8')) })
    r.get('/health', async (req, res) => res.json({ ok: running, providers: [...providers.keys()], displayLayers: cfg.displayLayers, acquisitionTargets: cfg.acquisitionTargets, prefetchTargets: cfg.prefetchTargets, playbackEnabled: cfg.playbackEnabled, playbackSlots: cfg.playbackSlots, backgroundEnabled: cfg.backgroundEnabled, lastAcquired, lastPrefetched, cells: cells.length, stormState: lastAlarm, hazardOverlay: hazardOverlayStatus(), lastError, storage: await storage?.stats(), prefetchStorage: await tileStore?.stats() }))
    r.get('/providers', async (req, res) => res.json({ providers: Object.fromEntries([...providers].map(([id, p]) => [id, describeProvider(p)])) }))
    r.get('/products/:provider', async (req, res) => { try { res.json(describeProvider(getProvider(req.params.provider)).products) } catch (e) { res.status(e.statusCode || 404).json({ error: e.message }) } })
    r.get('/latest/:provider/:product', async (req, res) => { try { res.json(await fetchLatest(req.params.provider, String(req.params.product).toUpperCase())) } catch (e) { res.status(e.statusCode || 502).json({ error: e.message }) } })
    r.get('/timeline/:provider/:product', async (req, res) => { try { const minutes = Math.max(5, Math.min(24 * 60, Number(req.query.minutes) || 180)); res.json(await fetchTimeline(req.params.provider, String(req.params.product).toUpperCase(), minutes)) } catch (e) { res.status(e.statusCode || 502).json({ error: e.message }) } })
    r.get('/playback/:provider/:product', async (req, res) => { try { res.json(await playbackFrames(req.params.provider, String(req.params.product).toUpperCase())) } catch (e) { res.status(e.statusCode || 502).json({ error: e.message }) } })
    r.get('/tiles/:provider/:product/:z/:x/:y.png', async (req, res) => { try { const p = String(req.params.product).toUpperCase(), z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y); if (![z, x, y].every(Number.isInteger)) return res.status(400).json({ error: 'Invalid tile coordinates' }); const b = await fetchTile(req.params.provider, p, z, x, y, req.query.time, req.query.slot); res.set('Content-Type', 'image/png'); res.set('Cache-Control', `public, max-age=${cfg.cacheSeconds}`); res.send(b) } catch (e) { res.status(e.statusCode || 502).json({ error: e.message }) } })
    r.get('/operational', async (req, res) => res.json(await operationalStatus()))
    r.get('/status', async (req, res) => res.json(await radarStatus()))
    r.get('/cells', async (req, res) => res.json({ source: cfg.stormSource, state: lastAlarm, cells }))
    r.get('/hazards', async (req, res) => res.json(currentHazards()))
    r.get('/lightning',async(req,res)=>res.json({providers:[...observationProviders].map(([id,p])=>describeObservationProvider(p)),state:lightningState,message:lightningMessage,summary:lightningSummary(lightningStrikes,vessel().position),observations:lightningStrikes}))
    r.get('/onboard-environment',async(req,res)=>res.json(environmentContext))
    r.get('/weather-observations',async(req,res)=>res.json(weatherApiContext))
    r.get('/inference',async(req,res)=>res.json(inferenceEngine?.describe()||{}))
    r.get('/replay/:provider/:product', async (req, res) => { try { const frames = await tileStore.frames(req.params.provider, String(req.params.product).toUpperCase()); res.json({ provider: req.params.provider, product: String(req.params.product).toUpperCase(), frames: frames.map(epochMs => ({ epochMs, time: new Date(epochMs).toISOString() })) }) } catch (e) { res.status(500).json({ error: e.message }) } })
    r.post?.('/prefetch', async (req, res) => { try { res.json({ ok: true, results: await prefetchCycle(), lastPrefetched }) } catch (e) { res.status(500).json({ error: e.message }) } })
    r.post?.('/acquire', async (req, res) => { try { await acquireCycle(); res.json({ ok: true, lastAcquired }) } catch (e) { res.status(500).json({ error: e.message }) } })
  }

  plugin.getOpenApi = function () { return { openapi: '3.0.3', info: { title: 'Signal K Storm Intelligence API pilot', version: PACKAGE_VERSION, description: 'Multisensor storm-intelligence reference API composing radar mosaics, lightning, Signal K Weather API and onboard observations through pluggable inference algorithms.' }, paths: { '/providers': { get: { summary: 'Enabled radar mosaic providers' } }, '/operational': { get: { summary: 'Read-only operational dashboard status and ranked approaching storm cells' } }, '/status': { get: { summary: 'Storm Intelligence status' } }, '/cells': { get: { summary: 'Detected/tracked storm cells' } }, '/hazards': { get: { summary: 'Normalized GeoJSON storm hazards with predicted positions' } }, '/lightning':{get:{summary:'Normalized provider-agnostic lightning observations'}}, '/onboard-environment':{get:{summary:'Normalized onboard environmental sensor context'}}, '/weather-observations':{get:{summary:'Signal K Weather API observation evidence sampled around the vessel'}}, '/latest/{provider}/{product}': { get: { summary: 'Latest observation frame' } }, '/timeline/{provider}/{product}': { get: { summary: 'Available/inferred observation timeline' } }, '/playback/{provider}/{product}': { get: { summary: 'Normalized newest-first playback slots' } }, '/replay/{provider}/{product}': { get: { summary: 'Locally prefetched replay frames' } } } } }

  const allRasterTargets = Object.entries(KNOWN_PRODUCTS).flatMap(([pid, ps]) => Object.entries(ps).filter(([, p]) => p.kind === 'raster').map(([id]) => `${pid}:${id}`))
  const allRawTargets = Object.entries(KNOWN_PRODUCTS).flatMap(([pid, ps]) => Object.entries(ps).filter(([, p]) => p.raw === true).map(([id]) => `${pid}:${id}`))
  const allCellTargets = Object.entries(KNOWN_PRODUCTS).flatMap(([pid, ps]) => Object.entries(ps).filter(([, p]) => p.cells === true).map(([id]) => `${pid}:${id}`))
  plugin.schema = () => ({ type: 'object', properties: {
    enabledProviders: { title: 'Enabled radar mosaic providers', type: 'array', uniqueItems: true, default: DEFAULTS.enabledProviders, items: { type: 'string', enum: Object.keys(KNOWN_PRODUCTS) } },
    displayLayers: { title: 'Map overlay layers', type: 'array', uniqueItems: true, default: DEFAULTS.displayLayers, items: { type: 'string', enum: allRasterTargets } },
    backgroundEnabled: { title: 'Background acquisition', type: 'boolean', default: true },
    acquisitionTargets: { title: 'Raw products acquired in background', type: 'array', uniqueItems: true, default: DEFAULTS.acquisitionTargets, items: { type: 'string', enum: allRawTargets } },
    pollSeconds: { title: 'Acquisition poll interval (seconds)', type: 'integer', minimum: 15, maximum: 3600, default: 60 },
    storageEnabled: { title: 'Store acquired products', type: 'boolean', default: true }, storageMaxMB: { title: 'Maximum archive storage (MB, 0 unlimited)', type: 'integer', minimum: 0, default: 1024 }, storageMaxAgeHours: { title: 'Maximum archive age (hours, 0 unlimited)', type: 'number', minimum: 0, default: 24 },
    prefetchEnabled: { title: 'Geographic radar prefetch/offline cache', type: 'boolean', default: true }, prefetchTargets: { title: 'Raster products to prefetch around own ship', type: 'array', uniqueItems: true, default: DEFAULTS.prefetchTargets, items: { type: 'string', enum: [...allRasterTargets] } }, prefetchRadiusNm: { title: 'Prefetch radius around own ship (NM)', type: 'number', minimum: 1, maximum: 500, default: 40 }, prefetchZooms: { title: 'Prefetch zoom levels', type: 'array', uniqueItems: true, default: DEFAULTS.prefetchZooms, items: { type: 'integer', minimum: 0, maximum: 22 } }, prefetchMaxTilesPerCycle: { title: 'Maximum tiles per prefetch cycle', type: 'integer', minimum: 1, maximum: 20000, default: 1024 }, prefetchConcurrency: { title: 'Concurrent upstream prefetch requests', type: 'integer', minimum: 1, maximum: 32, default: 6 }, prefetchStorageMaxMB: { title: 'Maximum rendered prefetch storage (MB, 0 unlimited)', type: 'integer', minimum: 0, default: 512 }, prefetchStorageMaxAgeHours: { title: 'Maximum rendered prefetch age (hours, 0 unlimited)', type: 'number', minimum: 0, default: 6 },
    playbackEnabled: { title: 'Time-controlled radar playback charts', type: 'boolean', default: true }, playbackSlots: { title: 'Playback frame slots exposed to plotters', type: 'integer', minimum: 1, maximum: 72, default: 13 }, playbackTimelineMinutes: { title: 'Playback timeline lookback (minutes)', type: 'integer', minimum: 5, maximum: 1440, default: 180 }, playbackIntervalMs: { title: 'Freeboard animation interval (milliseconds)', type: 'integer', minimum: 250, maximum: 10000, default: 900 },
    hazardOverlayEnabled: { title: 'Storm-cell chart overlay', type: 'boolean', default: true }, hazardOverlaySlots: { title: 'Storm overlay rolling frame slots', type: 'integer', minimum: 1, maximum: 72, default: 24 }, hazardPredictionMinutes: { title: 'Predicted storm-cell envelopes (minutes)', type: 'array', uniqueItems: true, default: DEFAULTS.hazardPredictionMinutes, items: { type: 'number', minimum: 1, maximum: 180 } }, hazardOverlayOpacity: { title: 'Default storm-cell overlay opacity', type: 'number', minimum: 0, maximum: 1, default: 0.8 },
    stormEnabled: { title: 'Approaching storm-cell alarm', type: 'boolean', default: true }, stormHistoryFrames: { title: 'Storm tracking history frames', type: 'integer', minimum: 2, maximum: 24, default: 8 }, stormPathStepSec: { title: 'Storm/vessel path intersection step (seconds)', type: 'integer', minimum: 15, maximum: 300, default: 60 }, stormBaseUncertaintyNm: { title: 'Base storm-track uncertainty (NM)', type: 'number', minimum: 0, maximum: 20, default: 1 }, stormMaxUncertaintyNm: { title: 'Maximum storm-track uncertainty (NM)', type: 'number', minimum: 1, maximum: 50, default: 10 }, stormSource: { title: 'Storm-cell source', type: 'string', enum: allCellTargets, default: DEFAULTS.stormSource },
    warnDistanceNm: { title: 'Warning CPA/distance (NM)', type: 'number', minimum: 1, default: 20 }, alarmDistanceNm: { title: 'Alarm CPA/distance (NM)', type: 'number', minimum: 0.5, default: 8 }, horizonMinutes: { title: 'Approach prediction horizon (minutes)', type: 'integer', minimum: 10, maximum: 180, default: 60 }, warnSeverity: { title: 'Warning severity threshold', type: 'number', default: 3 }, alarmSeverity: { title: 'Alarm severity threshold', type: 'number', default: 4 }, matchDistanceNm: { title: 'Cell tracking match radius (NM)', type: 'number', minimum: 1, default: 30 }, notificationPath: { title: 'Signal K notification path', type: 'string', default: DEFAULTS.notificationPath },
    lightningEnabled:{title:'Lightning observation fusion',type:'boolean',default:false}, lightningProviders:{title:'Enabled lightning observation providers',type:'array',uniqueItems:true,default:DEFAULTS.lightningProviders,items:{type:'string',enum:[...OBSERVATION_ADAPTERS.keys()]}}, lightningProviderSettings:observationProviderSettingsSchema(OBSERVATION_ADAPTERS), lightningLookbackMinutes:{title:'Lightning lookback (minutes)',type:'integer',minimum:5,maximum:180,default:30}, lightningQueryRadiusNm:{title:'Lightning query radius (NM)',type:'number',minimum:10,maximum:500,default:120}, lightningAssociationRadiusNm:{title:'Maximum strike-to-cell association distance (NM)',type:'number',minimum:.5,maximum:100,default:8}, lightningEvidenceWeight:{title:'Maximum lightning confidence contribution',type:'number',minimum:0,maximum:.3,default:.15}, lightningOverlayEnabled:{title:'Show lightning overlay in plotters',type:'boolean',default:true}, lightningOverlayOpacity:{title:'Lightning overlay opacity',type:'number',minimum:0,maximum:1,default:.9}, lightningWarningNm:{title:'Lightning warning radius (NM)',type:'number',minimum:1,default:15}, lightningAlarmNm:{title:'Lightning alarm radius (NM)',type:'number',minimum:.5,default:8}, lightningMinStrikes:{title:'Minimum recent strikes for proximity warning',type:'integer',minimum:1,default:2}, lightningNotificationPath:{title:'Lightning Signal K notification path',type:'string',default:DEFAULTS.lightningNotificationPath},
    onboardEnvironmentEnabled:{title:'Fuse onboard environmental sensors',type:'boolean',default:true}, onboardEnvironmentHistoryMinutes:{title:'Onboard environment trend window (minutes)',type:'integer',minimum:5,maximum:180,default:30}, onboardEnvironmentMaxAgeSeconds:{title:'Maximum onboard sample age (seconds)',type:'integer',minimum:10,maximum:3600,default:180}, onboardEnvironmentEvidenceWeight:{title:'Maximum onboard evidence confidence contribution',type:'number',minimum:0,maximum:.3,default:.12},
    weatherApiObservationsEnabled:{title:'Fuse Signal K Weather API observations',type:'boolean',default:true}, weatherApiSampleRadiusNm:{title:'Weather API sampling radius (NM)',type:'number',minimum:1,maximum:300,default:40}, weatherApiSampleBearings:{title:'Weather API ring sample points',type:'integer',minimum:4,maximum:16,default:8}, weatherApiMaxCount:{title:'Weather API observations requested per sample point',type:'integer',minimum:1,maximum:12,default:3}, weatherApiMaxAgeMinutes:{title:'Maximum Weather API observation age (minutes)',type:'integer',minimum:5,maximum:180,default:30}, weatherApiEvidenceWeight:{title:'Maximum Weather API evidence confidence contribution',type:'number',minimum:0,maximum:.3,default:.15},
    inferenceAlgorithms:{title:'Enabled storm inference algorithms (executed together)',type:'array',uniqueItems:true,default:DEFAULTS.inferenceAlgorithms,items:{type:'string',enum:[...INFERENCE_ALGORITHMS.keys()]}}, inferenceStrategy:{title:'Inference ensemble strategy',type:'string',enum:['max-severity','weighted-confidence'],default:'max-severity'}, inferenceAlgorithmSettings:inferenceSettingsSchema(INFERENCE_ALGORITHMS),
    providerSettings: providerSettingsSchema(ADAPTERS),
    minZoom: { type: 'integer', minimum: 0, maximum: 22, default: 4 }, maxZoom: { type: 'integer', minimum: 0, maximum: 22, default: 13 }, cacheSeconds: { type: 'integer', minimum: 0, maximum: 3600, default: 60 }, cacheEntries: { type: 'integer', minimum: 16, maximum: 10000, default: 512 }, requestTimeoutMs: { type: 'integer', minimum: 1000, maximum: 60000, default: 10000 }
  } })

  plugin._test = { ADAPTERS, OBSERVATION_ADAPTERS, INFERENCE_ALGORITHMS, lightningChartRecord, lightningDensityChartRecords, lightningDensityChartId, KNOWN_PRODUCTS, tileBBox3857, normalizeTime, chartRecord, chartRecords, extensionManifest, splitTarget, parseTargets, DEFAULTS, tilesAroundPosition, playbackSlots, resolveSlot, playbackChartId, playbackChartName, hazardChartId, hazardChartName, hazardChartRecords, geometryBounds, config: () => cfg, acquireOne, acquireCycle }
  return plugin
}

module.exports._test = { ADAPTERS, OBSERVATION_ADAPTERS, INFERENCE_ALGORITHMS, lightningChartRecord, KNOWN_PRODUCTS, tileBBox3857, normalizeTime, chartRecord, chartRecords, extensionManifest, splitTarget, parseTargets, DEFAULTS, tilesAroundPosition, playbackSlots, resolveSlot, playbackChartId, playbackChartName, hazardChartId, hazardChartName, hazardChartRecords, geometryBounds }
