# Project identity and terminology

## Application

**Signal K Storm Intelligence** (`signalk-storm-intelligence`) is the reference implementation and operational plugin. It is a multisensor storm situational-awareness runtime, not a weather-radar-only application.

## Subsystems

- **Weather radar**: temporal georeferenced radar mosaic products and provider adapters.
- **Lightning observations**: point observations and density/frequency fields.
- **Weather observations**: existing Signal K Weather API data sampled around the vessel.
- **Onboard environment**: Signal K self-vessel environmental paths.
- **Inference algorithms**: independent algorithms consuming normalized evidence.
- **Inference ensemble**: concurrent algorithm execution and result combination.
- **Hazards/threats**: normalized storm objects, tracks, uncertainty and vessel-relative assessments.

## Specification boundary

The application name is not automatically the name of a future Signal K specification. The reference implementation should be used to identify reusable missing primitives. Existing Signal K Weather API and environmental paths remain authoritative for their domains. Radar mosaics, temporal geospatial products, hazard geometry and generic plotter overlay/time controls should be proposed independently where appropriate.

## Naming rules for contributors

Use `stormIntelligence` for the v2 application resource namespace. Use `radar`, `lightning`, `weatherObservations`, `onboardEnvironment`, `inference`, `hazards`, and `threats` for domain concepts. Do not rename provider-specific upstream terminology merely to match the application brand.
