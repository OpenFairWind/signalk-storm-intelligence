# Model card: stormfusion-reference-synthetic-v1

## Summary

`stormfusion-reference-synthetic-v1` is the bundled pretrained model used by the experimental `multimodal-dnn` inference algorithm. Its purpose is to provide a deterministic, end-to-end reference implementation for model loading, multimodal feature extraction, inference, provenance and ensemble behavior.

It is **not an operationally validated meteorological model**.

## Architecture

- input: 32 normalized features including five modality masks;
- hidden layer 1: 20 ReLU units;
- hidden layer 2: 10 ReLU units;
- output: 3 softmax classes (`normal`, `warn`, `alarm`);
- runtime format: `storm-intelligence-dnn/1` JSON;
- runtime dependency: none beyond Node.js.

## Modalities

- radar/hazard geometry and severity;
- lightning activity;
- onboard environmental trends;
- Signal K Weather API spatial evidence;
- vessel-relative approach/interception geometry.

The model scores existing storm candidates only.

## Training

The deterministic training program is `scripts/train-reference-dnn.js`.

- generator: physically informed synthetic examples;
- seed: `0x51a7c0de`;
- training samples: 12,000;
- held-out synthetic samples: 3,000;
- epochs: 22;
- batch size: 64;
- learning rate: 0.035.

The synthetic labels deliberately make radar/geometry primary evidence while lightning and environmental inputs act mainly as corroboration.

## Synthetic validation

At the current source revision the deterministic held-out synthetic evaluation reports approximately 0.904 classification accuracy. The exact confusion matrix is embedded in the model JSON.

This metric validates the software/training path only. It does not measure performance on observed thunderstorms.

## Provenance

The model file is `models/stormfusion-reference-v1.json`. The runtime calculates and publishes its SHA-256. With the current deterministic training script the expected checksum is:

```text
2552c5ba62f5808acd2e51485123992ca834293f9714804b381e4db4829e0d6f
```

Re-running `npm run train:reference-dnn` should recreate the same model bytes for the same source revision and Node.js-compatible numeric behavior.

## Intended use

- verify the pretrained-model plugin path;
- compare deterministic and ML ensemble behavior;
- provide a template for externally trained DNN models;
- exercise missing-modality handling and provenance.

## Not intended for

- sole-source navigation safety decisions;
- claims of severe-weather detection skill;
- operational activation without historical/event-level validation and calibration.

## Required next validation

Use the frozen historical workflow in `reproducibility.md`. Split by entire meteorological event rather than by individual frames. The 17–18 August 2026 western Italy event should be declared as training, validation or untouched test data before model development begins.
