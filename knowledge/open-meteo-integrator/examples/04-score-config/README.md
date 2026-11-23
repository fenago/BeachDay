# Example 04: score config as data + reference `scoreHour` / `scoreDay`

## What it shows
- `score-config.mjs`: every threshold as data. Each band list is **half-open, lower bound inclusive** (`from` <= x wins), starts at `-Infinity`, and is strictly ascending, so a gap or an overlap cannot be written. This is the shape for `public/js/score-config.js` (spec in docs/01 section 5.5).
- `score.mjs`: pure `scoreHour(hour, {priorThunder})`, `scoreDay({hours, priorHour, dayIndex})` and `heatIndexF(t, rh)`. Decisions encoded: hard stops, rain-family stacking cap, thunder carry-over (also from the hour before the window), windows shorter than 3 hours, best-window eligibility, rounded verdict score, confidence rules, SST window mean, UV advice only.
- `score.test.mjs`: 65 tests. The `BOUNDARIES` table is hand-written (independent of the config) and is the boundary list Tess should port: every band edge from both sides, including the old gaps (feels-like 77.9 and 90.9, wind 12.9, SST 77.9) and the old overlap (waves 3.0 -> -20, 5.0 -> -35).

Input hours use the field names of the normalizer in `../01-openmeteo-client/openmeteo.mjs` (`feelsF`, `windMph`, `rainChance`, `rainIn`, `weatherCode`, `cloudPct`, `cape`, `waveFt`, `seaTempF`, `humidity`, `uv`).
Note: that normalizer does **not** yet apply the preceding-hour shift decided in docs/01 section 5.2 (`precipitation`, `precipitation_probability`, `wind_gusts_10m`, `uv_index` are read from the next row). Add it when `public/js/api/openmeteo.js` is built.

## Run
```bash
cd knowledge/open-meteo-integrator/examples/04-score-config
node --test --test-reporter=spec score.test.mjs
```
Node 22, no dependencies.

## Verified
Node v22.23.5, 2026-11-23: `tests 65, pass 65, fail 0`. Heat index sanity: `heatIndexF(90, 50) = 94.60` (NWS chart shows 95; **chart value UNVERIFIED this session, NWS hosts were blocked**), `heatIndexF(96, 60) = 116.13`.

## Not verified
- The Rothfusz coefficients and the two adjustments are written from the NWS WPC heat-index equation page (https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml) as I know it; the page could not be fetched here (host not allowed). Re-check before release.
- Nothing here was run against live Open-Meteo data (see docs/01 section 3 "pending live verification").
