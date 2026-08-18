# Multimodal pretrained DNN inference algorithm

## Purpose

`multimodal-dnn` is an experimental Storm Intelligence inference algorithm which classifies the vessel-relative threat of an **existing storm candidate** using a pretrained deep neural network. It runs through the same inference-algorithm registry as deterministic algorithms and can run in the same inference cycle.

It is intentionally a **candidate refiner, not a storm detector**. With the default setting it will not create a storm cell when no radar/hazard candidate exists.

## Modalities

The current feature schema contains normalized features from five groups:

1. radar/hazard geometry and severity;
2. lightning activity associated with the cell;
3. onboard Signal K environmental trends;
4. Signal K Weather API spatial evidence;
5. vessel-relative approach/interception geometry.

The feature vector also includes modality-presence masks so a model can distinguish zero values from unavailable evidence.

## Bundled pretrained reference model

The repository includes `models/stormfusion-reference-v1.json`. It is a small feed-forward DNN with two ReLU hidden layers and a three-class softmax output (`normal`, `warn`, `alarm`). It is loaded and executed with the dependency-free runtime in `lib/pretrained-dnn.js`.

The reference model is genuinely pretrained: `scripts/train-reference-dnn.js` deterministically recreates its weights from a physically informed synthetic generator. The bundled model records the random seed, training size, hyperparameters and held-out synthetic confusion matrix.

**Important:** synthetic held-out accuracy is software/integration validation only. It is not evidence of operational meteorological skill. The reference model is disabled by default.

## Enabling

Add the algorithm after a candidate-producing algorithm:

```json
{
  "inferenceAlgorithms": [
    "kinematic-polygon",
    "multisensor-evidence",
    "multimodal-dnn"
  ],
  "inferenceAlgorithmSettings": {
    "multimodal-dnn": {
      "weight": 0.65,
      "minimumConfidence": 0.5,
      "completenessPenalty": 0.25
    }
  }
}
```

With the default `max-severity` ensemble, the DNN can raise a threat assessment but cannot lower a more severe assessment produced by another algorithm.

## Replacing the model

Set `modelPath` to another JSON model using format `storm-intelligence-dnn/1`. The model MUST use the exact ordered feature schema published by `lib/multimodal-features.js`. A schema mismatch fails closed during plugin startup.

A replacement model should include:

- immutable model id/version;
- training dataset identity and licence;
- training code revision;
- feature schema revision;
- calibration/validation metrics;
- geographic and seasonal validation domain;
- known failure modes;
- checksum.

Model files must never embed provider credentials or private vessel data.

## Historical training and validation

Use `docs/reproducibility.md` to freeze radar, lightning, weather observations and vessel scenarios. Training, calibration and evaluation splits must be separated by storm event/time period to reduce temporal leakage. Do not randomly split frames from the same storm across training and test sets.

For the 17–18 August 2026 western Italy case, use the event first as a reproducible evaluation case unless it is explicitly assigned to training. Once an event has influenced model design or hyperparameter tuning, it is no longer an untouched final test event.

## Safety and ensemble behavior

The DNN output includes class probabilities, adjusted confidence, modality completeness, modality masks, model id/version and SHA-256 provenance. Missing modalities reduce confidence according to `completenessPenalty`.

The algorithm does not perform provider network access and does not mutate shared evidence. If the model cannot load or its feature schema is incompatible, algorithm instantiation fails and other configured inference algorithms remain independently available.
