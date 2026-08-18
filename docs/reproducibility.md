# Reproducibility and historical test datasets

This guide defines a reproducible workflow for assembling historical evidence bundles for **Signal K Storm Intelligence**. The same bundle can be replayed against the current algorithms or retained as a fixed benchmark for future inference algorithms.

The worked use case is the convective episode affecting the **western coasts and western seas of Italy during the night of 17–18 August 2026**. Treat the event description as the experiment label: the scientific record is the downloaded data plus its checksums, timestamps and provenance. Do not infer event truth from the label itself.


## Scientific protocol and scope

This document is a **data-acquisition and replay protocol**, not a post-hoc narrative of the event. Its purpose is to make algorithm comparisons falsifiable and auditable. Before downloading data or running inference, a study should state its research question, evaluation endpoint, inclusion/exclusion rules, and whether the 17–18 August 2026 event is used for development, validation, or untouched testing.

A recommended preregistration record contains:

```text
research question
primary metric(s)
secondary metric(s)
evidence domains included
algorithm ids and versions
ensemble strategy
threat thresholds
vessel scenario(s)
event split policy
missing-data policy
statistical comparison method
```

Do not tune thresholds, select vessel tracks, remove difficult time periods, or redefine impact windows after inspecting the final algorithm outputs without reporting the change as exploratory analysis. Separate **confirmatory** and **exploratory** results.

The benchmark should preserve four conceptually different layers:

1. **raw observations/products** exactly as retrieved;
2. **normalized evidence** produced by versioned deterministic transformation;
3. **reference annotations/ground truth** created independently of the tested algorithm;
4. **algorithm outputs** which are disposable and reproducible from the first three layers.

This separation is essential for future ML/LLM work: labels and reference annotations must never be derived from the same algorithm being evaluated.

## 1. Reproducibility rules

A benchmark is reproducible only when it freezes the inputs before algorithm execution.

1. Work in **UTC** internally. Italy is on CEST (UTC+02) on 17–18 August 2026, so the local night spans two UTC dates.
2. Download **provider-native data** whenever the provider permits it. Rendered PNG tiles are useful for visual QA but are weaker scientific inputs than native raster/vector/point products.
3. Never overwrite downloaded source files. Derived/normalized files go in a different directory.
4. Record the exact request, HTTP status, retrieval time, content type, byte count, checksum, provider licence/terms and any authentication requirement.
5. Record missing frames as missing. Do not silently interpolate them in the acquisition stage.
6. Keep observations separate from reanalysis/model substitutes. A reanalysis is useful as an auxiliary control, but is not equivalent to a weather-station observation.
7. Run inference only from a frozen `manifest.json`; algorithms must not contact live providers during a reproducibility run.

## 2. Reference experiment

Use a deliberately wider interval than the colloquial phrase “the night of 17–18 August” so storm initiation and decay are visible.

```text
experiment id: italy-west-coast-2026-08-17-18
analysis window: 2026-08-17T16:00:00Z .. 2026-08-18T08:00:00Z
core night:      2026-08-17T20:00:00Z .. 2026-08-18T04:00:00Z
```

A useful first domain is:

```text
west = 7.0 E
east = 16.5 E
south = 36.0 N
north = 45.0 N
```

It includes Sardinia/Corsica and the Ligurian, Tyrrhenian and western Italian coastal sectors. Tighten the domain for individual experiments, but keep the original acquisition bundle unchanged.

Suggested vessel test points include the Ligurian Sea, northern Tyrrhenian, central Tyrrhenian, Gulf of Naples and north/east Sardinian waters. A vessel trajectory may be synthetic, but it must be stored as a separate input and clearly marked synthetic.

### Source verification date

The external acquisition examples in this guide were rechecked against authoritative provider documentation on **18 August 2026**. External services remain time-sensitive: endpoint paths, authentication policies, product catalogues, archive availability and licensing terms may change. A reproducible study therefore records the documentation/access date and saves service metadata (for example product catalogues or capability documents) alongside the data.

