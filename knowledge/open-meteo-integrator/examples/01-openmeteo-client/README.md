# Example 01: Open-Meteo client (URL builder, fetch with timeout, validator, normalizer)

## What it shows
`openmeteo.mjs` is the reference shape for `public/js/api/openmeteo.js`:
- `buildForecastUrl` / `buildMarineUrl`: the exact Beach Day variables, unit params (`fahrenheit`, `mph`, `inch`, `length_unit=imperial`), `timezone=America/New_York`, range checks (`forecast_days` 1–16 Forecast, 1–8 Marine, always explicit).
- `fetchJson`: `fetch` + `AbortSignal.timeout`, and a typed `OpenMeteoError` with `kind` = `api` (HTTP 400 `{"error":true,"reason":...}`), `http`, `timeout`, `network`, `shape`.
- `validateResponse`: required fields present, every variable array the same length as `time`, rejects the multi-location array shape where a single object is expected.
- `normalize`: one per-hour model joining Forecast + Marine by the local `time` string, SST °C → °F, `is_day` → boolean, marine grid-snap check (≤ 5 km from the beach's marine point), **fail-soft** marine (`marine.available=false`, label "Waves unavailable").
- `loadBeach`: both requests in parallel with `Promise.allSettled`; a marine outage never breaks the forecast.

Why it is "what good looks like": no dependencies, browser-compatible (only `fetch`, `URL`, `AbortSignal`), the browser calls Open-Meteo directly (ADR-0001), wave data is labelled "Offshore waves", nothing about rip currents is derived (ADR-0002), and the tests run against **real** API responses.

## Fixtures (real responses)
`api.open-meteo.com` and `marine-api.open-meteo.com` are not reachable from the sandbox shell, so the JSON was fetched on 2026-11-23 with Firecrawl (`firecrawl_scrape`, `formats: ["rawHtml"]`, `maxAge: 0`) and saved unmodified:
| File | Request |
|---|---|
| `fixtures/forecast-miami-beach.json` | `/v1/forecast?latitude=25.781&longitude=-80.130&hourly=<13 vars>&daily=sunrise,sunset,uv_index_max,precipitation_probability_max,weather_code&timezone=America/New_York&forecast_days=2&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` (HTTP 200) |
| `fixtures/marine-miami-beach.json` | `/v1/marine?latitude=25.781&longitude=-80.110&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature&daily=wave_height_max&timezone=America/New_York&forecast_days=2&length_unit=imperial` (HTTP 200). A separate request at exactly 25.781,-80.130 returned the same grid cell (25.791664, -80.12499). |
| `fixtures/error-400.json` | `/v1/forecast?latitude=25.781&longitude=-80.130&hourly=tempeture_2m` (HTTP 400) |
| `fixtures/multi-location.json` | `/v1/forecast?latitude=25.781,26.705&longitude=-80.130,-80.032&daily=sunrise,sunset&timezone=America/New_York&forecast_days=1` (HTTP 200, JSON array) |

The fetch tests use a local `node:http` mock server that serves these fixtures; no real network calls are made by the tests.

## Run
```bash
cd knowledge/open-meteo-integrator/examples/01-openmeteo-client
node --test openmeteo.test.mjs
```
Node 22, no `npm install` needed.

## Verified
Command: `node --test --test-reporter=spec openmeteo.test.mjs` (Node v22.23.5, 2026-11-23)
```
✔ forecast URL has exact variables, units and timezone (1.330796ms)
✔ marine URL is imperial, explicit forecast_days, max 8 days (0.407513ms)
✔ real fixtures validate; broken shapes are rejected (0.594833ms)
✔ normalize merges forecast + marine by local time and converts SST to °F (1.503243ms)
✔ marine missing or far away fails soft (0.38342ms)
✔ fetchJson: 400 error body becomes OpenMeteoError(api) with reason (25.53974ms)
✔ fetchJson: timeout aborts (204.613386ms)
✔ loadBeach end-to-end; marine outage still returns forecast (9.357077ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```
Normalized 13:00 hour from the real fixtures (trimmed): `tempF 74.6, feelsF 78.7, rainChance 0, weatherCode 2, windMph 6.3, gustMph 7.6, uv 5.15, isDay true, waveFt 0.919, wavePeriodS 5.7, swellFt 0.656, seaTempF 78.1`; `marine: { available: true, label: 'Offshore waves', snapKm: 1.3 }`; forecast grid cell 3.8 km from the requested point.
