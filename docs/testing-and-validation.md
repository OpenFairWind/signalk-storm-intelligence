# Testing and validation methodology

## 1. Validation layers

Storm Intelligence uses several validation layers because unit-test correctness and meteorological skill are different claims.

1. **static/repository quality** — syntax, metadata consistency, documentation links and packaging;
2. **deterministic unit tests** — pure algorithms, geometry, normalization, storage and merging;
3. **component integration tests** — registries, Signal K resources, plotter/WebApp contracts and mocked upstream protocols;
4. **live provider checks** — opt-in verification against current external services;
5. **historical scientific evaluation** — frozen event bundles and independent annotations;
6. **operational validation** — real deployment behavior under connectivity loss, stale data, sensor disagreement and provider outages.

Passing an earlier layer does not establish claims belonging to a later layer.

## 2. Deterministic release gate

Run:

```bash
npm run quality
```

The command performs repository consistency checks, JavaScript syntax validation and the complete deterministic test suite. It must not require internet connectivity or secret credentials.

`npm pack --dry-run` should additionally be reviewed before release to verify the intended package contents.

## 3. Provider validation

Every provider adapter should be tested against representative fixtures covering:

- metadata and capability normalization;
- successful current observation discovery;
- observation versus nowcast/forecast time semantics;
- tile or event decoding;
- no-data and malformed data;
- authentication failure where applicable;
- timeout/non-2xx response behavior;
- content-type validation;
- historical timestamp behavior;
- provider-specific zoom/bounds constraints.

A provider live check is valuable but remains opt-in because upstream availability is not a deterministic property of the source tree.

## 4. Temporal validation

Temporal errors are particularly dangerous in weather replay. Tests should prove that:

- future nowcast frames are not called the latest observation;
- an explicit historical frame is not replaced by another time;
- stale fallback is restricted to live/degraded operation;
- UTC conversion is stable across midnight and daylight-saving boundaries;
- replay at time `T` cannot see observations generated/received after the permitted replay clock.

## 5. Geometry and tracking validation

Tests should exercise polygon-boundary distance, antimeridian tile behavior, point-in-polygon cases, path intersection, CPA/TCPA and uncertainty propagation.

Tracking tests should include noisy displacements and, in historical evaluation, split/merge/loss/reacquisition cases. Synthetic geometric tests validate mathematics; real sequences validate meteorological robustness.

## 6. Inference validation

Every algorithm must document:

- scientific assumptions;
- required and optional evidence;
- detector versus refiner role;
- confidence and uncertainty meaning;
- behavior under missing modalities;
- failure modes;
- validation domain;
- model provenance where applicable.

An algorithm contribution must prove independent discovery and coexistence with another algorithm without core special cases.

The ensemble must isolate a failed algorithm and preserve the status/error for inspection.

## 7. Machine-learning validation

Machine-learning models require event-level train/validation/test separation. Adjacent frames from the same convective episode are correlated and must not be randomly split across partitions when claiming generalization.

Report per-event performance and calibration, not only aggregate accuracy. Appropriate metrics can include confusion matrices, precision/recall, Brier score, reliability diagrams, ETA error and missed/false-interception rates depending on model outputs.

The bundled synthetic reference DNN validates the software integration path; it does not establish meteorological skill.

## 8. LLM validation

LLM inference must be tested with deterministic mocked API responses for schema, candidate-ID validation, credential handling, escalation bounds and failure isolation.

Live endpoint checks are separate and require explicit credentials. Hosted LLM outputs are not assumed bit-reproducible. Scientific comparison should replay recorded structured outputs or treat each fresh call as a new run.

## 9. Operational WebApp validation

The companion WebApp is intentionally read-only. Tests must fail if it introduces mutation forms or POST/PUT/PATCH/DELETE operations to plugin APIs without an explicit security redesign.

Risk and ETA labels must preserve their semantics: impact ETA only for projected polygon/path interception; otherwise display closest-approach time/distance. The operational risk score must continue to state that it is not a probability.

## 10. Storage and degraded-mode validation

Test independent archive and prefetch recycling, byte/age budgets, local-first reads and provider outage behavior.

A live request may fall back to an explicitly stale cached frame; an explicit historical request may not silently change timestamp.

## 11. Historical benchmark validation

Scientific claims should use the protocol in [`reproducibility.md`](reproducibility.md). At minimum record:

- dataset version and checksums;
- missing products/frames;
- annotation procedure;
- vessel scenario;
- algorithm/model versions;
- inference configuration;
- event-level metrics;
- ablation experiments by evidence domain.

The 17–18 August 2026 western Italy case is the current reference acquisition example, not the only event on which operational skill should be judged.

## 12. Operational validation before safety-relevant use

Test real sequences with:

- stale radar feeds;
- missing lightning;
- weather-station delays;
- onboard sensor faults;
- cell split/merge;
- intermittent connectivity;
- vessel course/speed changes;
- rapid convective growth/decay;
- false-positive severe cells moving away;
- conflicting algorithms.

Operational validation should include human-factors review: warning lead time and nuisance alarms matter as much as aggregate classification scores.

Storm Intelligence remains decision-support software even after successful validation.
