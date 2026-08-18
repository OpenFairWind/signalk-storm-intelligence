# Signal K Weather Radar API pilot — working draft

Status: implementation pilot, **not a Signal K specification**.

This plugin deliberately separates four concerns so that a future Signal K proposal can standardize the useful common surface without standardizing any one meteorological service:

1. **Provider** — discovers products/frames and obtains raster or vector source data.
2. **Presentation** — radar mosaics are ordinary `charts` resources; a `plotterExtensions` UI controls chart visibility/opacity through the host `charts` capability.
3. **Acquisition** — a server-side scheduler downloads selected products independently of any browser and optionally persists them with age/space recycling.
4. **Hazard intelligence** — provider vector cells are normalized, tracked between frames, related to own-ship motion and published as Signal K notifications.

## Pilot resource model

A provider describes itself as:

```json
{
  "id": "radar-dpc",
  "name": "Italian Civil Protection Radar-DPC",
  "products": {
    "VMI": {
      "kind": "raster",
      "units": "dBZ",
      "period": "PT5M",
      "capabilities": { "map": true, "raw": true, "cells": false }
    },
    "HRD": {
      "kind": "vector",
      "period": "PT5M",
      "capabilities": { "map": false, "raw": true, "cells": true }
    }
  }
}
```

The core currently exposes these pilot endpoints under the plugin route:

- authenticated `weatherRadar` resource collection for plotter-extension clients (`resources.list`);
- `GET /providers`
- `GET /products/{provider}`
- `GET /latest/{provider}/{product}`
- `GET /timeline/{provider}/{product}`
- `GET /tiles/{provider}/{product}/{z}/{x}/{y}.png[?time=...]`
- `GET /status`
- `GET /cells`
- `POST /acquire` (when the authenticated router grants it)

The chart resource carries an intentionally namespaced `weatherRadar` object. Unknown resource fields are metadata only; clients that do not understand them still see a normal raster chart.

## Candidate common concepts for a future Signal K proposal

The implementation suggests that a generic API should standardize *semantics* rather than upstream protocols:

- provider identity and attribution;
- product identity, kind (`raster`, `cells`, later `lightning`), units and nominal cadence;
- latest frame and temporal frame discovery;
- a renderable mosaic capability independent of upstream WMS/WMTS/XYZ transport;
- coverage and frame validity/staleness;
- optional server acquisition/archive capability and retention status;
- normalized tracked-cell output including geometry, severity, motion vector, source frame time and confidence;
- own-ship threat assessment (distance, DCPA/TCPA, closing state, warning state);
- notification binding and lifecycle.

Provider-specific facts such as DPC WMS layer names, archive projection, REST authentication/origin requirements, or HRD shapefile fields should **not** become part of Signal K.

## Candidate tracked-cell shape

```json
{
  "id": "provider-or-tracker-id",
  "provider": "radar-dpc",
  "product": "HRD",
  "time": "2026-08-18T00:30:00Z",
  "geometry": { "type": "Polygon", "coordinates": [] },
  "severity": 3.4,
  "motion": { "speed": 12.1, "course": 72.0 },
  "distanceMeters": 23800,
  "cpa": { "dcpaMeters": 6100, "tcpaSec": 1260, "closing": true },
  "state": "warn"
}
```

Motion speed is SI metres/second in the eventual normalized API; course is degrees true in this pilot's diagnostic representation. A formal proposal should settle angle representation consistently with Signal K conventions (radians on Signal K paths) and distinguish provider-supplied motion from tracker-estimated motion.

## Alarm policy

This pilot treats meteorological detection and vessel threat assessment as distinct stages. DPC HRD supplies meteorological polygons; the core estimates cell translation between successive frames, subtracts own-ship COG/SOG, calculates relative CPA within a configurable horizon, and applies configurable severity/proximity thresholds.

A nearby severe cell can alarm even if relative closing cannot yet be established (for example, on the first frame). A remote severe cell does not alarm merely because severity is high. When no threatening cell remains, the notification returns to `normal`.

Default notification path:

