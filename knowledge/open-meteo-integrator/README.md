# Knowledge: open-meteo-integrator
Date: 2026-11-23. Notes are from the official Open-Meteo pages (each file lists its sources); examples were run with Node 22 and their output is in each example's README. Read everything here before any Open-Meteo, parsing, caching or scoring task.

## docs/
| File | Covers | Read when |
|---|---|---|
| [docs/01-forecast-api.md](docs/01-forecast-api.md) | Forecast endpoint, all URL params with ranges/defaults, the 13 hourly + 5 daily variables we use with units and "valid time" (instant vs preceding hour), observed unit strings (`mp/h`), canonical request | Building or changing the Forecast request or reading its fields |
| [docs/02-weather-codes.md](docs/02-weather-codes.md) | Full WMO code table, hail footnote (96/99 only from some models), Beach Day code groups, daily-code pitfall | Scoring thunder/rain, writing condition text or icons |
| [docs/03-time-zones-and-dst.md](docs/03-time-zones-and-dst.md) | `timezone`, fixed `utc_offset_seconds`, DST ignored within range, `timeformat=unixtime`, safe parsing/formatting | Anything with times: beach window, "best window" copy, sunrise/sunset |
| [docs/04-marine-api.md](docs/04-marine-api.md) | Marine endpoint, params (`length_unit`, 0–8 days, default contradiction, `cell_selection=sea`), wave/swell/SST/current/sea-level variables, models and resolutions, coastal caveats, real grid snap | Waves, swell, water temperature, marine points |
| [docs/05-response-errors-multi-location.md](docs/05-response-errors-multi-location.md) | JSON return object, HTTP 400 error format (real sample), client error taxonomy, comma-separated multi-location (array, `location_id` quirk) | Parsing, validation, error UI, batching favourites |
| [docs/06-terms-limits-attribution.md](docs/06-terms-limits-attribution.md) | Non-commercial terms, 600/min 5k/h 10k/day 300k/month, call counting (>10 vars), Netlify IP warning, CC BY 4.0 attribution HTML, marine provider credit, caching policy, budget | Attribution UI, caching/refresh logic, anything near "commercial" or proxies |

## examples/
| Folder | Shows | Read when |
|---|---|---|
| [examples/01-openmeteo-client/](examples/01-openmeteo-client/) | URL builders, fetch-with-timeout, typed errors, validator, normalizer, fail-soft marine; 8 tests against **real** fixtures (forecast, marine, 400 error, multi-location) via a local mock server | Writing `public/js/api/openmeteo.js` or its tests; need fixtures |
| [examples/02-beach-window/](examples/02-beach-window/) | Beach window max(sunrise+1h, 8am)..min(sunset−0.5h, 7pm) with DST-correct instants; 7 tests incl. DST shift | Scoring window, any time display |
| [examples/03-cache-age/](examples/03-cache-age/) | Stale-after-30-min logic, refetch rules (no polling), "Updated / Offline — showing data from" labels; 4 tests | Caching, offline state, last-updated line |
| [examples/04-score-config/](examples/04-score-config/) | Thresholds as data (half-open bands), reference `scoreHour`/`scoreDay`/`heatIndexF`, hand-written boundary table; 65 tests | Writing `score-config.js`, `score.js` or their tests; boundary list for QA |

## Key facts (one line each)
- SST is always °C (even with `length_unit=imperial`); convert to °F.
- Marine `forecast_days` max 8; docs give two defaults (5 and 7), so always send it.
- Times are offset-less local strings at one fixed offset; DST inside the range is ignored.
- Errors: HTTP 400 `{"error":true,"reason":...}`; match on `error`, never on `reason` text.
- Multi-location → JSON array; first element has no `location_id`.
- Call from the browser only; Open-Meteo warns Netlify IPs get rate-limited early.
- Scoring bands are half-open, lower bound inclusive; preceding-hour fields are read from row T+1 h; rain family counts once (cap −60); thunder = 0 for the hour and the next.
- Heat-index procedure and NWS band edges are UNVERIFIED (NWS hosts blocked 2026-11-23); live marine check at 25.781, -80.110 is pending.
- Attribution link `Weather data by Open-Meteo.com` next to the data, always.
