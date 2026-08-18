# OpenAI-compatible LLM inference algorithm

## Purpose

`llm-openai-compatible` is an experimental Storm Intelligence inference algorithm which refines **existing** storm candidates using a remote or local LLM exposed through an OpenAI-compatible HTTP API.

It is intentionally not a detector. Radar/hazard evidence must already have produced a candidate through an earlier algorithm such as `kinematic-polygon`. The LLM may refine confidence and, subject to configured limits, escalate the candidate threat state. It never creates a new cell id.

The algorithm is disabled by default.

## Supported API interfaces

Two transports are supported:

- `responses` — `POST /v1/responses`; this is the default and follows the current OpenAI Responses API shape.
- `chat-completions` — `POST /v1/chat/completions` for compatible services which expose Structured Outputs through Chat Completions.

Both modes request JSON-schema-constrained structured output. An endpoint described as “OpenAI compatible” is usable only if it implements the selected protocol and the corresponding structured-output fields.

No OpenAI SDK dependency is required; Storm Intelligence uses Node.js `fetch` directly.

## What is sent to the model

The algorithm does **not** upload raw radar files, whole weather-station archives, vessel logs, credentials, or provider payloads. It derives the same fixed provider-independent multimodal feature vector used by the pretrained DNN and sends, for each existing candidate:

- stable candidate/track id;
- baseline threat state and confidence;
- 32 normalized numerical storm features;
- modality-presence mask;
- modality completeness;
- inference time and configured threat horizon.

The feature domains are radar/hazard geometry, lightning, onboard environment, Signal K Weather API evidence, and vessel-relative threat geometry. See `multimodal-dnn.md` and `lib/multimodal-features.js`.

Although this greatly reduces data disclosure compared with sending raw observations, the request can still reveal operational information about a vessel and nearby weather. Enabling a remote endpoint is a deliberate data-processing decision.

## Structured output

The model must return one assessment per supplied candidate:

```json
{
  "assessments": [
    {
      "id": "cell-17",
      "state": "warn",
      "confidence": 0.78,
      "uncertainty": "medium",
      "summary": "Approach geometry and convective evidence support warning.",
      "factors": ["path interception", "lightning increase"]
    }
  ]
}
```

Unknown ids, duplicate ids, invalid states and malformed results are ignored or rejected. Confidence is clamped to `[0,1]`.

The prompt explicitly instructs the model to treat supplied evidence as untrusted data rather than instructions. This reduces prompt-injection risk from provider metadata, but structured numeric evidence and strict output validation remain the stronger controls.

## Threat escalation guard

`maxEscalationLevels` defaults to `1`.

Therefore an LLM cannot move a baseline `normal` candidate directly to `alarm` in one inference step. It may propose `alarm`, but the applied state is capped at `warn`. A baseline `warn` candidate may be escalated to `alarm` if the output passes the configured confidence threshold.

With the default `max-severity` ensemble, the LLM cannot lower a stronger result produced by another algorithm.

## Credentials

API keys are never stored in the Signal K plugin configuration.

The configuration stores only the **name** of the environment variable containing the key:

```text
OPENAI_API_KEY
```

The default HTTP authentication is:

```text
Authorization: Bearer <value of OPENAI_API_KEY>
```

`apiKeyHeader` and `apiKeyPrefix` can adapt this to other compatible services while keeping the secret in the environment.

Do not place an API key in `baseUrl`, model id, custom provider metadata, exported Signal K settings, bug reports, or reproducibility manifests.

## Configuration

Example using OpenAI:

```json
{
  "inferenceAlgorithms": [
    "kinematic-polygon",
    "multisensor-evidence",
    "multimodal-dnn",
    "llm-openai-compatible"
  ],
  "inferenceStrategy": "max-severity",
  "inferenceAlgorithmSettings": {
    "llm-openai-compatible": {
      "baseUrl": "https://api.openai.com/v1",
      "protocol": "responses",
      "model": "gpt-5.6-luna",
      "apiKeyEnv": "OPENAI_API_KEY",
      "weight": 0.5,
      "minimumConfidence": 0.55,
      "maxEscalationLevels": 1,
      "timeoutMs": 15000,
      "maxRetries": 1,
      "maxCandidatesPerRequest": 8,
      "cacheTtlSec": 60,
      "disableStorage": true
    }
  }
}
```

The model id is configurable because available models and aliases change over time. For scientific evaluation, prefer a provider/model version that is as immutable as the service allows, and record the exact model actually returned in API provenance.

## OpenAI-compatible local or third-party service

```json
{
  "baseUrl": "http://llm-host:8000/v1",
  "protocol": "chat-completions",
  "model": "local-model-id",
  "apiKeyEnv": "LOCAL_LLM_API_KEY",
  "requireApiKey": false
}
```

Disabling API-key requirements is appropriate only for a deliberately unauthenticated trusted local service.

## Cost and rate control

The algorithm batches multiple candidates into one request up to `maxCandidatesPerRequest`. Identical evidence requests are cached for `cacheTtlSec`. Transient 408/409/429/5xx and network failures are retried using bounded backoff.

Keep the LLM disabled unless its additional inference value justifies network latency and cost. Deterministic algorithms continue operating if the LLM request fails.

## Failure behavior

The inference engine isolates algorithm failures. Examples include:

- missing API-key environment variable;
- timeout;
- HTTP failure/rate limit;
- model refusal;
- invalid JSON;
- schema-invalid assessment;
- compatible endpoint not implementing Structured Outputs.

A failed LLM run does not stop `kinematic-polygon`, `multisensor-evidence`, `multimodal-dnn`, map overlays, acquisition, or alarms generated by other algorithms.

## Provenance

Accepted LLM evidence records:

- API protocol;
- configured API base URL;
- model id actually returned by the endpoint when available;
- response id;
- request id when exposed by HTTP headers;
- token/usage object when supplied;
- request latency;
- SHA-256 request fingerprint;
- whether the assessment came from the short-lived local cache;
- uncertainty, summary and short evidence factors.

The API key is never included.

## Reproducibility

LLM-backed inference is not assumed to be bit-reproducible. Hosted models can be nondeterministic or can change behind an alias.

A reproducible experiment must therefore save the original frozen meteorological evidence **and** the exact structured LLM response/provenance used by the run. There are two valid evaluation modes:

1. **Recorded-response replay** — reuse previously captured structured LLM assessments. This gives deterministic comparison of downstream ensemble behavior.
2. **Fresh-model evaluation** — call the endpoint again and treat the new response as a new experiment run. Record model, response id, request fingerprint, retrieval time and usage.

Never mix fresh LLM results into an old benchmark and call it the same reproducibility run.

## Operational status

This algorithm is experimental. A general-purpose LLM has not been established as an authoritative severe-weather classifier. It should be evaluated against frozen historical cases and compared with deterministic and pretrained numerical algorithms before operational enablement.