`notifications.environment.weather.storm`

This path is part of the pilot, not a claim that the path is currently standardized by Signal K.

## Open issues before proposing a specification

- Agree on a common product taxonomy without losing provider-specific products.
- Decide whether historical frames belong in a weather-radar resource API or a more general temporal-chart API.
- Define cell geometry/motion/confidence fields and SI/angle conventions.
- Define stale/missing-frame semantics and provider health.
- Decide which acquisition/archive controls are server API and which remain plugin configuration.
- Validate interoperability with at least one second radar provider and one second plotter host.
- Validate notification/path naming with the Signal K data model maintainers.
- Add optional provider push/watch support (DPC offers WebSocket delivery) without making push mandatory for providers that only poll.

## 0.3 interoperability findings: Radar-DPC + DWD

The second provider materially changed the draft contract.

Radar-DPC combines WMS rendering with an API that can download native raster/vector products. DWD, by contrast, is naturally consumed through its public GeoServer WMS for the products used here. Therefore **raw acquisition is not a mandatory weather-radar provider operation**. A provider must advertise capabilities per product rather than emulate unsupported operations.

The pilot now treats these as the minimal map-provider semantics:

```text
provider.id
provider.name
provider.products()
provider.latest(product)
provider.tile(product, bbox, time)
```

These are optional/capability-advertised:

```text
provider.timeline(product, options)
provider.downloadRaw(product, epoch)
provider.rawExtension(product, key)
provider.cellsFromRaw(product, buffer)
forecast availability
persistent archive availability
```

A normalized product now advertises:

```json
{
  "id": "RAIN_RATE",
  "kind": "raster",
  "units": "mm/h",
  "period": "PT5M",
  "capabilities": {
    "map": true,
    "temporal": true,
    "timeline": true,
    "raw": false,
    "cells": false,
    "forecast": true
  }
}
```

### Observation time versus forecast valid time

DWD RV/WN radar layers expose observations together with short radar nowcasts. This revealed that a generic `latest` field is ambiguous unless the API distinguishes observation frames from forecast-valid frames.

The 0.3 pilot defines `latest()` as **latest observation/current analysis**, never simply the maximum timestamp advertised by an upstream time dimension. DWD therefore selects the newest non-future WMS frame (within a small clock-skew tolerance). A future Signal K specification should explicitly model at least:

- `frameType`: `observation | analysis | nowcast | forecast`;
- `observedAt` or `analysisTime`;
- `validAt`;
- optional `leadTime`;
- `generatedAt` when supplied by the provider.

This prevents a +120 minute radar nowcast from being presented as if it were a measurement made at that future time.

### Provider-qualified product identifiers

Provider product names are not globally unique and should not be forced into a single lowest-common-denominator enumeration. The pilot therefore uses a qualified identity in configuration and acquisition:

```text
radar-dpc:VMI
radar-dpc:HRD
dwd:RAIN_RATE
dwd:REFLECTIVITY
```

The proposed Signal K resource model should carry separate `provider` and `product` fields but allow a stable qualified key for URLs/configuration.

### Acquisition semantics

"Background acquisition" also needs capability semantics. In the pilot it means acquisition of native provider products when `raw=true`, with provider/product namespaced storage and retention/recycling. A future standard should distinguish at least:

- `cache` — transient rendered-tile cache;
- `prefetch` — background acquisition of rendered map data for a configured area;
- `archive` — persistent provider-native frames;
- `replay` — historical frames available for rendering/analysis.

These are different operational promises and should not be represented by one boolean.

### What remains provider-specific

DWD-specific WMS layer names (`dwd:Niederschlagsradar`, `dwd:Radar_wn-product_1x1km_ger`), GeoServer URL structure and DWD styles remain adapter details. Radar-DPC REST origins, DPC layer names and HRD shapefile fields likewise remain adapter details.

The common API is now demonstrably above both transports rather than being a renamed DPC API.


## 0.4 interoperability finding: prefetch and offline replay are first-class semantics

