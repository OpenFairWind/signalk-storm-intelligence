# Signal K Storm Intelligence

[![Signal K Plugin CI](https://github.com/OpenFairWind/signalk-storm-intelligence/actions/workflows/plugin-ci.yml/badge.svg)](https://github.com/OpenFairWind/signalk-storm-intelligence/actions/workflows/plugin-ci.yml)
[![npm](https://img.shields.io/npm/v/signalk-storm-intelligence)](https://www.npmjs.com/package/signalk-storm-intelligence)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-43853d)](package.json)
[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Signal K Storm Intelligence** (`signalk-storm-intelligence`) is a multisensor severe-weather situational-awareness and research platform for Signal K. It combines shore-based weather-radar mosaics, lightning observations, Signal K Weather API observations, onboard environmental sensors, vessel navigation, and multiple independently pluggable inference algorithms to estimate storm-cell evolution and vessel-relative threat.

![Storm Intelligence operational dashboard](docs/screenshots/operational-dashboard.jpg)

The project is designed around two simultaneous goals:

1. **Operational decision support** aboard a vessel, including map overlays, approaching-cell warnings, offline radar playback, and a read-only operational dashboard.
2. **Reproducible scientific experimentation**, where new deterministic, machine-learning, or LLM-based inference algorithms can be compared against exactly the same frozen historical evidence bundles.

Storm Intelligence is **not** a replacement for official warnings, competent seamanship, marine radar, or authoritative meteorological services. Risk scores and inferred impact times are decision-support outputs, not certified probabilities or guarantees of hazardous-weather occurrence.

## Current release

This source tree is the `2.5.6` release line. Version 2 uses the application identity **Storm Intelligence**. The earlier `weatherRadar` Signal K Resource API remains available as a deprecated read-only compatibility alias during v2; new integrations should use `stormIntelligence`.

## Why this project exists

Weather information aboard small and medium vessels is often fragmented across independent applications: one service provides radar, another provides lightning, local instruments describe only conditions at the vessel, and forecast or observation services provide regional context. None of those sources alone answers the vessel-centric question:

> **Is an observed convective system approaching this vessel, when is the closest hazardous interaction expected, and how strong is the evidence?**

Storm Intelligence treats that question as a multisensor inference problem. Upstream data remain provider-specific at acquisition time, but are normalized before inference. Algorithms operate on common evidence and may run simultaneously. The ensemble retains per-algorithm provenance so agreement and disagreement remain inspectable.

## System architecture

```text
 Radar mosaic providers                 Lightning providers
 Radar-DPC · DWD · RainViewer           point events · density fields
             │                                      │
             └──────────────┬───────────────────────┘
                            │
                 normalized observations
                            │
          ┌─────────────────┼───────────────────┐
          │                 │                   │
 Signal K Weather API   onboard sensors     vessel navigation
 observations           wind/T/RH/...       position/SOG/COG
          │                 │                   │
          └─────────────────┴──────────┬────────┘
                                      │
                         Storm Intelligence Runtime
                                      │
                 ┌────────────────────┼────────────────────┐
                 │                    │                    │
          kinematic-polygon   multisensor-evidence   multimodal-dnn
                 │                    │                    │
                 └────────────────────┼────────────────────┤
                                      │             llm-openai-compatible
                                      │                    │
                                      └─────────┬──────────┘
                                                │
                                      inference ensemble
                                                │
                               hazards · tracks · threat state
                                                │
                  ┌─────────────────────┬────────┴───────────┐
                  │                     │                    │
             Signal K alarms       Freeboard-SK       read-only WebApp
```

The central architectural rule is **separation of concerns**. Radar providers do not implement storm inference. Lightning providers do not know about Freeboard-SK. Inference algorithms do not own acquisition or storage. User interfaces consume normalized runtime state rather than provider-specific payloads.

## Evidence domains

### Weather-radar mosaics

The bundled radar-provider registry currently includes:

- **Radar-DPC** — Italian Dipartimento della Protezione Civile national radar products; supports raster mosaics and provider-native HRD severe-precipitation vectors where available.
- **DWD** — Deutscher Wetterdienst WMS products with provider time dimensions and observation/nowcast separation.
- **RainViewer** — REST-discovered, provider-native XYZ radar frames.

The generic radar contract supports both WMS-style BBOX rendering and native XYZ tiles. A fourth radar provider should require a new adapter under `providers`, not changes to the inference engine or user interfaces. See [`docs/radar-provider-specification.md`](docs/radar-provider-specification.md).

### Lightning observations

Lightning is deliberately independent of radar. Observation providers may expose:

- timestamped **point strikes**;
- **density/frequency fields** for visualization or quantitative use when the upstream semantics support it;
- both capabilities.

Bundled adapters include a generic HTTP/JSON point source, Blitzortung-compatible point acquisition, and a configurable DPC LTG density adapter. Density imagery is never converted into synthetic point strikes. See [`docs/observation-provider-specification.md`](docs/observation-provider-specification.md).

### Signal K Weather API

Storm Intelligence consumes the existing Signal K Weather API as an independent evidence source. It samples observations around the vessel and uses normalized weather fields such as temperature, relative humidity, pressure, precipitation, true wind and gust when providers expose them.

Weather-station evidence corroborates existing storm candidates; it does not independently manufacture a remote storm cell.

### Onboard environmental sensors

When present, standard Signal K vessel paths contribute local trends, including:

- `environment.wind.speedTrue`
- `environment.wind.directionTrue`
- `environment.outside.temperature`
- `environment.outside.humidity`

Pressure, gust and precipitation can be incorporated when available through normalized contexts. Local trends are corroborating evidence, not sole storm detectors.

### Vessel navigation

Threat is vessel-relative. The runtime uses own-ship position, speed over ground and true course over ground to estimate closest approach and polygon/path interception over the configured horizon.

## Inference runtime

Inference algorithms are discovered from `inference-algorithms`. Each algorithm implements the common contract described in [`docs/inference-algorithm-specification.md`](docs/inference-algorithm-specification.md).

Bundled algorithms are:

- **`kinematic-polygon`** — persistent storm tracks, robust motion estimates, uncertainty, CPA/TCPA and vessel-path/polygon interception.
- **`multisensor-evidence`** — lightning and environmental corroboration of existing candidates.
- **`multimodal-dnn`** — a provider-agnostic pretrained feed-forward network using the normalized multimodal feature schema. The bundled reference model is intentionally disabled by default until validated on representative historical events.
- **`llm-openai-compatible`** — structured candidate refinement through an OpenAI API-compatible Responses or Chat Completions endpoint. It is disabled by default and cannot create a storm candidate when no primary candidate exists.

Algorithms can run together in one inference cycle. The runtime records execution status, latency, output count, model provenance and per-algorithm evidence. Supported ensemble strategies currently include `max-severity` and `weighted-confidence`.

Machine-learning and LLM inference are not granted special authority over deterministic methods. Their outputs remain attributable, bounded, and independently inspectable.

## Storm tracking and threat semantics

For polygon-capable storm products, the deterministic core maintains persistent track identities across frames and estimates motion from multiple observations rather than one displacement. Each track can expose:

- current geometry and representative centroid;
- observation history;
- motion speed and course;
- motion confidence and residual error;
- current range to the storm polygon;
- classical CPA/TCPA;
- projected vessel-path/polygon intersection;
- closest predicted polygon separation;
- uncertainty growth over the prediction horizon;
- lightning and environmental evidence;
- ensemble threat state and confidence.

The primary threat states are `normal`, `warn`, and `alarm`. Meteorological severity and vessel-relative threat are kept distinct: a severe storm far from and moving away from the vessel must not alarm solely because of its provider severity.

## Signal K integration

The plugin registers the following important Resource Provider surfaces:

```text
stormIntelligence    normalized status, providers, hazards and inference state
charts               radar, lightning and storm-hazard map layers
plotterExtensions    Freeboard-SK / compatible plotter extension
weatherRadar         deprecated v1 compatibility alias, read-only
```

Notifications are emitted under configurable Signal K notification paths, including storm-cell and lightning proximity notifications.

The companion WebApp is classified as `signalk-webapp` and is strictly read-only. It provides operational health and a risk-ranked list of approaching cells at:

```text
/signalk-storm-intelligence/
```

See [`docs/signal-k-integration.md`](docs/signal-k-integration.md) and [`docs/operational-webapp.md`](docs/operational-webapp.md).

## Freeboard-SK integration

The bundled Plotter Extension provides:

- radar-layer discovery, visibility and opacity controls;
- temporal radar playback using bounded frame-slot resources;
- storm-cell and predicted-envelope overlays;
- lightning overlays when configured;
- storm status and cell-location actions.

The extension uses published host capabilities such as `chart.list`, `chart.setVisibility`, `chart.setOpacity`, and `map.fitBounds`. It does not manipulate Freeboard-SK DOM or OpenLayers internals.

Public map tiles are exposed beneath:

```text
/stormintelligence/signalk-storm-intelligence/...
```

See [`docs/freeboard-sk.md`](docs/freeboard-sk.md).

## Background acquisition, offline operation and replay

Radar acquisition is a server-side process and does not depend on a browser being open. The runtime distinguishes:

- **archive** — provider-native source products retained for scientific or operational processing;
- **prefetch** — rendered geographic tiles retained around the vessel operating area;
- **replay** — locally available historical frames;
- **cache** — transient performance acceleration.

Archive and prefetch stores have independent retention budgets. Rendered radar tiles are served local-first, and live mode may degrade to an explicitly stale local frame when upstream access fails. Historical replay never silently substitutes a different timestamp for an explicitly selected frame.

See [`docs/storage-and-offline.md`](docs/storage-and-offline.md).

## Installation

Node.js 20 or newer is required.

From a source checkout:

```bash
npm install
npm run quality
```

For a development Signal K installation:

```bash
npm link
cd ~/.signalk
npm link signalk-storm-intelligence
```

Restart Signal K Server and enable **Storm Intelligence** in Plugin Config.

For an npm tarball, install the package through the normal Signal K plugin workflow or add it to the Signal K installation's dependencies.

## Configuration philosophy

Configuration is deliberately capability-driven. Providers advertise what they can supply, and inference algorithms advertise their own settings. Provider-qualified products use identifiers such as:

```text
radar-dpc:VMI
dwd:RAIN_RATE
rainviewer:COMPOSITE
```

The configuration schema covers radar display/acquisition, prefetch/recycling, temporal playback, storm thresholds, lightning providers, onboard sensor fusion, Weather API sampling, inference algorithms, and provider/model-specific settings.

See [`docs/configuration.md`](docs/configuration.md).

## Reproducibility and research use

Reproducibility is a first-class requirement. Algorithms intended for comparative research should be evaluated against frozen evidence bundles and must not retrieve live data during replay.

The reference historical case is the convective episode affecting the western coasts and seas of Italy during the night of **17–18 August 2026**. The guide defines acquisition, checksums, provenance, normalization, event-level train/validation/test separation, ablation experiments, deterministic replay, LLM response capture, and publication requirements.

Start with [`docs/reproducibility.md`](docs/reproducibility.md). The normative provider and algorithm interfaces are in:

- [`docs/data-provider-onboarding.md`](docs/data-provider-onboarding.md)
- [`docs/radar-provider-specification.md`](docs/radar-provider-specification.md)
- [`docs/observation-provider-specification.md`](docs/observation-provider-specification.md)
- [`docs/inference-algorithm-specification.md`](docs/inference-algorithm-specification.md)
- [`docs/storm-intelligence-model.md`](docs/storm-intelligence-model.md)

## Machine learning and LLM research boundaries

The bundled DNN is a **reference integration model**, pretrained on deterministic physically informed synthetic samples. Its synthetic validation score is useful for software verification, not a claim of operational meteorological skill. Any replacement model should include training provenance, feature schema, calibration/validation evidence, model checksum and limitations.

Remote LLM inference can transmit normalized vessel and weather evidence to the configured API endpoint. API keys are read from environment variables rather than persisted in plugin configuration. Hosted LLM calls are not assumed to be bit-reproducible; research experiments should capture validated structured responses and full non-secret request provenance.

See [`docs/multimodal-dnn.md`](docs/multimodal-dnn.md), [`docs/model-card-stormfusion-reference-v1.md`](docs/model-card-stormfusion-reference-v1.md), and [`docs/llm-openai-compatible.md`](docs/llm-openai-compatible.md).

## Scientific and operational limitations

Storm Intelligence is research-oriented decision-support software. Important limitations include:

- radar mosaics can have coverage gaps, attenuation, anomalous propagation, beam-height limitations and provider outages;
- lightning networks differ in detection efficiency, location accuracy, access terms and event classification;
- weather-station observations may be sparse, delayed, quality-controlled retrospectively, or model-filled by downstream aggregators;
- onboard measurements depend on sensor calibration, installation and vessel effects;
- storm-cell association, linear advection and uncertainty estimates simplify real convective evolution, including split/merge, growth and decay;
- machine-learning performance is dataset-dependent and susceptible to distribution shift;
- hosted LLM behavior can change between model/service revisions;
- the operational risk score is a transparent ranking heuristic, **not a probability of impact**;
- inferred ETA is conditional on current vessel motion, current track estimates and the selected prediction model.

Official meteorological warnings and direct situational awareness remain authoritative for safety-critical decisions.

## Testing and release quality

The repository provides deterministic unit/integration tests and opt-in live integration checks. The normal release gate is:

```bash
npm run quality
```

This runs repository consistency checks, syntax validation and the complete deterministic test suite. Network-dependent checks are intentionally separate:

```bash
npm run live-check
npm run live-check:llm   # requires explicit endpoint/model credentials
```

See [`docs/testing-and-validation.md`](docs/testing-and-validation.md) and [`AGENTS.md`](AGENTS.md).

## Documentation map

The complete documentation index is [`docs/README.md`](docs/README.md). Key documents include:

- [`docs/architecture.md`](docs/architecture.md) — architecture and trust boundaries;
- [`docs/storm-intelligence-model.md`](docs/storm-intelligence-model.md) — evidence/hazard/threat semantics;
- [`docs/reproducibility.md`](docs/reproducibility.md) — historical acquisition and reproducible replay;
- [`docs/security-privacy-licensing.md`](docs/security-privacy-licensing.md) — secrets, privacy, provider terms and storage;
- [`docs/board-proposal-notes.md`](docs/board-proposal-notes.md) — implementation-derived candidates for future Signal K standardization.

## Adding extensions

The project is designed so new capabilities are added at explicit extension points:

```text
providers/<id>.js                 radar mosaic provider
observation-providers/<id>.js     point/density observation provider
inference-algorithms/<id>.js      inference implementation
```

A contribution which requires provider-specific branches in the generic runtime, storage, Freeboard extension, or inference ensemble should be treated as an architectural regression unless there is a compelling documented reason.

Read [`AGENTS.md`](AGENTS.md) before modifying the project.

## Licence

Apache-2.0 for the project source code. Upstream meteorological data, model weights, lightning feeds and third-party services remain subject to their own licences, attribution requirements and usage restrictions. Redistribution permission must be assessed separately for every data provider and research dataset.