The currently verified reference documentation includes:

- Radar-DPC REST API: `https://dpc-radar.readthedocs.io/it/master/api.html`;
- Meteostat hourly annual dumps: `https://dev.meteostat.net/data/timeseries/hourly`;
- Open-Meteo Historical Weather API: `https://open-meteo.com/en/docs/historical-weather-api`;
- Blitzortung archive description: `https://www.blitzortung.org/en/compendium.php`.

## 3. Directory layout

```text
datasets/
  italy-west-coast-2026-08-17-18/
    manifest.json
    README.md
    acquisition.log
    checksums.sha256
    raw/
      radar-dpc/
        VMI/
        SRI/
        HRD/
      lightning/
        blitzortung/
        provider-*/
      observations/
        stations/
        signalk-weather-api/
      auxiliary/
        reanalysis/
    normalized/
      radar/
      hazards/
      lightning/
      weather-observations/
      vessel/
    scenarios/
    results/
      <algorithm-id>/
```

`raw/` is immutable. `normalized/` contains the provider-independent Storm Intelligence evidence representation. `results/` is disposable and may be regenerated.

## 4. Create the experiment workspace

```bash
export CASE=italy-west-coast-2026-08-17-18
mkdir -p datasets/$CASE/{raw/{radar-dpc/{VMI,SRI,HRD},lightning/blitzortung,observations/{stations,signalk-weather-api},auxiliary/reanalysis},normalized/{radar,hazards,lightning,weather-observations,vessel},scenarios,results}
cd datasets/$CASE
printf '%s\n' '2026-08-17T16:00:00Z 2026-08-18T08:00:00Z' > acquisition-window.txt
```

Use `curl --fail --location --retry 3` for HTTP acquisition. Save response headers when practical.

## 5. Radar-DPC: VMI, SRI and HRD

Radar-DPC is the preferred reference radar source for this Italian case because the same operational system provides national mosaics and the HRD severe-precipitation vector product.

The documented REST workflow provides:

- `findAvailableProducts` to discover product types;
- `findLastProductByType` for the latest timestamp/cadence;
- `existsProduct?type=...&time=...` to test an exact UTC millisecond timestamp;
- `downloadProduct` using a POST body containing `productType` and `productDate`.

### 5.1 Verify the service and product names

```bash
curl --fail --location \
  'https://radar-api.protezionecivile.it/wide/product/findAvailableProducts' \
  -o raw/radar-dpc/available-products.json
```

Confirm that `VMI`, `SRI` and `HRD` are advertised before acquisition. Provider catalogues can change.

### 5.2 Generate exact 5-minute timestamps

Do not use local time in filenames. The following creates UTC epoch milliseconds for the full experiment window:

```bash
python3 - <<'PY' > radar-times.txt
from datetime import datetime, timezone, timedelta
start=datetime(2026,8,17,16,0,tzinfo=timezone.utc)
end=datetime(2026,8,18,8,0,tzinfo=timezone.utc)
t=start
while t <= end:
    print(t.isoformat().replace('+00:00','Z'), int(t.timestamp()*1000))
    t += timedelta(minutes=5)
PY
```

### 5.3 Check availability and download native products

For each timestamp first call `existsProduct`. Download only timestamps reported available. This is important: provider archives can contain gaps and the requested instant may differ from the actual product timestamp.

```bash
while read iso ms; do
  for product in VMI SRI HRD; do
    available=$(curl --fail --silent --location \
      "https://radar-api.protezionecivile.it/wide/product/existsProduct?type=${product}&time=${ms}" || echo false)
    printf '%s,%s,%s,%s\n' "$iso" "$ms" "$product" "$available" >> raw/radar-dpc/availability.csv
    if [ "$available" = "true" ]; then
      ext=bin
      [ "$product" = HRD ] && ext=zip
      curl --fail --location --retry 3 \
        -H 'Content-Type: application/json' \
        --data "{\"productType\":\"${product}\",\"productDate\":${ms}}" \
        'https://radar-api.protezionecivile.it/wide/product/downloadProduct' \
        -o "raw/radar-dpc/${product}/${ms}.${ext}"
    fi
  done
done < radar-times.txt
```

