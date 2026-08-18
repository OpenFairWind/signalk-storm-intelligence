# Storm Intelligence normalized model

## 1. Scope

The normalized model is the scientific boundary between heterogeneous evidence acquisition and inference. It defines what an algorithm is allowed to assume without knowing whether evidence came from Radar-DPC, DWD, RainViewer, Blitzortung, another lightning service, a Signal K Weather Provider, or an onboard instrument.

Normalization does not make all data scientifically equivalent. It preserves the distinctions needed to reason about provenance, timing, quality and uncertainty.

## 2. Evidence classes

Current evidence domains are:

- radar/area-hazard observations;
- lightning point observations and optional density fields;
- Signal K Weather API observations around the vessel;
- onboard environmental observations;
- vessel navigation state.

A future domain may be added when it has a documented normalization contract. It should not be forced into an existing domain merely because the data are meteorological.

## 3. Time semantics

Every scientific observation should preserve a meaningful observation/valid time. Where applicable, also preserve generation and reception time.

```text
observedAt   physical observation/acquisition time
validAt      forecast/nowcast valid time
generatedAt  production/model generation time
receivedAt   local receipt time
```

These values serve different purposes. `latest observation` must never mean the greatest future `validAt` value. Replay at time `T` must not reveal information generated after `T` unless the experiment explicitly models retrospective perfect-information analysis.

## 4. Provenance

A normalized object should identify its provider/source and product/type. Derived objects should additionally identify the method which produced them and retain traceability to the source frame or observation set.

Provenance is not optional decoration. It is required to explain conflicting evidence, provider outages, algorithm disagreement and scientific reproducibility.

## 5. Storm-cell identity

`trackId` is a local persistent identity created by the tracking process. It is distinct from an upstream provider feature ID, which may be unstable or absent.

A track should preserve observation history sufficient to estimate motion and uncertainty. Split/merge events are difficult scientific cases and must not be hidden behind arbitrary continuity rules in evaluation.

## 6. Geometry

Storm hazards are represented by normalized geographic geometry, typically GeoJSON-like polygons in WGS84 longitude/latitude. The geometry is the primary representation for area interaction.

A centroid is useful for association and motion estimation but is not equivalent to the hazardous area. Current distance and projected interception should therefore use polygon geometry where possible.

## 7. Motion

Motion may include east/north components, speed, course, sample count, residual error, confidence and method/provenance. The reference kinematic tracker estimates motion from multiple historical observations to reduce sensitivity to a single noisy displacement.

Motion is an estimate, not an assertion of constant storm evolution. Convective systems grow, decay, split, merge and accelerate. Prediction uncertainty should therefore increase with horizon and poor track quality.

## 8. Meteorological severity versus vessel-relative threat

These concepts MUST remain separate.

**Severity** describes the meteorological phenomenon according to an upstream product or derived algorithm. **Threat** describes the operational interaction between the phenomenon and the vessel trajectory/context.

A high-severity cell moving away at large distance should not produce an alarm merely because its severity is high. Conversely, a moderate but fast-developing nearby cell intersecting the vessel path may merit a warning.

## 9. Threat fields

Threat objects may contain:

```text
state                 normal | warn | alarm
confidence            [0,1] support under the active method
method                inference provenance
intersects             projected vessel-path/polygon interaction
interceptSec           estimated time to interaction
minDistanceMeters      closest predicted separation
minDistanceSec         time of closest predicted separation
uncertaintyMeters      spatial uncertainty estimate
cpa                    optional centroid/relative-motion diagnostic
evidence               per-domain/per-algorithm contributions
```

Not every algorithm is required to populate every field. Missing fields should remain absent rather than be fabricated.

## 10. Confidence

`confidence` is **not a probability of harm**. It summarizes support or quality under a particular inference method. Algorithms must document how their confidence is constructed.

Evidence boosts are bounded. Stale observations must not increase confidence. Confidence values from different algorithms are not automatically statistically commensurate; ensemble strategies should therefore be described as operational combination rules unless separately calibrated.

## 11. Uncertainty

Uncertainty is first-class. A point estimate without uncertainty can create false precision, particularly for projected impact time.

The reference geometry model carries an uncertainty distance which can grow with lead time and poor motion consistency. Other models may provide probabilistic regions or calibrated uncertainty intervals, but their semantics must be explicit.

## 12. Lightning evidence

Point lightning observations can support strike counts over windows, flash-rate trends, nearest-strike distance and cell association. Provider detection efficiency and quality vary, so counts should retain provider provenance and must not be interpreted as provider-independent absolute flash climatology without calibration.

Density/frequency fields remain a distinct representation. They are not converted to point strikes by default.

## 13. Environmental evidence

Onboard and nearby weather observations are primarily corroborative in the default algorithms. Relevant patterns include wind strengthening, direction shifts, temperature falls, humidity rises, pressure changes, gusts and precipitation.

A local environmental change is not sufficient to assert a remote storm cell. This guard is both a scientific and safety design choice.

## 14. Operational risk score

The companion WebApp exposes a 0–100 operational ranking to prioritize cells. That score combines threat state, confidence, severity, interception and selected evidence. It is **not a calibrated probability** and must not be described as one.

If a future calibrated probabilistic model is introduced, its probability should be exposed under a distinct, explicitly defined field rather than silently replacing the heuristic score.

## 15. Degraded operation

When a primary feed disappears, an existing track may continue temporarily using retained state, local replay and other evidence, but it must be marked degraded/stale and uncertainty must not improve without new primary evidence.

Offline tiles are presentation continuity, not new observations.

## 16. Scientific comparability

Algorithms are comparable only when they consume the same evidence snapshot and temporal information set. Historical experiments therefore freeze normalized evidence and replay it incrementally. Any algorithm which retrieves additional live information during replay is running a different experiment.

See [`reproducibility.md`](reproducibility.md) for the benchmark protocol.
