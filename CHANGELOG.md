# Changelog

## Unreleased

## 2.5.2 - 2026-08-19

- Correct Radar-DPC latest-product discovery and raw-product downloads to use the documented `/wide/product` API routes, fixing the HRD background-acquisition HTTP 404 warning.
- Add deterministic coverage for Radar-DPC product discovery and raw-download request paths.
- Add a current Storm Intelligence Freeboard-SK integration screenshot to the operator documentation.

## 2.5.1 - 2026-08-18

- Complete the user-configurable lightning and onboard-environment evidence controls by exposing strike-to-cell association radius, lightning evidence weight and onboard sample freshness.
- Expose ensemble weights for the bundled deterministic inference algorithms and merge algorithm defaults before partial user overrides.
- Add configuration schema/default coverage tests and configuration maintenance rules to `AGENTS.md`.

## 2.5.0 - 2026-08-18

- Reject malformed, out-of-range, and future-dated lightning observations instead of treating them as fresh corroborating evidence.
- Add Signal K App Store metadata, a square application icon, an operational screenshot, current category keywords, and package discovery links.
- Add an explicit npm publish manifest that excludes contributor-only and local-development metadata while retaining tests and store assets.
- Add the reusable Signal K plugin CI workflow so install, load, activation, schema, lifecycle, package, platform, and test indicators appear in the App Store.
- Extend repository quality checks to enforce store assets, release notes, safe lifecycle scripts, and publish metadata.
- Upgrade `adm-zip` to 0.6.x to resolve the high-severity crafted-archive memory-allocation advisory reported by `npm audit`.

## 2.4.0

- Performed repository-wide release hardening and documentation review.
- Rewrote the main README around the current Storm Intelligence architecture, evidence domains, inference runtime, Signal K/Freeboard integration and scientific limitations.
- Added repository-wide `AGENTS.md` with architecture, safety, provider, inference, ML/LLM, security, testing, documentation and release rules.
- Expanded core documentation to academic/research-grade narratives with explicit time, provenance, uncertainty, safety and failure semantics.
- Strengthened `docs/reproducibility.md` with preregistration guidance, source-verification dates, independent annotation methodology, event-level statistics, execution-environment capture, dataset versioning, ML/LLM replay rules and publication artefacts.
- Added `docs/reproducibility-manifest.schema.json`.
- Added dependency-free `npm run quality` repository consistency checks.
- Hardened inference/observation registries against duplicate/mismatched runtime IDs and removed duplicated threat-merge computation.
- Added regression tests for registry identity invariants.

## 2.3.0

- Added a companion read-only Signal K WebApp in `public/index.html`, available at `/signalk-storm-intelligence/` and classified with the `signalk-webapp` keyword.
- Added `/operational`, a read-only consolidated operational API for runtime/component health and approaching storm cells.
- Added ranked approaching-cell summaries with impact/closest-approach ETA, range, confidence, source, uncertainty and transparent 0-100 operational risk score.
- Added component health for radar overlays, acquisition, offline prefetch/storage, storm source, lightning, onboard environment, Signal K Weather API and every enabled inference algorithm.
- Added WebApp documentation and read-only/security semantics.

## 2.2.0

- Added `llm-openai-compatible`, an optional OpenAI Responses / Chat Completions-compatible inference algorithm.
- Uses strict JSON-schema structured output and validates candidate ids before merging.
- API credentials are read only from configured environment variables.
- Added bounded one-step escalation, batching, retry/timeout handling, response caching and API provenance.
- Added `npm run live-check:llm` for opt-in real-endpoint validation.
- Added `docs/llm-openai-compatible.md` and expanded security, inference and reproducibility documentation.

## 2.1.0

- Added experimental `multimodal-dnn` inference algorithm using a bundled pretrained feed-forward DNN.
- Added provider-independent multimodal feature extraction for radar/hazard, lightning, onboard environment, Signal K Weather API and vessel-relative geometry.
- Added deterministic reference-model training script and model provenance/checksum reporting.
- Added `docs/multimodal-dnn.md` and ML reproducibility guidance.
- The bundled synthetic reference model is disabled by default and explicitly not claimed as operationally validated.