Do not assume the raster filename extension returned by the service. Inspect `Content-Type`, GDAL identification and/or archive contents and record the actual representation in the manifest. HRD downloads are expected to be archives containing shapefile components according to the Radar-DPC documentation.

### 5.4 Optional WMS visual-control frames

For visual verification, use Radar-DPC WMS/WMTS with an explicit UTC `time` dimension. Store these images under `raw/radar-dpc/visual-control/`; do not substitute them for the native archive when evaluating algorithms which require quantitative radar values.

## 6. Lightning point observations

### 6.1 Blitzortung contributor archive

Blitzortung is useful for this benchmark when the researcher has authorized contributor credentials. Its documented protected archive stores Europe strike files in 10-minute UTC buckets, with older files gzip-compressed. The records include nanosecond timestamp, latitude, longitude and polarity; additional quality fields may be present.

For Europe, inspect the current Blitzortung documentation before choosing a `Strikes_*` region directory because assignments can evolve. For each ten-minute bucket in the experiment window, download the corresponding `YYYY/MM/DD/HH/MM.json.gz` (or `.json` when that is what the server exposes).

Illustrative authenticated request:

```bash
export BLITZ_USER='your-user'
export BLITZ_PASSWORD='your-password'
base='https://data.blitzortung.org/Data/Protected/Strikes_1'
curl --fail --user "$BLITZ_USER:$BLITZ_PASSWORD" \
  "$base/2026/08/17/20/00.json.gz" \
  -o raw/lightning/blitzortung/20260817T2000Z.json.gz
```

Generate every 10-minute path from 16:00Z on the 17th through 08:00Z on the 18th. Filter geographically **after** preserving the downloaded source files. The recommended benchmark box is 7–16.5 E, 36–45 N.

Blitzortung raw-data access and redistribution are restricted. Do not put protected raw strike files into the public source repository. Store only checksums/manifests and derived results when the applicable terms permit them.

### 6.2 Researchers without Blitzortung raw access

Use a lightning provider which legally supplies historical point observations for the interval, implementing the Storm Intelligence observation-provider specification. Record provider name, API/version, query bounds, time semantics, units, quality fields and licence.

A rendered historical lightning map is acceptable for **visual validation only**. It is not a substitute for point strikes when evaluating flash-rate, lightning-jump, nearest-strike or storm-cell-association algorithms.

## 7. Weather-station observations

The preferred experiment input is actual station observation data, not a gridded reconstruction.

### 7.1 Meteostat bulk station archive

Meteostat provides annual gzip-compressed station CSV files assembled from historical station databases, METAR and SYNOP sources. The annual dump pattern is:

```text
https://data.meteostat.net/hourly/{year}/{station}.csv.gz
```

First select stations around the western Italian domain and save their metadata. Include, where available, Sardinia, Liguria, Tuscany, Lazio, Campania and western Sicily/coastal stations. Keep stations outside the storm path as controls.

For every selected station:

```bash
STATION=<meteostat-station-id>
curl --fail --location \
  "https://data.meteostat.net/hourly/2026/${STATION}.csv.gz" \
  -o "raw/observations/stations/${STATION}-2026.csv.gz"
```

Extract only the experiment window into `normalized/weather-observations/`, but retain the complete annual source file in `raw/`. Useful fields include temperature, relative humidity, precipitation, wind direction, wind speed, peak gust and sea-level pressure. Record each field's source/provenance columns when present.

Meteostat can include model-filled values. For a strict observational benchmark, preserve source flags and either exclude filled values or label them explicitly.

### 7.2 Signal K Weather API capture