Implementing real vessel-area prefetch showed that a future Signal K API should not treat persistence as a single `cache` boolean. The working pilot now separates provider-native archival from rendered geographic prefetch.

A map-capable product may advertise an optional `prefetch` capability even when `raw=false`. Prefetch operates on the normalized rendering interface, so it works for both Radar-DPC and WMS-first providers such as DWD.

The core concepts that emerged are:

```text
prefetch.area.center = own-ship position or explicit geographic point
prefetch.area.radius
prefetch.zooms
prefetch.frame
prefetch.retention.maxAge
prefetch.retention.maxBytes
prefetch.status
replay.frames[]
```

A client requesting a tile should not need to know whether the response came from live upstream rendering, exact local storage, or stale local fallback. Implementations should nevertheless expose source/staleness diagnostics to users and automation.

The implementation also demonstrates that prefetch identity must include both temporal frame and geographic tile coverage. A vessel can cross into a new tile set while the meteorological frame timestamp remains unchanged.

For disconnected operation, `latest` discovery failure cannot be fatal if locally persisted frames exist. The pilot therefore permits a local replay frame to satisfy a map request when upstream frame discovery is unavailable. A specification should define this explicitly as degraded/stale service rather than silently relabeling the frame as current.


## 0.5 interoperability finding: temporal charts need a host-level frame selector

Implementing playback against the real Plotter Extensions API exposed a specific gap. The version-1 `charts` capability can enumerate existing chart layers and set visibility, opacity and order, but deliberately cannot create a chart, replace its source URL or request a source refresh. This is correct for ordinary static charts but awkward for a logical weather-radar layer whose time dimension changes every few minutes.

The working 0.5 pilot therefore advertises a bounded set of **frame-slot chart resources**. Slot `0` is current/live; slot `N` resolves to the Nth older normalized provider frame. The extension animates by switching opaque chart ids through `chart.setVisibility`. This is host-agnostic and works today, but it causes extra chart resources and should not be the final specification.

A future Signal K / Plotter Extensions proposal should consider one of these equivalent semantic surfaces:

```text
chart.getTimeDomain({ id })
chart.setTime({ id, time | frameId | slot })
chart.timeChanged
```

or a generic temporal-resource capability that weather radar can use without making chart time radar-specific. Required semantics include:

- one logical chart identity across time;
- `live` versus explicitly selected historical frame;
- exact `validAt` / `observedAt` selection;
- nearest-frame policy when an exact requested time is unavailable;
- stale/offline source indication;
- host cache invalidation when the selected frame changes;
- optional animation cadence and available-domain discovery;
- client-local selection by default, rather than globally changing the server for every helm station.

The pilot's `/playback/{provider}/{product}` resource already supplies a normalized newest-first frame domain:

```json
{
  "provider": "radar-dpc",
  "product": "VMI",
  "source": "provider",
  "stale": false,
  "frames": [
    { "slot": 0, "time": "2026-08-18T01:00:00Z", "live": true },
    { "slot": 1, "time": "2026-08-18T00:55:00Z", "live": false }
  ]
}
```

If upstream discovery is unavailable, persisted rendered frames can populate the same domain with `source: "prefetch-replay"` and `stale: true`. This separation between temporal selection and transport/storage is a candidate requirement for the board proposal.


## 0.6 interoperability finding: hazard geometry should be standardized above provider cell formats

Adding storm-cell visualization exposed a second host/API boundary. Plotter Extensions API v1 `map.*` methods control only viewport state (`getView`, `center`, `fitBounds`); they do not let an extension inject arbitrary vector geometry. The pilot therefore renders normalized hazards as transparent `charts` tile resources and controls them through the existing `charts` capability. This works without a Freeboard fork, but the rasterized chart is an implementation technique rather than the desired weather-radar data model.

The provider-independent semantic resource is now `weatherRadar/hazards`. A hazard carries at least:

```text
id
provider
product/source
time
state                  normal | warn | alarm
severity
geometry               Polygon | MultiPolygon, WGS84
centroid
motion.east/north/speed/course
distanceMeters          own-ship to current polygon
cpa.dcpaMeters
cpa.tcpaSec
cpa.closing
predictions[]
  minutes
  centroid
  geometry
```

