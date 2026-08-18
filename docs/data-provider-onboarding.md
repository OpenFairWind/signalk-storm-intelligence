# Data Provider Onboarding Guide

This document is for meteorological agencies, research infrastructures, commercial data services, community networks, and developers who want their data to work with Storm Intelligence.

## Choose the provider class

Use a **radar mosaic provider** for georeferenced reflectivity/rain-rate or comparable raster mosaics. Use an **observation provider** for discrete lightning/other observations or density fields. A service may implement more than one adapter when its products have different semantics.

## Required information

Before integration, document:

- stable service and product identifiers;
- geographic coverage and CRS;
- observation, generation, valid, and forecast/nowcast time semantics;
- nominal update interval and expected latency;
- units and physical meaning;
- missing/no-data encoding;
- quality flags and known limitations;
- authentication and rate limits;
- attribution, licence, redistribution, caching, and retention rules;
- availability/SLA if applicable.

## Radar acceptance checklist

A radar adapter is conformant when it can identify the latest **observation**, return a valid raster tile for a requested XYZ/BBOX, advertise truthful zoom/bounds/time capabilities, and preserve attribution. Historical/nowcast/raw/hazard features are optional and MUST be capability-advertised.

## Point-observation acceptance checklist

Point events MUST include a trustworthy UTC timestamp and coordinates. Polarity/amplitude/quality MUST only be supplied when defined by the source. Stable upstream IDs SHOULD be preserved to support de-duplication.

## Density acceptance checklist

The provider MUST state whether the field is qualitative visualization or quantitatively sampleable. Units, accumulation window, timestamp meaning, palette, and no-data behavior MUST be documented. A density image MUST never be presented as raw strike points.

## Operational consistency

Data providers SHOULD expose machine-readable metadata/capabilities. Changes to layer names, URL templates, authentication, palettes, or time encodings SHOULD be versioned or announced. Test fixtures representing a current product and edge cases are strongly recommended.

## Conformance test

An adapter contribution SHOULD include deterministic tests for metadata normalization, time handling, tile/event decoding, failure behavior, and capability reporting. A provider-specific test must not require changes to generic core tests.
