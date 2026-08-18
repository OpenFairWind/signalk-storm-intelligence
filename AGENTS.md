# AGENTS.md — Signal K Storm Intelligence engineering rules

This file is the working agreement for human contributors and coding agents modifying `signalk-storm-intelligence`. It applies to the whole repository unless a deeper directory contains a more specific `AGENTS.md`.

## 1. Project mission

Storm Intelligence is a Signal K multisensor severe-weather decision-support and research runtime. It acquires and normalizes meteorological evidence, runs independent inference algorithms, combines their outputs, and presents vessel-relative hazards through Signal K, Freeboard-SK and a read-only operational WebApp.

Changes must preserve both missions:

- **operational robustness** aboard a vessel under intermittent connectivity; and
- **scientific reproducibility** for retrospective algorithm evaluation.

Never optimize one mission by silently invalidating the other.

## 2. Safety boundary

This software is not an official warning service, certified collision-avoidance device, marine-radar replacement, or autonomous navigation controller.

Required invariants:

- Do not describe heuristic risk values as probabilities unless they are produced by a validated probabilistic model and explicitly labelled/calibrated as such.
- Do not suppress provider timestamps, staleness, quality or provenance.
- Do not silently replace an explicitly selected historical frame with another timestamp.
- Do not allow corroborating environmental evidence alone to create a remote storm cell.
- Machine-learning and LLM algorithms must fail closed and must not bypass deterministic/runtime safety guards.
- Remote LLM output is untrusted model output and must be schema-validated before use.
- Do not automatically steer the vessel, change autopilot state, or acknowledge external safety alarms.

## 3. Architecture invariants

Provider-specific behavior belongs behind adapters.

- Radar mosaic adapters live in `providers` and provider-specific helpers in `lib` only when necessary.
- Lightning/observation adapters live in `observation-providers`.
- Inference implementations live in `inference-algorithms`.
- Generic orchestration must not branch on bundled provider names such as DPC, DWD or RainViewer.
- Generic inference orchestration must not branch on bundled algorithm IDs.
- User interfaces must consume normalized resources rather than upstream provider payloads.
- Storage paths must be provider/product qualified and collision-safe.

A new provider or inference algorithm should normally require **no modification** to unrelated provider registries, storage semantics, Freeboard internals or the operational WebApp.

## 4. Data and time semantics

All internal scientific timestamps are UTC and timezone-aware at interfaces.

Distinguish at least:

- `observedAt` — observation/acquisition valid time;
- `generatedAt` — product/model generation time when applicable;
- `validAt` — forecast/nowcast valid time;
- `receivedAt` — time received locally when operational latency matters.

Never treat future nowcast frames as “latest observation”. Do not infer timestamps from filenames unless the provider contract explicitly defines that convention.

Provider-native data should be preserved unchanged when archival acquisition is enabled. Derived products must be traceable to immutable inputs.

## 5. Units

Normalized Signal K values use Signal K/SI conventions. Conversions belong at acquisition/normalization boundaries and must be documented.

Examples:

- speed: m/s;
- angle: radians unless a normalized schema explicitly documents degrees;
- distance: metres;
- temperature: kelvin in Signal K normalized values;
- relative humidity: unitless ratio in Signal K normalized values;
- pressure: pascals;
- timestamps: ISO-8601 UTC or documented epoch milliseconds at provider boundaries.

Never guess units from field names when the upstream provider is ambiguous.

## 6. Provider development

Before adding a provider, read:

- `docs/data-provider-onboarding.md`;
- `docs/radar-provider-specification.md` or `docs/observation-provider-specification.md`;
- `docs/security-privacy-licensing.md`.

Every provider must document:

- stable provider ID and human name;
- products/capabilities;
- spatial coverage;
- time semantics/cadence;
- units and quality fields;
- authentication/credential handling;
- attribution/licence/redistribution constraints;
- failure and stale-data behavior;
- reproducibility/history availability.

Do not invent capabilities that an upstream service does not expose. In particular, do not turn rendered lightning density imagery into fake point strikes.

## 7. Inference algorithm development

Read `docs/inference-algorithm-specification.md` and `docs/storm-intelligence-model.md` first.

Every algorithm must:

- have a globally unique stable `id`;
- expose a clear version and description;
- declare capabilities and model provenance when applicable;
- consume normalized evidence, not provider-private payloads;
- tolerate missing modalities explicitly;
- return attributable confidence/uncertainty semantics;
- avoid network access during reproducibility replay unless the experiment explicitly defines and freezes the external response;
- fail without terminating other algorithms in the ensemble.

Detector/refiner semantics matter. Algorithms such as the current DNN/LLM refiners must not invent candidates when configured as non-detectors.

## 8. Machine learning

A model file is a scientific artifact.

Required metadata for bundled/recommended models:

- model ID and version;
- architecture;
- exact ordered feature schema;
- preprocessing/normalization;
- training-data provenance;
- train/validation/test split policy;
- random seeds where applicable;
- software/runtime versions;
- model checksum;
- calibration/validation metrics;
- known limitations and intended-use boundary.

