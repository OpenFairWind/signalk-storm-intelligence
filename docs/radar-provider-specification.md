# Radar mosaic provider specification

Normative terms **MUST**, **SHOULD**, and **MAY** define the reference implementation contract. This is an implementation specification, not yet an adopted Signal K standard.

## 1. Purpose

A radar provider adapts an upstream meteorological radar service into normalized temporal raster products and optional provider-native capabilities. It must isolate upstream transport, projection, product naming, authentication and licensing details from the generic runtime.

## 2. Stable identity

A provider definition MUST expose a stable machine `id` and human-readable `name`. IDs are used in configuration, persistent storage and chart metadata and therefore MUST NOT change casually.

The runtime instance returned by the adapter MUST expose the same ID as the definition.

## 3. Minimum runtime contract

A raster-capable provider MUST expose:

```text
id
name
products()
latest(product)
tile(product, tileRequest, time)
```

`latest(product)` identifies the most recent **observation/analysis** frame suitable for current display. It MUST NOT return a future nowcast valid time merely because that timestamp is chronologically greater.

`tile()` returns PNG bytes for the requested product/frame under the current chart interface.

## 4. Neutral tile request

The core passes a transport-neutral object containing values such as:

```text
z, x, y
bbox3857
size
crs
```

A WMS provider MAY use `bbox3857`; a native tile provider MAY use XYZ. The generic runtime MUST NOT assume either transport.

## 5. Product metadata

Every product MUST declare `kind`. Raster products SHOULD document:

- stable product ID;
- title and description;
- physical quantity and units;
- observation versus forecast/nowcast semantics;
- nominal period/cadence;
- geographic bounds;
- minimum/maximum useful zoom;
- attribution;
- palette/rendering semantics if relevant;
- no-data behavior;
- optional capabilities.

Physical units must refer to the source quantity, not merely a rendered palette label.

## 6. Time semantics

Providers MUST normalize time unambiguously. Internally epoch milliseconds are acceptable; public metadata should prefer UTC ISO-8601.

Where the source exposes them, adapters SHOULD preserve:

```text
observedAt
generatedAt
validAt
period/lead time
```

A timeline containing observations and future nowcasts MUST allow the runtime to distinguish them.

## 7. Optional capabilities

A provider MAY implement:

- `timeline(product, ...)`;
- `downloadRaw(product, time)`;
- `rawExtension(product)`;
- `cellsFromRaw(product, buffer, time)`;
- provider-specific capability metadata.

Absence of a capability is normal. The adapter MUST NOT fabricate raw acquisition by saving rendered PNGs and calling them native data, and MUST NOT fabricate storm cells from an upstream product whose semantics do not define them.

## 8. Historical requests

If the provider advertises historical time support, an explicit request for time `T` MUST return `T` (within documented provider time-normalization rules) or fail. It MUST NOT silently substitute the newest frame.

Live mode may use a separately labelled stale local fallback at the generic storage layer; this is not provider historical behavior.

## 9. Spatial semantics

Provider coverage/bounds and projection must be documented. Tile output consumed by the chart interface is expected in the web-map tiling context used by the runtime.

Adapters performing reprojection or upstream BBOX conversion must have deterministic tests for representative coordinates and boundary cases.

## 10. Quality and missing data

Providers SHOULD preserve upstream quality or availability metadata when available. Missing coverage is not equivalent to zero reflectivity/rain rate.

An adapter must distinguish provider error, no-data, and valid empty/transparent imagery where the source allows that distinction.

## 11. Network behavior

Requests MUST use finite timeouts. Retries must be bounded and should be reserved for transient errors. Content type and HTTP status MUST be checked before interpreting bytes.

Rate limits and provider terms should influence polling/prefetch defaults.

## 12. Authentication and secrets

Credentials, tokens and secret-bearing request parameters MUST NOT appear in chart URLs, public metadata or logs. Provider settings should reference secure configuration mechanisms appropriate to the upstream service.

## 13. Licensing and attribution

The adapter MUST document attribution and any known restrictions on caching, archival storage, redistribution and commercial use. The runtime's ability to save bytes does not grant legal rights to do so.

## 14. Provider isolation

Provider endpoints, product names, palettes, origin headers, CRS quirks and upstream response parsing belong in adapter/provider code. Generic core, Freeboard UI and inference code MUST NOT branch on the provider ID.

## 15. Deterministic test requirements

A provider contribution SHOULD include tests for:

- adapter discovery and unique ID;
- metadata normalization;
- latest observation semantics;
- future-nowcast exclusion when applicable;
- tile request construction/decoding;
- zoom/bounds constraints;
- historical time preservation;
- malformed/non-PNG responses;
- optional capability advertisement;
- provider failure isolation.

Live endpoint checks are encouraged but must remain separate from deterministic tests.

## 16. Reproducibility

A provider intended for historical scientific evaluation SHOULD expose or document a stable history/archive acquisition route. When provider-native raw data cannot be redistributed, the benchmark should retain request metadata and checksums according to [`reproducibility.md`](reproducibility.md).
