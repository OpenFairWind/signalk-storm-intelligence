# Observation provider specification

Observation providers are independent from radar providers. The current principal domain is lightning, but the contract is intentionally evidence-oriented rather than tied to one national radar service.

## 1. Provider identity

A provider MUST expose stable `id` and `name` values. Runtime identity MUST match the adapter definition.

## 2. Supported forms

A provider MUST implement at least one of:

```text
observations(query)     discrete observations/events
densityTile(request)    temporal density/frequency field
```

A provider MAY implement both if the upstream service genuinely exposes both representations.

## 3. Point observations

A normalized lightning strike SHOULD contain:

- provider/source provenance;
- UTC observation time;
- latitude and longitude;
- stable upstream ID when available;
- optional polarity;
- optional amplitude/energy only when scientifically defined by the source;
- optional quality/location-accuracy metadata.

Missing optional fields MUST remain absent/null rather than inferred from unrelated fields.

## 4. Density/frequency fields

A density field MUST document what a pixel/value represents: frequency, count, rate, probability-like index, qualitative intensity, or another quantity. It SHOULD document accumulation window, valid time, units, no-data values and palette when relevant.

A rendered density image MUST NOT be reverse-engineered into synthetic strike points by the generic runtime.

Quantitative sampling is allowed only when the provider documents numerical semantics and the adapter advertises the capability.

## 5. Query semantics

Point providers should support a bounded spatiotemporal query appropriate to the upstream service. Query bounds/time windows must be explicit, and pagination/maximum-record behavior should be documented.

The adapter should preserve original observation time and avoid assigning request time to events which lack a trustworthy timestamp.

## 6. De-duplication

When the source provides stable event IDs, preserve them. Otherwise a provider-specific deterministic de-duplication strategy may be needed, but it must be documented. Cross-provider lightning events must not be assumed identical merely because they are close in space/time.

## 7. Freshness and quality

Consumers must be able to reject stale observations. Provider latency and quality fields should be retained when available.

Lightning detection efficiency and location accuracy vary by network; absolute count/rate comparisons across providers require caution and, for scientific claims, calibration/validation.

## 8. Failure isolation

One observation provider failing MUST NOT invalidate observations from another. Provider errors should be visible in status while previously valid observations age naturally according to their timestamps.

## 9. Credentials and privacy

Credentials must not be logged or exposed in normalized objects. Vessel-centered lightning queries reveal an operating region to the provider and should be documented as a privacy consideration.

## 10. Licensing

Observation services may impose restrictions on raw-data access, caching, redistribution or commercial use. Those restrictions remain binding even when the adapter technically supports persistent acquisition.

Protected Blitzortung data, for example, should not be redistributed publicly without permission.

## 11. Deterministic testing

A provider contribution should test:

- discovery and unique ID;
- point/density capability reporting;
- time/coordinate normalization;
- optional field preservation;
- malformed records;
- geographic/time filtering;
- density tile semantics/transport;
- authentication failure;
- stale-data behavior.

Tests must not require live internet access.

## 12. Reproducibility

Historical scientific use requires an acquisition record containing provider documentation/version, query bounds, query window, retrieval time, licence/redistribution status and checksums. See [`reproducibility.md`](reproducibility.md).