Do not report synthetic-validation accuracy as real-world meteorological skill. Event-level splits are required for correlated storm sequences; adjacent frames from one event must not leak across train/test partitions.

## 9. LLM inference

LLM credentials must come from environment variables or an equivalent secret manager. Never persist API keys in plugin settings, source, logs, fixtures or generated artifacts.

The OpenAI-compatible algorithm must use structured outputs with strict validation. Prompt text must treat provider/user-derived content as untrusted data, not instructions.

For research replay, prefer stored validated structured responses. If a hosted LLM is called again, record it as a new experiment because model/service behavior may have changed.

## 10. Reproducibility

`docs/reproducibility.md` is normative for historical benchmarking.

A reproducible run must freeze:

- acquisition window and geographic domain;
- source requests and retrieval timestamps;
- immutable raw inputs or checksums when redistribution is prohibited;
- normalization code revision;
- normalized evidence bundle;
- vessel scenario/log;
- algorithm IDs, versions and settings;
- model files/checksums;
- random seeds;
- runtime versions;
- LLM structured responses or complete non-secret request/response provenance.

Inference algorithms must not improve their historical inputs by contacting a live provider during replay.

## 11. Privacy and security

Treat vessel position, route/history and onboard telemetry as potentially sensitive operational data.

- The operational WebApp is read-only.
- Do not add mutating requests to the WebApp without an explicit architecture/security review.
- Respect Signal K access modes.
- Do not expose credentials in API descriptions, resource status, errors or logs.
- Bound network timeouts, retries, response sizes and caches.
- Validate provider content types and schemas before processing.
- Avoid path traversal: never use untrusted provider/product IDs directly as arbitrary filesystem paths without sanitization/validation.

## 12. Coding standards

Runtime target: Node.js >= 20, CommonJS unless the project deliberately migrates as a whole.

Prefer:

- `const` by default, `let` only for reassignment;
- small named functions over repeated inline expressions;
- explicit validation at module boundaries;
- deterministic ordering for discovered adapters/algorithms;
- bounded loops, caches, retries and concurrency;
- `Error` messages that identify the failed subsystem without exposing secrets;
- pure functions for geometry, scoring, normalization and merging where practical;
- one source of truth for thresholds/semantics.

Avoid:

- provider or algorithm special cases in generic code;
- silent catch blocks for scientifically meaningful failures;
- duplicated expensive calculations;
- enormous new one-line functions;
- hidden unit conversion;
- implicit fallback from historical to live data;
- network calls in unit tests.

## 13. Testing requirements

All behavior changes require deterministic tests.

Minimum expectations:

- provider contract/normalization tests;
- negative tests for malformed upstream data;
- temporal tests distinguishing observation and forecast/nowcast;
- stale-data tests;
- false-positive tests for threat logic;
- geometry tests for polygon boundary/interception behavior;
- storage/recycling/offline fallback tests;
- inference isolation and provenance tests;
- credential non-disclosure tests for remote algorithms;
- read-only tests for the operational WebApp.

Network-dependent checks belong in explicit `live-check` scripts and must not be required for `npm test`.

Before release run:

```bash
npm run quality
npm pack --dry-run
```

## 14. Documentation standards

Documentation is part of the scientific interface.

- Use precise terminology and define ambiguous concepts.
- Separate observed, derived, inferred and forecast quantities.
- State units, time bases, assumptions, limitations and provenance.
- Distinguish operational heuristics from statistically calibrated probabilities.
- Mark provider/service behavior as time-sensitive when it can change.
- Include reproducible commands where practical.
- Keep the main README aligned with the current release identity and routes.
- Update `docs/README.md` when adding a major document.
- Update `CHANGELOG.md` for externally visible changes.

Provider/API claims should be checked against authoritative upstream documentation before release when network access is available.

## 15. Release/version discipline

Use semantic versioning pragmatically:

- patch: corrections, documentation, non-breaking quality fixes;
- minor: backward-compatible features, new providers/algorithms/UI capabilities;
- major: package identity, primary API namespace or incompatible contract changes.

The version in `package.json`, plugin runtime metadata, OpenAPI info and documentation must agree.

## 16. Dependency discipline

Keep runtime dependencies small and justified, especially for Raspberry Pi and vessel installations.

Before adding a dependency, consider:

- native build requirements;
- arm64 support;
- security/maintenance status;
- package size;
- whether a small deterministic implementation already exists locally.

Do not add a large ML runtime solely for a feature that can remain optional or adapter-based.

## 17. Scope of final review

A change is ready only when:

- architecture invariants still hold;
- scientific semantics are documented;
- safety and privacy boundaries remain explicit;
- deterministic tests pass;
- repository quality checks pass;
- package contents are reviewed;
- no secret material is included;
- reproducibility documentation remains sufficient to recreate benchmark inputs and algorithm runs.
