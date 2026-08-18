# Storm Intelligence documentation

The documentation is organized as a technical and scientific reference for operators, developers, data providers, algorithm researchers, and future Signal K specification work. The project treats documentation as part of the interface: time semantics, units, provenance, uncertainty and safety boundaries should be explicit enough that an independent researcher or implementer can reproduce the intended behavior.

## Start here

1. [`architecture.md`](architecture.md) — system decomposition, evidence flow, trust boundaries and extension invariants.
2. [`storm-intelligence-model.md`](storm-intelligence-model.md) — normalized evidence, geometry, time, confidence, uncertainty and vessel-relative threat semantics.
3. [`configuration.md`](configuration.md) — runtime/provider/inference configuration and reproducible configuration capture.
4. [`testing-and-validation.md`](testing-and-validation.md) — release testing versus historical scientific/operational validation.
5. [`security-privacy-licensing.md`](security-privacy-licensing.md) — credentials, vessel privacy, provider terms, retention and remote inference.

## Provider integration

- [`data-provider-onboarding.md`](data-provider-onboarding.md) — onboarding checklist for agencies, research infrastructures, commercial services and community networks.
- [`radar-provider-specification.md`](radar-provider-specification.md) — normative reference implementation contract for temporal radar mosaics.
- [`observation-provider-specification.md`](observation-provider-specification.md) — normative point/density observation-provider contract.

## Inference and scientific model

- [`inference-algorithm-specification.md`](inference-algorithm-specification.md) — pluggable algorithm discovery, context, output and ensemble semantics.
- [`multimodal-dnn.md`](multimodal-dnn.md) — multimodal DNN feature/inference integration.
- [`model-card-stormfusion-reference-v1.md`](model-card-stormfusion-reference-v1.md) — bundled reference model provenance and limitations.
- [`llm-openai-compatible.md`](llm-openai-compatible.md) — OpenAI-compatible structured LLM refinement, security and provenance.

## Reproducibility

- [`reproducibility.md`](reproducibility.md) — academic-grade historical acquisition and frozen-evidence replay protocol, using the 17–18 August 2026 western Italy convective event as the worked case.
- [`reproducibility-manifest.schema.json`](reproducibility-manifest.schema.json) — machine-readable core manifest schema for versioned benchmark bundles.

## Signal K and presentation

- [`signal-k-integration.md`](signal-k-integration.md) — existing Signal K Weather API, vessel paths, resources and notifications.
- [`freeboard-sk.md`](freeboard-sk.md) — chart layers, playback, hazards, lightning and Plotter Extensions.
- [`operational-webapp.md`](operational-webapp.md) — read-only runtime/component health and approaching-cell dashboard.
- [`storage-and-offline.md`](storage-and-offline.md) — archive, prefetch, replay, recycling and temporal integrity.

## Project evolution and standardization

- [`project-identity.md`](project-identity.md) — application/subsystem terminology.
- [`migration-v1-to-v2.md`](migration-v1-to-v2.md) — package/resource migration notes.
- [`board-proposal-notes.md`](board-proposal-notes.md) — implementation-derived candidates and non-goals for future Signal K standardization.
- [`weather-radar-api-draft.md`](weather-radar-api-draft.md) — historical working draft retained for traceability; later documents supersede parts of its terminology.

## Repository engineering

Repository-wide engineering, safety, testing, reproducibility and contribution rules are in [`../AGENTS.md`](../AGENTS.md). The normal deterministic release gate is:

```bash
npm run quality
npm pack --dry-run
```