If a Signal K Weather Provider can reproduce historical observations, store its normalized output too. The test harness should sample the same vessel-centered ring used by the plugin and save the returned `WeatherData` objects rather than allowing inference algorithms to query the provider live.

Example normalized file:

```json
{
  "queryPosition": {"latitude": 41.0, "longitude": 12.0},
  "observedAt": "2026-08-17T22:00:00Z",
  "provider": "provider-id",
  "values": {
    "temperature": 296.15,
    "relativeHumidity": 0.82,
    "pressure": 100800,
    "windSpeedTrue": 12.4,
    "windDirectionTrue": 4.71,
    "gust": 18.0
  }
}
```

Use Signal K SI units in normalized data.

## 8. Auxiliary gridded weather: never label it a station observation

For gap analysis or algorithm sensitivity tests, Open-Meteo's Historical Weather API can provide hourly reanalysis/analysis fields such as temperature, relative humidity, pressure, precipitation, wind and gust. Its documentation states that historical products are based on reanalysis/model datasets which assimilate observations. Therefore store these under `raw/auxiliary/reanalysis`, not `raw/observations`.

Example control-point request:

```bash
curl --fail --location \
 'https://archive-api.open-meteo.com/v1/archive?latitude=40.85&longitude=14.27&start_date=2026-08-17&end_date=2026-08-18&hourly=temperature_2m,relative_humidity_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=GMT' \
 -o raw/auxiliary/reanalysis/naples-20260817-18.json
```

Repeat for the benchmark points required by the experiment. Do not mix these values into the primary station-observation score unless the experiment explicitly studies reanalysis-assisted inference.

## 9. Vessel and onboard-sensor evidence

A historical algorithm benchmark needs a vessel context because Storm Intelligence computes vessel-relative threat.

Preferred order:

1. real Signal K log from a vessel, with consent and location/privacy review;
2. an independently recorded NMEA/Signal K track;
3. a synthetic scenario explicitly marked `synthetic`.

Store navigation and environmental inputs independently of meteorological providers. At minimum:

```text
navigation.position
navigation.speedOverGround
navigation.courseOverGroundTrue
environment.wind.speedTrue
environment.wind.directionTrue
environment.outside.temperature
environment.outside.humidity
```

Add pressure, gust and precipitation when available. Preserve source timestamps and original SI values.

For a synthetic scenario, never tune the route after looking at the algorithm output. Define it before evaluation and commit it with the dataset manifest.

## 10. Normalize without losing provenance

Every normalized record should contain enough information to trace it back to one immutable raw object:

```json
{
  "provider": "radar-dpc",
  "kind": "radar-frame",
  "product": "VMI",
  "observedAt": "2026-08-17T22:15:00Z",
  "retrievedAt": "2026-08-18T...Z",
  "raw": "raw/radar-dpc/VMI/....bin",
  "sha256": "...",
  "normalizer": "storm-intelligence/<git-commit>",
  "quality": {},
  "licence": "provider-specific"
}
```

Normalization code must be versioned. If normalization changes, generate a new normalized dataset instead of altering the raw archive.

## 11. Manifest and checksums

After acquisition:

```bash
find raw -type f -print0 | sort -z | xargs -0 sha256sum > checksums.sha256
```

`manifest.json` should include at least:

```json
{
  "schema": "storm-intelligence-reproducibility/1",
  "case": "italy-west-coast-2026-08-17-18",
  "datasetVersion": "1.0.0",
  "window": {
    "start": "2026-08-17T16:00:00Z",
    "end": "2026-08-18T08:00:00Z"
  },
  "bounds": {"west": 7.0, "south": 36.0, "east": 16.5, "north": 45.0},
  "sources": [],
  "vesselScenario": "scenarios/<name>.json",
  "createdAt": "<UTC timestamp>",
  "software": {
    "plugin": "signalk-storm-intelligence",
    "version": "2.x",
    "gitCommit": "<commit>"
  }
}
```

