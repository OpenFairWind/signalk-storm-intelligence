# Storm Intelligence operational WebApp

`signalk-storm-intelligence` includes a companion standalone Signal K WebApp in `public/`. Signal K automatically mounts the package WebApp, so after installation and server restart it is available at:

```text
/signalk-storm-intelligence/
```

The package carries both `signalk-node-server-plugin` and `signalk-webapp` keywords so the same installed package supplies the runtime and its operational monitor.

The Webapps dashboard icon is served from `public/assets/storm-intelligence-icon.png`. An identical package-root copy is retained for App Store metadata because the two Signal K consumers resolve `signalk.appIcon` from different base directories.

## Purpose

The WebApp is an operations/status display. It is intentionally distinct from the Freeboard-SK extension. Freeboard is the geospatial operational map; the companion WebApp answers:

- Is Storm Intelligence running?
- Which data providers and acquisition paths are healthy, stale, waiting or disabled?
- Are background acquisition, archive storage and offline prefetch operating?
- Are lightning, onboard environmental sensors and Signal K Weather API observations available?
- Which inference algorithms are enabled and did their last run succeed?
- Which storm cells are approaching the vessel?
- Is a projected vessel-path impact predicted, and when?
- If no intersection is predicted, when and how close is closest approach?
- What is the current operational risk ranking and confidence?

## Read-only boundary

The WebApp performs only HTTP `GET` requests. It contains no configuration forms, alarm acknowledgement, acquisition trigger, provider control or Signal K write operations. Its primary data source is:

```text
GET /plugins/signalk-storm-intelligence/operational
```

The route is registered through the plugin's read-only router access. Normal Signal K authentication/readonly-access policy therefore applies.

## Approaching-cell semantics

An entry is considered approaching when at least one of the normalized threat indicators says the cell is relevant within the configured inference horizon: projected polygon/path intersection, closing CPA, or a finite projected minimum-separation time within the horizon.

### ETA

`impact` ETA is emitted only when the inference result predicts the moving storm polygon will intersect the projected vessel path. Otherwise, when available, the WebApp shows `closest-approach` ETA. The UI never labels closest approach as impact.

### Operational risk score

The dashboard uses a 0-100 **operational ranking score**, not a probability. It is intentionally transparent and currently combines:

- ensemble threat state (`normal`, `warn`, `alarm`);
- ensemble confidence;
- normalized provider severity;
- projected polygon/path intersection;
- lightning jump and strong recent lightning evidence.

Labels are `low`, `moderate`, `high`, and `critical`. The score is intended to rank concurrent cells for operator attention; it is not an official meteorological warning probability and must not be calibrated/interpreted as one.

## Component states

The WebApp displays `healthy`, `warning`, `error`, `waiting`, `disabled`, or `stopped` states. Radar freshness is evaluated against the provider frame cadence when available. Inference algorithms report the duration/count/error from their most recent cycle.

## Refresh behavior

The browser polls the read-only operational endpoint every 10 seconds and refreshes immediately when a hidden tab becomes visible again. The dashboard does not initiate background acquisition; acquisition remains owned by the server plugin.

## Security

The operational view includes vessel-relative ranges and may expose vessel position. Enabling unauthenticated Signal K readonly access can therefore expose operational information to anyone who can reach the server. Follow the server security policy for the vessel/network environment.
