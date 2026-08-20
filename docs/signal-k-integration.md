# Signal K integration

## 1. Composition with the Signal K ecosystem

Storm Intelligence is intentionally additive. It consumes existing Signal K vessel/environment/weather semantics and contributes normalized storm resources, chart overlays, notifications and user interfaces.

The project should not redefine an existing Signal K API merely to make the plugin self-contained.

## 2. Self-vessel navigation

Vessel-relative inference uses standard self data when available, notably:

```text
navigation.position
navigation.speedOverGround
navigation.courseOverGroundTrue
```

Angles/speeds follow Signal K unit conventions. Missing navigation reduces the available threat calculations; the runtime should expose that degraded state rather than inventing vessel motion.

## 3. Onboard environmental paths

Current fusion reads standard environmental paths including:

```text
environment.wind.speedTrue
environment.wind.directionTrue
environment.outside.temperature
environment.outside.humidity
```

These values provide local trend evidence. Sensor source, calibration and vessel-flow effects remain outside the plugin and should be considered in operational interpretation.

## 4. Signal K Weather API

Nearby weather observations are obtained through the existing server-side Weather API. Storm Intelligence samples configured positions around the vessel and normalizes freshness and available weather fields.

Weather Provider identity remains owned by the Signal K Weather API. A Weather Provider is not required to implement a Storm Intelligence provider adapter.

This boundary allows existing and future Signal K Weather Providers to contribute without coupling them to this project.

## 5. Resource APIs

The primary dynamic resource namespace is:

```text
stormIntelligence
```

It contains normalized status/provider/hazard/observation/inference resources for consumers such as plotter extensions.

The legacy read-only `weatherRadar` resource namespace remains a deprecated v1 compatibility alias during the v2 series. New code must target `stormIntelligence`.

## 6. Chart resources

Radar mosaics, lightning rendering and hazard overlays are published through Signal K chart resources so plotters can manage them with standard chart-layer mechanisms.

Chart metadata carries Storm Intelligence extension metadata while retaining provider/product provenance.

## 7. Plotter Extensions

The plugin registers a `plotterExtensions` resource describing the Storm Intelligence Freeboard-SK extension. The extension uses host capabilities rather than private application internals.

## 8. Notifications

Storm and lightning conditions are published to configurable Signal K notification paths. State returns to `normal` when the condition clears.

Notification payloads include method/message and bounded supporting details. They should not contain credentials or huge provider payloads.

Default algorithms preserve the safety rule that environmental corroboration alone does not create a remote storm cell.

## 9. Operational WebApp

The companion WebApp is classified as `signalk-webapp` and reads a consolidated `/operational` plugin endpoint. The route is registered with readonly access.

Signal K has two icon consumers with different bases: the server Webapps list resolves `signalk.appIcon` relative to `public`, while the App Store resolves it relative to the package root. The package therefore publishes the same canonical square PNG at both `assets/storm-intelligence-icon.png` and `public/assets/storm-intelligence-icon.png`, with metadata set to `./assets/storm-intelligence-icon.png`.

The WebApp must remain non-mutating unless a future security/UX redesign explicitly introduces controlled actions.

## 10. Units and timestamps

Normalized vessel/weather values use Signal K SI conventions. Provider-specific conversions happen at normalization boundaries. Time values exposed to clients should be unambiguous UTC ISO-8601 where possible.

## 11. Future standardization

The reference implementation suggests that future Signal K standardization should focus on missing reusable primitives—temporal geospatial weather layers, hazard geometry, provider capabilities and generic plotter temporal/vector controls—while continuing to reuse the existing Weather API and vessel environmental data model.
