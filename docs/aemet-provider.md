# AEMET regional radar provider

Adapter for the Spanish State Meteorological Agency (AEMET) single-site
regional weather radar, via the public **OpenData** REST API. It fills the
western-Mediterranean / Iberian gap left by the other bundled providers
(Radar-DPC is Italy, DWD is Germany, and the EUMETNET OPERA open composite has
no Spanish contribution). The first shipped site is **Palma de Mallorca
(`pm`)**, covering the Balearic Islands within a ~240 km range.

## Status: display tier only

This adapter implements the mandatory raster contract — `products`, `latest`,
`tile` — and **deliberately does not** advertise `downloadRaw` or
`cellsFromRaw`. The AEMET regional product is a *rendered palette image*, not a
gridded native raster, so treating it as raw acquisition or deriving storm
cells from it would conflict with radar-provider-specification.md §7. It is
suitable as a display layer and as coarse observational evidence, not as an
inference raw source. See issue discussion for the cell-detection question.

## Data source and access

Two-step OpenData handshake:

1. `GET {apiBase}/red/radar/regional/{code}?api_key=…` → JSON
   `{ estado, datos, metadatos }`. The `datos` field is a **short-lived,
   keyless** URL. The API key travels only in this metadata request — never in
   the `datos` URL, and therefore never in a tile/chart URL or log (spec §12).
2. `GET {datos}` → the product, `image/gif` (480×530, palette).

The API exposes only the most recent frame — there is **no time parameter and
no archive** — so the adapter is **live-only**: it advertises no `timeline`
and rejects historical `tile(time)` requests rather than silently substituting
the newest frame (spec §8). Product cadence is ~10 minutes.

AEMET does not expose a per-frame valid time in the API (the observation time is
burned into the image pixels). `latest()` therefore reports the fetch time
floored to the 10-minute cadence as a best-effort observation time.

Get a free API key at <https://opendata.aemet.es>.

## Reflectivity reconstruction

The product is a PPI reflectivity image with a dBZ legend. Two deterministic
steps recover the source quantity and geolocate it (all in `lib/aemet-raster.js`,
unit-tested against a fixture):

1. **Palette → dBZ.** Each legend colour maps to its reflectivity value,
   quantised to the published legend steps (12…72 dBZ in 6 dBZ increments).
   Values are the source physical quantity, not a rendered label.
2. **Georeference.** The image carries no georeference. A linear EPSG:4326 fit
   was derived once by matching the static yellow coastline overlay against
   known Balearic geography (island capes with published WGS84 coordinates):

   ```
   lon = 0.011553 · x + 0.03934
   lat = -0.008921 · y + 41.52681      (x,y = pixel, origin top-left)
   ```

   The fit is isotropic at ~0.99 km/px (480 px ≈ 2 × 240 km range), with a
   maximum control-point residual of ~5 km and independent-check residuals
   (e.g. Cabrera island, not used in the fit) of ~3 km. It is most accurate over
   the populated central arc and degrades toward the far disk edge; the true
   projection is azimuthal-equidistant about the radar, for which the linear map
   is a deterministic local approximation. Adequate for a display overlay.

`tile()` warps the reconstructed grid into the requested EPSG:3857 tile
(nearest-neighbour) and renders a semi-transparent blue→red ramp over the
12…72 dBZ range. No-echo, out-of-range, and map furniture render transparent.

### Static overlay mask

The coastline overlay is drawn in the same pure yellow (`255,255,0`) as the
48 dBZ level, so the two cannot be separated by colour. Because the overlay is
identical in every frame, its fixed pixel positions are shipped as a static
packed 1-bit mask (`assets/aemet-{code}-mask.bin`, row-major) and removed at
decode time. The banner (top rows) and legend (bottom rows) are excluded by
row range. The mask is built by intersecting several frames (weather moves;
furniture is invariant) — see `scripts/aemet-build-mask.js`.

## Configuration

Provider settings (`providers.aemet`):

| setting | default | notes |
|---|---|---|
| `apiKey` | `""` | AEMET OpenData key; required. Sent only to AEMET. |
| `frameCacheSeconds` | `120` | Shared cache for the metadata + decoded frame. |

The provider is **opt-in** (`recommended.enabled = false`) because it needs a
key. Enable it and add `aemet:PM` to the display layers.

## Licensing and attribution

© AEMET. Reuse and reproduction are authorised citing AEMET as the author
(<https://www.aemet.es/es/nota_legal>). Attribution (`© AEMET`) is surfaced in
product metadata; downstream caching/redistribution must honour AEMET's terms.

## Adding another regional radar

Each AEMET site is a mechanical addition: derive its coastline-matched georef
and static overlay mask (the scripts under `scripts/` are parameterised by
radar code), drop the mask asset under `assets/`, and add the product entry —
no engine or UI changes. Only sites with a shipped georef + mask are exposed.