Never store passwords, API keys or bearer tokens in the manifest.

A machine-readable JSON Schema is shipped as [`reproducibility-manifest.schema.json`](reproducibility-manifest.schema.json). The schema is intentionally conservative: provider-specific metadata belongs in extensible source records, while core case/time/domain/software fields remain stable. Validate the manifest before freezing the benchmark.

A benchmark version should be immutable. If any raw file, normalization rule, label, vessel scenario, or inclusion rule changes, increment the dataset version and generate a new checksum inventory. Do not mutate a published benchmark in place.

## 12. Freeze a benchmark bundle

Before running an inference algorithm:

```bash
sha256sum -c checksums.sha256
# commit source + normalization scripts
# record node --version, npm --version and OS/architecture
```

Create a read-only snapshot or tar archive of `manifest.json`, `checksums.sha256`, normalized inputs and redistributable raw data. Protected/licensed raw data may need to remain outside the shareable bundle; in that case publish the acquisition recipe and checksums instead.

## 13. Replay current and future inference algorithms

Algorithms should consume the same normalized evidence timeline. A reproducibility harness should:

1. load `manifest.json`;
2. validate checksums;
3. sort evidence strictly by `observedAt`;
4. reveal evidence incrementally to prevent future-data leakage;
5. execute all enabled algorithms for each inference instant;
6. save each algorithm result separately;
7. save the ensemble result separately;
8. record algorithm id, version/settings and runtime environment.

Suggested result layout:

```text
results/
  kinematic-polygon/
    config.json
    inference.ndjson
  multisensor-evidence/
    config.json
    inference.ndjson
  future-probabilistic-model/
    config.json
    inference.ndjson
  ensemble/
    config.json
    inference.ndjson
```

Never let a future algorithm re-download “better” historical inputs during evaluation. If the dataset changes, it is a new dataset version.

## 14. Evaluation targets for the 17–18 August case

At minimum evaluate:

- radar/HRD cell detection availability and missing-frame rate;
- track continuity, split/merge/loss/reacquisition behavior;
- motion-vector stability and uncertainty;
- lightning association per cell and flash-rate trend;
- nearest-strike and lightning-jump behavior;
- station/onboard corroboration freshness and spatial gradients;
- predicted vessel-path/polygon interception time;
- warning/alarm lead time;
- false warnings for cells moving away from the vessel;
- behavior when one evidence domain is deliberately withheld;
- algorithm disagreement and ensemble behavior.

Use ablation experiments with exactly the same timeline:

```text
A radar only
B radar + lightning
C radar + station observations
D radar + lightning + station observations
E D + onboard sensors
F lightning + observations, radar withheld (degraded-continuity test)
```

The primary safety expectation remains: corroborating environmental observations must not invent a remote storm cell when no primary storm evidence exists.

## 15. Time and leakage checks

The night crosses midnight and local/UTC conversion is a common reproducibility failure. All normalized timestamps must be timezone-aware UTC.

For each inference instant `T`, assert:

```text
observedAt <= T
receivedAt <= replay clock T, when receivedAt is part of the experiment
```

Forecast/nowcast data must additionally carry `generatedAt`, `validAt` and lead time. Do not expose a forecast generated after `T` to an algorithm replaying `T`.

## 16. Reference annotations and independent event adjudication

Algorithm evaluation requires targets which are independent of the tested inference method. For the 17–18 August case, create an annotation set only after the raw evidence bundle has been frozen. Depending on the research question, reference annotations may include:

- storm-cell identity and continuity across frames;
- split/merge events;
- polygon location or a reference hazardous region;
- first/last detection time;
- closest passage to a predefined vessel trajectory;
- impact/no-impact within predefined spatial and temporal tolerances;
- observed lightning intensification intervals;
- official warning intervals as **context**, not necessarily as geometric ground truth.

