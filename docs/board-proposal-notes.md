# Signal K board proposal notes

## 1. Purpose of this document

Storm Intelligence is a reference implementation used to discover which interoperability primitives are genuinely missing from Signal K. The application name should not automatically become the name of a monolithic Signal K standard.

The strongest proposal is likely a set of small reusable specifications which other weather, hazard and plotter applications can consume independently.

## 2. Existing Signal K capabilities to reuse

The implementation demonstrates that several domains already have suitable homes and should not be duplicated:

- vessel navigation and environmental measurements remain standard Signal K paths;
- nearby forecast/observation services remain under the Signal K Weather API;
- map layers can use chart resources;
- application extensions can use Plotter Extensions;
- alert state can use Signal K notifications.

Any board proposal should compose with these interfaces.

## 3. Missing primitives demonstrated by implementation

### Temporal geospatial weather products

Radar mosaics require a normalized way to advertise observation time, optional generation/valid time, product units, coverage, attribution and a time-selectable rendering source.

The current frame-slot chart workaround proves the use case but should not be standardized as the ideal solution.

### Radar/weather provider capabilities

Providers need machine-readable capability discovery distinguishing raster display, timeline, native archive, cells/hazards and nowcast/forecast semantics.

The contract must remain transport-neutral: DPC/DWD use WMS-like flows while RainViewer demonstrates native XYZ.

### Hazard geometry

Storm cells are useful beyond radar rendering. A normalized hazard representation should expose stable/local identity, geometry, time, severity, provenance, motion/prediction and uncertainty without prescribing one inference algorithm.

### Generic temporal/vector plotter overlays

Plotters would benefit from generic capabilities to update vector overlay data and select temporal frames without changing logical chart identity. These APIs should be useful for weather radar, currents, satellite imagery, search-and-rescue layers and other time-dependent geospatial data.

## 4. Concepts which should remain implementation-specific

The board proposal should not standardize the Storm Intelligence ensemble, operational risk-score heuristic, DNN architecture, LLM prompt, provider-specific HRD parsing or one storm-tracking algorithm.

Those components demonstrate use cases but belong to applications/research methods, not core interoperability.

## 5. Semantics which require careful review

Before proposing a standard, obtain community review on:

- observation versus analysis versus nowcast versus forecast terminology;
- `observedAt`, `generatedAt`, `validAt` and lead-time representation;
- provider identity and attribution;
- stale/degraded semantics;
- units and palette metadata;
- geometry CRS and coordinate order;
- quality/uncertainty representation;
- cache/archive/replay concepts;
- authentication expectations for provider-backed resources.

## 6. Evidence from the reference implementation

The implementation currently validates interoperability across:

- three materially different radar mosaic provider transports;
- point and density lightning observation forms;
- existing Signal K Weather API evidence;
- onboard Signal K environmental/navigation paths;
- multiple deterministic, DNN and LLM inference algorithms;
- Freeboard-SK layer/playback controls;
- offline prefetch/replay and persistent native products;
- read-only operational presentation.

This breadth is valuable because it reduces the risk of standardizing an abstraction that only matches one upstream service.

## 7. Proposed board process

A mature proposal should include:

1. the implementation-derived problem statement;
2. minimal normative schemas/capabilities;
3. examples from DPC, DWD and RainViewer showing transport neutrality;
4. interaction with existing Weather API and chart resources;
5. security/licensing considerations;
6. reference tests and example resources;
7. migration/compatibility strategy;
8. explicit non-goals separating inference from interoperability.

The reproducibility benchmark should accompany the technical proposal as evidence that temporal/hazard semantics support objective algorithm evaluation, but it should not be normative Signal K behavior.