## 2.0.1

- Added `docs/reproducibility.md` with a provider-aware historical acquisition and frozen-evidence replay workflow, using the 17–18 August 2026 western Italy thunderstorm episode as the reference case.

## 2.0.0

- Renamed npm package/plugin from `signalk-weather-radar` to `signalk-storm-intelligence`.
- Renamed the user-facing extension to **Storm Intelligence**.
- Added primary `stormIntelligence` Resource API namespace.
- Retained deprecated read-only `weatherRadar` Resource API compatibility alias for v2.x migration.
- Moved public map asset route from `/weatherradar/...` to `/stormintelligence/...`.
- Retained weather radar as a subsystem/capability rather than the application identity.
- Updated documentation and migration guidance for the v2 identity.


## 1.1.0

- Added Blitzortung.org as a second independent point-strike lightning provider (credentialed, disabled by default).
- Generalized the observation-provider contract so point observations and density fields are independent capabilities.
- Added Radar-DPC LTG density/frequency WMS adapter without pretending LTG is raw strike data.
- Added independent Freeboard chart layers for lightning point strikes and density providers.
- Added regression tests for multi-provider point lightning, density-only providers, DPC LTG WMS requests, and discovery.

## 0.9.0 - 2026-08-18

- Added RainViewer as a third working radar-mosaic provider using the public Weather Maps REST catalogue and native hash-based XYZ tiles.
- Corrected the generic raster provider contract from WMS-shaped `tile(product, bbox, time)` to transport-neutral `tile(product, {z,x,y,bbox3857,size,crs}, time)`.
- Updated Radar-DPC and DWD adapters to consume `bbox3857` from the neutral tile request while preserving their WMS behavior.
- Added provider/product `minZoom` and `maxZoom` semantics; chart resources, direct tile requests and background prefetch now honor provider limits.
- Added RainViewer observation timeline, optional-nowcast awareness, metadata caching, color/smoothing/snow configuration, and live-check coverage.
- Strengthened the provider-leak regression to include all three bundled providers.
- Added real three-provider simultaneous chart/resource registration coverage in addition to the synthetic adapter-discovery test.
- Expanded deterministic tests to 34 passing cases.

## 0.8.0 - 2026-08-18

- Renamed the package/plugin identity to `signalk-weather-radar` to reflect provider-neutral scope.
- Added dynamic `providers/*.js` adapter discovery; the generic core no longer imports concrete providers.
- Moved provider defaults, endpoint settings, schemas, recommendations and legacy migrations into provider adapters.
- Added generated provider-specific configuration under `providerSettings.<providerId>`.
- Removed provider special cases from raw/cell target enumeration; capabilities come from product metadata.
- Added a synthetic third-provider discovery/instantiation regression test.
- Added a core/UI leak regression test preventing bundled-provider names/endpoints from re-entering generic modules.
- Kept Radar-DPC and DWD as bundled adapters exercising different upstream models.

## 0.7.0 - 2026-08-18

- Added persistent multi-frame storm track identities and robust velocity estimation.
- Added track confidence, residual error, observation history and motion provenance.
- Added vessel-path versus moving-polygon interception with uncertainty envelopes.
- Promoted vessel-relative threat to a first-class normalized hazard object while retaining centroid CPA/TCPA as a secondary diagnostic.
- Added tests for noisy tracks, confidence growth, polygon interception and normalized threat propagation.

## 0.6.0 - 2026-08-18

- Added a working storm-cell overlay on the Freeboard map without Freeboard/OpenLayers internals.
- Added provider-independent hazard normalization with current polygon, motion, CPA/TCPA and predicted cell envelopes.
- Added a dependency-free transparent PNG tile renderer for storm polygons, tracks and forecast envelopes.
- Added rolling hazard chart slots and the `weatherRadar` `hazards` resource.
- Added Freeboard storm-overlay visibility/opacity controls and per-cell Locate using standard host APIs.