Prefer at least two independent expert annotators for subjective cell-tracking or event-boundary tasks. Record disagreements and the adjudication procedure. Report inter-annotator agreement when the labels are used to claim algorithm skill. Never replace disagreement with an unreported consensus.

Reference labels should be stored under a dedicated immutable directory, for example `reference/annotations-v1/`, with author/date/methodology metadata and checksums.

## 17. Evaluation metrics and uncertainty

Choose metrics before inspecting final results. Appropriate metrics depend on algorithm capability and may include:

- **detection:** precision, recall, F1, false-alarm ratio and probability of detection;
- **track association:** track continuity, identity switches, fragmentation and split/merge handling;
- **geometry:** polygon intersection-over-union, centroid error and boundary-distance error;
- **motion:** vector speed/course error and displacement error by lead time;
- **ETA/interception:** absolute ETA error, signed bias, missed-interception rate and false-interception rate;
- **threat classification:** confusion matrix and per-class precision/recall;
- **probabilistic/calibrated models:** Brier score, log loss, reliability/calibration diagrams and expected calibration error;
- **operational value:** warning lead time conditional on correct detection and nuisance-warning duration;
- **availability:** fraction of inference cycles with sufficient evidence and degradation behavior by missing modality.

Report metrics per event and per vessel scenario before macro/micro aggregation. For small event collections, uncertainty intervals should be computed at the **event level** rather than treating highly correlated five-minute frames as independent samples. Bootstrap or resampling procedures should resample events/episodes, not individual adjacent frames.

For deterministic methods, repeatability should be exact given the same input bundle and configuration. For stochastic ML methods, fix and record seeds and report variability across repeated fits where scientifically relevant. For hosted LLMs, treat repeated calls as potentially different experimental realizations unless exact response replay is used.

## 18. Provider outages and unavailable archives

Historical provider availability is part of the result, not something to hide.

If Radar-DPC reports that a requested frame does not exist, record the gap. If a lightning provider does not permit historical raw access, record the limitation and use another legally accessible provider. If station data are delayed or later corrected, record the retrieval date/version.

A benchmark may have tiers:

- **Tier 1 / open** — redistributable radar/observations and synthetic vessel scenario;
- **Tier 2 / credentialed** — adds protected lightning point data;
- **Tier 3 / operational** — adds real vessel/onboard logs where consent permits.

Algorithms should declare which tier they require.

## 19. What to publish with a paper or board proposal

Publish, when licences allow:

- this acquisition recipe and the exact source revision;
- `manifest.json`;
- checksums;
- normalization scripts;
- provider/API versions and retrieval dates;
- algorithm configurations;
- synthetic vessel scenarios;
- inference outputs and evaluation scripts;
- a machine-readable list of missing/unavailable inputs.

Do **not** republish protected lightning raw data or private vessel logs merely for convenience.

## 20. Extending the benchmark to future providers and algorithms

A future provider is reproducible when it can produce the same normalized evidence concepts with explicit time, location/coverage, units, provenance, quality and licence metadata. Follow `data-provider-onboarding.md`, `radar-provider-specification.md` and `observation-provider-specification.md`.

A future inference algorithm must follow `inference-algorithm-specification.md` and must run from the frozen evidence bundle without direct network access. This is the key rule which makes results comparable across algorithm generations.

## 21. Final acquisition checklist

- [ ] Experiment interval and geographic domain frozen in UTC.
- [ ] Radar-DPC product catalogue saved.
- [ ] VMI availability checked and available frames downloaded.
- [ ] SRI availability checked and available frames downloaded.
- [ ] HRD availability checked and available vector archives downloaded.
- [ ] Lightning point observations acquired legally or limitation documented.
- [ ] Weather-station source files and station metadata saved.
- [ ] Reanalysis/model controls stored separately from observations.
- [ ] Vessel scenario/log frozen before inference evaluation.
- [ ] Onboard environmental data provenance preserved.
- [ ] Raw files immutable.
- [ ] Normalization version recorded.
- [ ] `manifest.json` complete.
- [ ] `checksums.sha256` validates.
- [ ] Credentials absent from the dataset.
- [ ] Algorithms run offline from the same evidence timeline.
- [ ] Per-algorithm and ensemble outputs saved independently.

