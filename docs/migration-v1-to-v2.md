# Migration from signalk-weather-radar v1.x to signalk-storm-intelligence v2

## Identity changes

| v1.x | v2.x |
|---|---|
| npm package `signalk-storm-intelligence` | `signalk-storm-intelligence` |
| plugin id `signalk-storm-intelligence` | `signalk-storm-intelligence` |
| display name `Weather Radar` | `Storm Intelligence` |
| Resource API `weatherRadar` | `stormIntelligence` |
| public tile root `/weatherradar/...` | `/stormintelligence/...` |

Weather radar remains a first-class subsystem. Provider ids, radar product ids, observation-provider ids, inference-algorithm ids, storage semantics, notification paths and normalized hazard concepts are not renamed merely for branding.

## Configuration migration

The v2 schema intentionally preserves the v1.x configuration property names for radar, lightning, Weather API, onboard environment and inference settings. Copy the prior plugin configuration into the v2 plugin configuration when the Signal K installation does not automatically carry settings across a package-id change. Provider-qualified targets such as `radar-dpc:VMI` remain unchanged.

## Resource API compatibility

New clients MUST request `stormIntelligence`. During v2.x the plugin also registers the legacy read-only `weatherRadar` resource type. Legacy resources carry `deprecated: true` and `replacement: stormIntelligence`. The alias is planned for removal in v3.

## Freeboard-SK

The Plotter Extension id changes with the plugin id. Remove/disable an installed v1 package before enabling v2 to avoid duplicate extensions. Existing radar layer semantics remain provider/product based.

## Data directories

New default installations use `storm-intelligence-data`. If historical v1 archive/prefetch data are required, migrate the old `weather-radar-data` directory deliberately; do not merge stores while either plugin version is running.