The first implementation derives this from Radar-DPC HRD, but none of the normalized field names depend on HRD shapefile attributes. A future provider could supply native storm objects, machine-derived cells, lightning clusters or another severe-weather polygon source and map them into the same hazard contract.

The visualization implementation adds three further lessons:

1. **Hazard data and hazard rendering are separate.** Clients should be able to consume vector hazards directly even if a plotter chooses raster tiles, native vectors or another rendering path.
2. **Threat state is vessel-relative.** `severity` belongs to the meteorological object; `state`, range and CPA/TCPA depend on own-ship state and policy thresholds. The specification should not conflate them.
3. **Prediction provenance matters.** The current pilot predicts geometry by advecting the tracked polygon with its estimated motion vector. Future providers may supply provider-native nowcast polygons. Each prediction should therefore eventually expose a `method` / `provenance` field (for example `tracked-linear`, `provider-nowcast`, `model`).

For Plotter Extensions, the pilot also demonstrates a possible future generic vector-overlay capability, conceptually:

```text
overlay.create({ id, type: "geojson", zIndex?, interactive? })
overlay.setData({ id, featureCollection })
overlay.setVisibility({ id, visible })
overlay.remove({ id })
```

Such a capability should be generic rather than weather-radar-specific. Until then, chart resources remain a standards-compliant compatibility mechanism, and `map.fitBounds` is sufficient for locating a selected hazard.


## 0.7 interoperability finding: hazard threat should be a first-class uncertainty-aware object

Operational testing of the v0.6 cell overlay showed that centroid CPA/TCPA is useful but insufficient for severe-weather alerting. A convective cell is an area, often elongated or irregular, while both the vessel and the cell move. The pilot now keeps persistent track identities and multiple observations, derives a robust motion estimate, and evaluates the vessel's projected path against the moving polygon itself.

The candidate normalized hazard therefore now separates meteorological object, tracking evidence and vessel-relative threat:

```text
trackId
sourceId
history[]
  time
  centroid

motion
  east / north / speed / course
  samples
  confidence             0..1
  residualMeters
  method                 track-robust | provider-native | ...

cpa                       secondary centroid-based metric

pathThreat
  intersects
  interceptSec
  minDistanceMeters
  minDistanceSec
  uncertaintyMeters

threat
  state                   normal | warn | alarm
  confidence              0..1
  method                  polygon-path | provider-native | ...
  intersects
  interceptSec
  minDistanceMeters
  minDistanceSec
  uncertaintyMeters
```

This yields four specification lessons.

1. **Track identity is not provider object identity.** A provider may rename/re-segment a cell between frames. Signal K clients need a locally or provider-assigned `trackId` distinct from an upstream `sourceId`.
2. **Uncertainty is part of the data, not merely presentation.** A predicted polygon without confidence/uncertainty can create false precision. Providers with native nowcasts may report their own uncertainty; derived trackers must expose theirs.
3. **Threat is vessel-relative and time-dependent.** The meteorological object can remain unchanged while threat changes because own-ship course/speed changes. `threat` should therefore not be embedded as immutable provider metadata.
4. **CPA/TCPA should remain available but not normative for polygon hazards.** The recommended severe-weather decision primitive is path-versus-moving-geometry interception/minimum separation.

The current implementation samples the horizon at a configurable interval and translates the observed polygon with the robust track velocity. This is deterministic and provider-independent. A future standard should allow higher-quality `provider-nowcast` or model trajectories to replace this method without changing the hazard/threat schema.


## 0.8 interoperability finding: providers are discoverable adapters

The plugin core no longer imports or enumerates concrete providers. Provider modules are discovered from an adapter directory and own their product catalog, defaults, configuration schema, recommended layers/acquisition targets, legacy migration and constructor. The generic core operates only on the normalized provider contract.

This yields a concrete extensibility requirement for a Signal K proposal: adding a third weather-radar mosaic provider must not require changing resource routing, chart generation, playback, prefetch/archive storage, Freeboard controls, hazard normalization or threat logic. A new provider should contribute only an adapter and, where applicable, provider-specific parsers.