## 22. Training and evaluating pretrained DNN algorithms

For machine-learning algorithms, freeze the **event split** before training. Frames from the same convective episode are strongly correlated and MUST NOT be randomly divided between training and test sets. Prefer leave-one-event-out or geographically/temporally separated evaluation.

For every pretrained model archive:

1. save the exact frozen dataset manifests used for training, validation and test;
2. record feature-extraction code revision;
3. record model architecture, seed, optimizer and hyperparameters;
4. save the immutable trained model and SHA-256 checksum;
5. evaluate missing-modality ablations;
6. evaluate calibration as well as classification accuracy;
7. compare against deterministic algorithms on the same inference instants;
8. preserve per-event metrics, not only aggregate metrics;
9. document whether the 17–18 August 2026 western Italy event was training, validation or untouched test data;
10. never permit the inference model to fetch network data outside the frozen evidence bundle.

The bundled `stormfusion-reference-v1.json` is generated by `scripts/train-reference-dnn.js` from synthetic physically informed samples and exists to validate the software path. It MUST NOT be cited as a meteorologically validated model.

## 23. LLM-backed inference reproducibility

For `llm-openai-compatible`, the frozen meteorological bundle is necessary but not sufficient because a hosted LLM may be nondeterministic and a model alias may change.

For every LLM call used in a published/evaluated run, save the validated structured assessment together with model id returned by the endpoint, API protocol, response/request ids when available, UTC call time, request fingerprint, usage, algorithm settings and plugin/source revision. Never save the API key.

Prefer **recorded-response replay** when comparing downstream ensembles across software changes. A fresh call to a hosted LLM is a new inference run and must not silently replace the recorded response of an earlier benchmark.

For the 17–18 August 2026 western Italy benchmark, run the deterministic algorithms first, freeze their candidate ids/evidence snapshots, then evaluate the LLM against exactly those candidates. This prevents changes in candidate generation from being confused with changes in LLM reasoning.


## 24. Execution-environment capture

For every benchmark run, save an environment record with at least:

```bash
node --version
npm --version
uname -a
npm ls --all --json > results/environment-npm-tree.json
sha256sum models/* 2>/dev/null || true
```

Also record the package version, Git commit, operating-system/container image identifier, CPU architecture, enabled algorithms, complete non-secret configuration, model checksums, and relevant environment-variable **names** (never their secret values). If an inference result depends on floating-point hardware/runtime behavior, document the execution architecture.

## 25. Recommended benchmark release artefacts

A citable benchmark release should contain, subject to provider licences and privacy constraints:

- a dataset version and immutable manifest;
- the manifest JSON Schema version;
- raw-data checksums and acquisition logs;
- redistributable raw inputs or exact retrieval recipes for restricted inputs;
- normalized evidence and normalizer revision;
- reference annotations and annotation protocol;
- vessel scenarios and their provenance;
- algorithm configurations and model checksums;
- deterministic/recorded LLM outputs used in the publication;
- metric-generation scripts and machine-readable results;
- a limitations statement identifying missing products, outages and restricted data.

When depositing a benchmark in a long-term repository, assign a DOI/versioned identifier where possible. Never overwrite a DOI-backed dataset version; publish a new version with an explicit change log.

## 26. Minimal reproducibility claim

A paper, technical report, thesis, or Signal K proposal should only claim a Storm Intelligence experiment is reproducible when an independent researcher can reconstruct the normalized evidence timeline and rerun the declared algorithms **without relying on undocumented live state**. If raw redistribution is legally impossible, the claim should be narrowed to *computational reproducibility conditional on authorized access to the cited upstream data*.