## 0.5.0 - 2026-08-18

- Added working time-controlled radar playback on Freeboard-SK using only the standard Plotter Extensions `charts` capability.
- Added provider-agnostic playback frame slots and `/playback/{provider}/{product}`.
- Added offline playback-frame discovery from persisted prefetch frames.
- Added Freeboard scrubber, play/pause animation, live/offline labels and persisted selection.

## 0.4.0 - 2026-08-18

- Added persistent geographic prefetch around own ship with configurable radius/zooms/concurrency.
- Added separate rendered-tile retention policy, local-first serving, offline fallback and replay-frame discovery.
- Added movement-aware prefetch and antimeridian-safe tile enumeration.

## 0.3.0 - 2026-08-18

- Added Deutscher Wetterdienst (DWD) as the second working national radar provider.
- Added DWD RV rain-rate and WN reflectivity WMS overlays.
- Added WMS time-dimension parsing and observation-only latest-frame selection.
- Generalized provider-qualified display/acquisition/prefetch configuration and capability-based optional operations.

## 0.2.0 - 2026-08-18

- Added the generic weather-radar provider contract, Plotter Extensions UI, background acquisition/storage recycling and HRD storm-cell tracking/alarms.

## 0.1.0 - 2026-08-18

- Initial working Radar-DPC Signal K chart provider with VMI/SRI, XYZ-to-WMS proxy, latest/timeline endpoints and tests.

## 1.0.0 - Multisensor storm intelligence

- Added a provider-agnostic observation-provider registry, independent from weather-radar mosaic providers.
- Added a configurable generic HTTP/JSON lightning-strike adapter with URL templates, JSON array selection, field mapping, and optional HTTP headers.
- Added normalized lightning observations, recent-strike retention, 5/10/30 minute counts, rate trend, lightning-jump detection, nearest-strike distance, and an independent Signal K lightning notification lifecycle.
- Added optional Freeboard-SK lightning overlay rendered from normalized point observations; opacity/visibility use the standard Plotter Extensions charts capability.
- Added storm-cell/lightning association and lightning evidence in normalized threat confidence.
- Added onboard Signal K environmental fusion using true wind speed/direction, outside air temperature, and outside humidity when available.
- Added rolling onboard trends for wind strengthening, wind shift, temperature fall, and humidity rise. These are corroborating evidence only and cannot create a storm alarm by themselves.
- Added `/lightning` and `/onboard-environment` pilot API resources and matching `weatherRadar` Resource API entries.
- Expanded deterministic suite to 38 passing tests.

## 1.2.0

- Added consumer-side fusion of the existing Signal K Weather API (`app.weatherApi.getObservations`).
- Added provider-agnostic location sampling around the vessel (center plus configurable bearing ring).
- Normalizes Weather API temperature, humidity, pressure, precipitation, true wind, gust, dew point and visibility when available.
- Rejects stale/future observations before storm fusion.
- Adds cell-relative spatial corroboration comparing the observation nearest a storm cell with local/vessel-area observations.
- Weather API observations only boost confidence of an existing storm threat; they do not create storm alarms independently.
- Added `weatherObservations` Weather Radar resource and `/weather-observations` endpoint.
- Added Freeboard status for Weather API observation availability and coverage.
- Added configuration for sampling radius/count, observation age and confidence weight.

## 1.3.0

- Added discoverable, provider-independent storm inference algorithm registry and contract.
- Multiple inference algorithms can participate in the same evidence cycle with ensemble strategies and per-algorithm provenance/status.
- Moved kinematic polygon tracking/interception and multisensor corroboration behind separate inference adapters.
- Added `/inference` and inference resource/status metadata.
- Added comprehensive `docs` documentation set, including normative radar/observation provider contracts, provider onboarding requirements, inference algorithm specification, architecture, Signal K/Freeboard integration, offline/storage, validation, security/licensing, and board-proposal notes.
- Added tests proving multiple algorithms coexist and a synthetic third algorithm can be added without core changes.
