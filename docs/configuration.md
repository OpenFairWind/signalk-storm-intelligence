# Configuration

## 1. Configuration model

Configuration is capability-driven. Generic settings control runtime behavior, while provider/algorithm-specific settings remain namespaced.

```text
providerSettings.<radar-provider>
lightningProviderSettings.<observation-provider>
inferenceAlgorithmSettings.<algorithm>
```

Provider-qualified radar products use `provider:PRODUCT`, preventing collisions between national services which use similar product names.

## 2. Radar providers and layers

`enabledProviders` selects radar providers. `displayLayers` selects raster products to advertise as chart overlays. `acquisitionTargets` selects provider-native products for background acquisition when supported. `prefetchTargets` selects rendered products for operating-area storage.

Configuring a provider-qualified layer/target can implicitly require that provider to be instantiated; the runtime validates product existence against discovered adapter metadata.

## 3. Background acquisition

Important controls include acquisition enablement/poll interval and archive retention by maximum age/bytes. Raw acquisition is capability-dependent; WMS-only providers are not treated as raw-download providers.

## 4. Prefetch/offline

Prefetch configuration controls operating-area radius, zoom levels, maximum tiles per cycle, concurrency and independent storage retention. Large radii/high zooms can generate substantial bandwidth/storage use.

## 5. Temporal playback

Playback configuration controls enablement, number of advertised frame slots, timeline lookback and UI animation interval. Slots are a plotter compatibility mechanism rather than provider time semantics.

## 6. Storm tracking and alarms

Configuration includes warning/alarm distance thresholds, severity thresholds, prediction horizon, matching radius, track-history length, path-sampling interval and uncertainty bounds.

Threshold changes alter operational behavior and should be versioned/frozen in scientific experiments.

## 7. Lightning

Lightning configuration selects observation providers, query lookback/radius, map visibility and proximity alarm thresholds. Provider-specific credentials/endpoints live under the observation-provider settings namespace.

## 8. Onboard environmental evidence

Onboard environment controls include history length and maximum confidence/evidence contribution. Local environmental signals remain bounded corroboration in the default algorithms.

## 9. Signal K Weather API evidence

Weather API controls include sample radius, number of bearings/locations, maximum returned observations, maximum age and evidence weight.

A scientific replay should freeze the resulting normalized observations rather than querying live Weather Providers.

## 10. Inference algorithms

`inferenceAlgorithms` is an ordered list. Order matters because refiners receive `baseCells` produced by earlier algorithms.

Default operational inference is deterministic (`kinematic-polygon`, `multisensor-evidence`). Experimental DNN and LLM algorithms are disabled by default.

`inferenceStrategy` currently supports:

- `max-severity`;
- `weighted-confidence`.

Each algorithm has an independent object under `inferenceAlgorithmSettings`.

## 11. Multimodal DNN

The DNN settings can select a model path, confidence threshold, completeness penalty and algorithm weight. A replacement model must satisfy the exact feature schema expected by the runtime and should carry immutable provenance/checksum metadata.

See [`multimodal-dnn.md`](multimodal-dnn.md).

## 12. OpenAI-compatible LLM

Important settings include:

```text
baseUrl
protocol
model
apiKeyEnv
minimumConfidence
maxEscalationLevels
timeoutMs
maxRetries
maxCandidatesPerRequest
cacheTtlSec
disableStorage
```

The API secret itself belongs in the named process environment variable, never in JSON configuration. Remote inference may disclose normalized vessel/weather evidence to the configured endpoint.

See [`llm-openai-compatible.md`](llm-openai-compatible.md).

## 13. Secrets

Do not commit secrets or place them in exported benchmark configurations. Research manifests should record secret-variable **names** only when necessary to explain execution configuration.

## 14. Configuration reproducibility

Published/replayed experiments must archive the complete non-secret resolved configuration, not merely the differences from defaults. Defaults can change between releases.

Include plugin version/Git commit so a future researcher can reconstruct the same schema/default behavior.