The working implementation now has an automated synthetic-third-provider test to enforce this property.


## 0.9 interoperability finding: raster rendering must not be WMS-shaped

A third implementation adapter now consumes RainViewer's public REST frame catalogue and native XYZ radar tiles. This materially differs from both Radar-DPC and DWD. The previous internal `tile(product, bbox3857, time)` call was therefore still too WMS-specific.

The working provider contract now passes a normalized request:

```text
tile(product, {
  z, x, y,
  bbox3857,
  size,
  crs
}, time)
```

A WMS adapter uses `bbox3857`; a native tiled adapter uses `z/x/y`. A future Signal K specification should standardize the *rendered mosaic capability and temporal semantics*, not mandate the provider's upstream map protocol.

Products may also advertise provider-specific `minZoom` / `maxZoom`; chart advertisement and background prefetch must intersect these limits with local policy.

The three bundled adapters now exercise three upstream shapes:

- Radar-DPC: WMS rendering + REST discovery/native downloads + vector HRD hazards;
- DWD: WMS rendering + WMS time dimensions with observation/nowcast separation;
- RainViewer: REST frame discovery + hash-based native XYZ tiles.

This is strong evidence that provider discovery, temporal frames, map rendering, persistence, replay and hazards can remain transport-neutral in the candidate Signal K API.

## Multisensor observations (implementation finding, v1.0)

The implementation demonstrates that weather-radar **providers** and supporting **observation providers** should be separate capability families. Lightning must not be assumed to originate from the same organization or transport as the radar mosaic.

Candidate normalized observation namespace:

- `weatherRadar/observations/lightning`
- future: hail reports, surface stations, satellite convective detections, etc.

A lightning point minimally needs provider provenance, observation time, and WGS84 position. Polarity, amplitude/current, quality, location uncertainty, and strike type are optional capabilities.

Threat intelligence should preserve evidence provenance. Radar severity, tracked polygon/path intersection, lightning activity, and onboard environmental trends are separate inputs. Onboard sensors are vessel-local corroboration and MUST NOT, by themselves, assert the existence of a remote storm cell.

Candidate onboard evidence paths use existing Signal K vessel data rather than defining duplicate weather-radar paths: `environment.wind.speedTrue`, `environment.wind.directionTrue`, `environment.outside.temperature`, and `environment.outside.humidity`.


## Observation-provider split validated by v1.1

Lightning is not a radar-provider capability. Observation providers are independently discovered and may expose point-event and/or field capabilities. The minimal normalized point event is provider + id + time + position; polarity, amplitude and quality are optional. A density/frequency provider may expose a rendered temporal field without exposing individual strikes. Clients and fusion logic MUST NOT infer point strikes from a density image.

The implementation now validates this distinction with two point-source adapters (generic HTTP/JSON and Blitzortung.org) and one density-field adapter (Radar-DPC LTG). This supports future national, commercial, research and onboard lightning networks without modifying radar-mosaic providers.


## Composition with the existing Signal K Weather API

Weather-station observations are intentionally outside the proposed Weather Radar provider contract. A weather-radar consumer SHOULD compose with the existing Signal K Weather API (`weatherApi.getObservations`) when available. This pilot samples observations around the vessel, records query position, observation time/freshness and normalized WeatherData values, and uses them as corroborating evidence only.

Candidate normalized evidence fields: `sampledAt`, `queryPosition`, `time`, `ageSec`, `values.windSpeedTrue`, `values.windDirectionTrue`, `values.windGust`, `values.temperature`, `values.relativeHumidity`, `values.pressure`, `values.precipitationVolume`, plus provider/source metadata when supplied.

The Weather Radar proposal SHOULD NOT duplicate the Weather Provider registry. Threat objects MAY reference Weather API-derived evidence with method/provenance and confidence contribution. Stale observations MUST NOT contribute. Weather API evidence MUST NOT independently manufacture a radar storm cell.
