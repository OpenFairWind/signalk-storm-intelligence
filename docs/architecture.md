# Architecture

## 1. Purpose and design philosophy

Signal K Storm Intelligence is a **multisensor inference runtime** rather than a weather-radar viewer. Radar mosaics are one evidence family among several. The architecture therefore separates acquisition, normalization, persistence, inference, publication, and presentation so that each layer can evolve independently and be tested in isolation.

The reference implementation is designed for two environments which impose different constraints: an operational Signal K server aboard a vessel, where connectivity and compute resources may be limited, and a research/replay environment, where the same algorithms must be evaluated deterministically against frozen evidence. The architecture avoids hidden coupling between those modes.

The core design principles are:

1. **provider isolation** — upstream protocols and quirks remain behind adapters;
2. **normalized evidence** — inference consumes stable provider-independent semantics;
3. **algorithm plurality** — multiple inference methods may run on the same snapshot;
4. **provenance preservation** — observation and inference origin remain inspectable;
5. **degraded-mode transparency** — stale/offline data are never represented as current;
6. **bounded operation** — caches, retries, storage, concurrency and remote calls are finite;
7. **safety separation** — decision-support outputs do not directly command navigation systems.

Global storm geometry unwraps longitudes into a local continuous domain before centroid, containment, distance, motion and translation calculations. Published coordinates are normalized back to the conventional longitude range, preserving correct behavior for cells and predictions crossing the antimeridian.

## 2. Logical components

```text
upstream meteorological services
        │
        ├── radar mosaic providers
        └── observation providers
                 │
                 ▼
        provider normalization layer
                 │
       ┌─────────┴──────────┐
       │                    │
 native archive       rendered prefetch
       │                    │
       └─────────┬──────────┘
                 │
        normalized evidence snapshot
                 │
     ┌───────────┼─────────────┐
     │           │             │
Signal K     onboard       vessel
Weather API  environment   navigation
     │           │             │
     └───────────┴──────┬──────┘
                        │
               inference registry
                        │
               inference algorithms
                        │
                 ensemble merge
                        │
              normalized hazards/threats
                        │
       ┌────────────────┼────────────────┐
       │                │                │
 notifications      plotter layers   operational WebApp
```

## 3. Radar provider layer

Radar provider definitions live in `providers/`; protocol-specific implementation helpers may live under `lib/`. A provider exposes product metadata and the minimum operations required to identify a current observation and render a tile. Optional capabilities include timeline discovery, provider-native download, and extraction of normalized hazard cells.

The generic core supplies both XYZ coordinates and a Web-Mercator bounding box in a neutral tile request. WMS providers may use the bounding box while native tile providers may use XYZ. This was intentionally generalized after implementing DPC/DWD WMS and RainViewer XYZ transports.

Provider IDs and product IDs are namespace identifiers, not display labels. They must remain stable across minor releases because persisted storage and configuration refer to them.

## 4. Observation provider layer

Observation providers are independent of radar providers. The principal current use case is lightning, but the abstraction allows future point or field observations when their scientific semantics are well defined.

A provider may expose discrete observations, density/frequency tiles, or both. The core does not fabricate one representation from another: a raster lightning-density map is not interpreted as raw strike events unless the source defines a quantitative transform and the adapter explicitly implements it.

## 5. Existing Signal K evidence

Storm Intelligence composes with, rather than replaces, existing Signal K facilities.

The server-side Signal K Weather API supplies normalized nearby weather observations. The self-vessel model supplies onboard environmental measurements and navigation. These sources are treated as independent evidence domains with their own freshness and provenance.

This composition is important for future standardization: a Storm Intelligence proposal should not duplicate APIs which Signal K already defines successfully.

## 6. Evidence snapshot

An inference cycle operates on a logically consistent evidence snapshot. The snapshot can include current provider cells, vessel state, recent lightning observations, onboard environmental context, Weather API context, runtime configuration and an explicit inference timestamp.

Algorithms should treat the snapshot as immutable. Acquisition should not occur inside a normal inference algorithm because doing so would introduce provider coupling, inconsistent temporal views, and irreproducible replay behavior.

## 7. Inference registry and ensemble

Inference algorithms are dynamically discovered from `inference-algorithms/`. Definitions have stable IDs and instantiate runtime objects satisfying the common contract.

The engine executes enabled algorithms in deterministic configured order. Sequential execution is deliberate: some algorithms are primary detectors while others are refiners that consume `baseCells` produced earlier in the cycle. This is still an ensemble because all contributions are retained and merged before publication.

A failing algorithm is isolated. Its failure is recorded in runtime status, but unrelated algorithms continue. Remote LLM outages therefore cannot remove deterministic tracking.

## 8. Threat model

Meteorological phenomenon severity and vessel-relative threat are separate concepts. Threat estimation can use polygon distance, motion history, uncertainty, vessel path, CPA/TCPA, lightning, local environmental changes and external weather observations.

Area-hazard interception is preferred over centroid-only CPA because a vessel can intersect a large or elongated storm polygon while remaining far from its centroid.

## 9. Persistence model

Four persistence concepts are intentionally distinct:

- **cache** — transient in-memory acceleration;
- **archive** — provider-native source files;
- **prefetch** — rendered map tiles retained for an operating area;
- **replay** — historical frames discoverable from local persistence.

Native archives support scientific reprocessing. Prefetched tiles support operational continuity. Neither should be confused with the other.

## 10. Presentation adapters

Freeboard-SK consumes standard Signal K chart resources and Plotter Extension capabilities. Storm polygons and lightning points are normalized data first; rasterized transparent PNG layers are a compatibility presentation technique.

The companion WebApp is deliberately read-only. It summarizes runtime health and ranks approaching threats without changing configuration, acknowledging alarms or controlling providers.

## 11. Public and authenticated surfaces

Public browser asset routes are narrowly scoped to map/extension bytes required by the plotter. Dynamic operational state and administrative actions remain on Signal K resource/plugin APIs with the appropriate access mode.

Read-only does not mean non-sensitive: vessel location and weather context can still be operationally sensitive. Access control remains a deployment responsibility.

## 12. Extension invariants

A conforming contribution should preserve these invariants:

- a new radar provider does not require inference/UI special cases;
- a new observation provider does not require radar changes;
- a new inference algorithm does not require provider/storage changes;
- provider failure does not invalidate unrelated providers;
- algorithm failure does not terminate the ensemble;
- historical replay does not contact live providers unless the experiment explicitly permits it;
- stale data remain labelled stale;
- credentials never enter normalized evidence or public status.

Violations should be treated as architectural issues and documented explicitly before merge.
