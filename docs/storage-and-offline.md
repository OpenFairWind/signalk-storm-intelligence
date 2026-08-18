# Storage, offline operation, and temporal integrity

## 1. Motivation

A vessel cannot assume continuous terrestrial connectivity. Storm Intelligence therefore preserves selected provider-native and rendered data locally, but it separates operational continuity from scientific truth. A locally available image is not automatically a current observation.

## 2. Four storage concepts

- **cache** — transient memory used to reduce repeated work/network calls;
- **archive** — persistent provider-native products retained for processing or research;
- **prefetch** — persistent rendered tiles acquired for a geographic operating area;
- **replay** — a temporal view over historical frames available from local persistence.

These concepts have different scientific and legal implications and must not be collapsed into one generic “cache”.

## 3. Native archive

Archive storage retains upstream bytes as received when the provider permits raw acquisition. Files are provider/product qualified and timestamped. Native products are preferable for later scientific reprocessing because they preserve information lost in rendered map tiles.

The archive has independent maximum-age and maximum-byte budgets. Recycling removes expired/oldest content according to the configured policy.

## 4. Rendered prefetch

Prefetch stores rendered PNG tiles around the vessel operating area at configured zoom levels. It is primarily an operational continuity mechanism.

The prefetch signature includes geographic tile coverage as well as frame identity. If the vessel moves while the radar frame timestamp is unchanged, newly relevant tiles can still be acquired.

Tile enumeration is bounded by configured radius, zooms, concurrency and per-cycle tile limits.

## 5. Local-first serving

For a known frame, the tile server checks persistent local storage before contacting the provider. This reduces network demand and makes an acquired operating area usable through intermittent connectivity.

If the upstream service is unavailable in **live mode**, the server may return the newest suitable stored tile as a stale fallback. The UI/status must identify degraded/stale operation.

## 6. Historical integrity

An explicit historical request is different from live continuity. If the caller asks for frame `T`, the server must not silently return `T+5min` or the newest cached frame.

If the exact historical tile is unavailable and cannot be retrieved, the correct result is unavailable/error. This invariant is required for scientific replay and user trust.

## 7. Replay

Replay enumerates available local frame timestamps and/or provider timelines. Replay metadata should preserve whether a frame comes from the provider timeline or local prefetch reconstruction and whether upstream verification is currently possible.

The current Freeboard compatibility implementation exposes bounded frame-slot chart resources; this is a presentation workaround rather than a storage semantic.

## 8. Staleness

Staleness should be computed from observation time and current/replay clock, not from local file modification time alone. A freshly copied old frame remains old meteorological information.

Inference should not gain confidence merely because stale evidence is locally available.

## 9. Retention and licensing

Retention settings must respect upstream licences and operational privacy. Some providers permit viewing but restrict archival redistribution. The runtime must not imply that storage capability grants data rights.

## 10. Research reproducibility

A research benchmark should preserve immutable raw data when legal, plus checksums. Runtime recycling must not be used as the only archive for a scientific experiment. Before evaluation, copy/freeze the benchmark according to [`reproducibility.md`](reproducibility.md).

## 11. Failure cases to test

Storage tests should cover disk/permission errors, partial files, age/byte recycling, missing exact historical tiles, provider outages, antimeridian operating areas, movement during an unchanged radar frame and process restart with existing persisted data.
