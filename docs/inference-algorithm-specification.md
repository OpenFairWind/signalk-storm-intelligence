# Inference Algorithm Specification

## Goal

Storm inference is pluggable. Multiple algorithms MAY run during the same inference cycle. Algorithms consume normalized evidence and produce normalized cells/threats; they MUST NOT depend on a specific radar or lightning provider.

## Discovery

Algorithm definitions live in `inference-algorithms/*.js`. A definition exports `id`, `name`, optional defaults/settings schema, and `create({settings, common})`.

The created algorithm MUST expose `id`, `name`, and `infer(context)`. It MAY expose version, description, weight, and capabilities.

## Context

`infer(context)` receives normalized inputs including `snapshot` (cell features/time), vessel state, lightning observations, onboard environmental context, Signal K Weather API context, configuration, current time, and `baseCells` produced by algorithms executed earlier in the cycle.

An algorithm SHOULD treat inputs as read-only. It MUST NOT mutate shared evidence objects or perform provider-specific network acquisition.

## Output

An algorithm returns an array of normalized cells or `{cells:[...]}`. Cell identity SHOULD use `trackId`/`id`. Threats SHOULD expose state, confidence in `[0,1]`, method/provenance, uncertainty, and relevant temporal/geometric metrics.

## Concurrent use / ensemble

“Same time” means all enabled algorithms participate in one inference cycle over the same evidence snapshot. The reference engine executes them sequentially for deterministic stateful behavior but ensembles all results before publication. Algorithms can therefore be independent estimators or evidence refiners.

Supported reference strategies are:

- `max-severity`: never lowers an existing threat state; confidence uses the strongest estimate.
- `weighted-confidence`: combines confidence using configured algorithm weights while preserving normalized threat semantics.

Every algorithm contribution is recorded under threat evidence/provenance. A failing algorithm is isolated; other algorithms continue and run status records the failure.

## Safety rules

Algorithms MUST declare uncertainty honestly. Corroborating environmental algorithms MUST NOT invent a storm cell without a primary hazard observation unless explicitly designed, documented, and separately enabled as a detector. Experimental/ML algorithms SHOULD be disabled by default until validated.

## Adding an algorithm

Add one file in `inference-algorithms/`, implement the contract, add deterministic tests, document scientific assumptions/validation domain, and enable it in configuration. No change to `index.js`, providers, storage, or Freeboard should be necessary.

## Pretrained machine-learning algorithms

A pretrained inference algorithm MUST expose model provenance in its result or algorithm description: model id/version, model format, immutable checksum, feature schema and validation scope. Missing modalities MUST be represented explicitly (for example by modality masks) rather than silently encoded as genuine zero observations.

A model intended only to refine existing storm candidates MUST declare `detector:false`/equivalent capability and MUST return no newly invented cells when primary candidates are absent. Operational enablement SHOULD require independent historical validation on frozen evidence bundles described in `reproducibility.md`.

## Remote LLM algorithms

An LLM algorithm SHOULD consume normalized/bounded evidence rather than sending entire provider payloads or vessel logs. It MUST validate structured output before merging it into threat state, MUST NOT expose credentials in result provenance, and SHOULD be disabled by default.

A candidate-refinement LLM MUST preserve the no-invention rule: it receives `baseCells` and may return only known candidate ids. Implementations SHOULD cap single-step threat escalation and SHOULD retain a deterministic algorithm in the ensemble so an API outage does not remove primary storm tracking.

Remote-model provenance SHOULD include API interface/protocol, model id, response/request id when available, request fingerprint, usage, latency and cache status. Endpoint aliases and hosted LLM outputs are not assumed to be bit-reproducible.
