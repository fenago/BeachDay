# Response object, errors, and multi-location requests
Source: https://open-meteo.com/en/docs (sections "JSON return object", "Errors", parameter `latitude, longitude`)
Source: https://open-meteo.com/en/docs/marine-weather-api (same sections)
Retrieved: 2026-11-23

## JSON return object
| Field | Type | Meaning |
|---|---|---|
| `latitude`, `longitude` | float | "WGS84 of the center of the weather grid-cell which was used to generate this forecast. This coordinate might be a few kilometres away from the requested coordinate." |
| `elevation` | float | DEM elevation used for downscaling (Forecast) |
| `generationtime_ms` | float | Server time; monitoring only |
| `utc_offset_seconds` | int | Fixed for the whole response (03-time-zones-and-dst.md) |
| `timezone`, `timezone_abbreviation` | string | Resolved zone + abbreviation at request time |
| `current` | object | Values + `time` + `interval` (seconds the backward sums cover, e.g. 900) |
| `hourly` | object | One array per variable **plus** a `time` array |
| `hourly_units` | object | Unit per variable (and `time: "iso8601"`) |
| `daily`, `daily_units` | object | Same pattern for daily |

All arrays in a block have the same length as its `time` array (true in both real fixtures; the docs describe each variable as "a floating point array" alongside "a time array"). Our validator asserts it.

Values can be `null` for hours a model doesn't cover **[UNVERIFIED on the docs pages; commonly observed at the end of a range]** — the normalizer must accept `null` and score without that factor.

## Errors
Docs, quoted: "In case an error occurs, for example a URL parameter is not correctly specified, a JSON error object is returned with a HTTP 400 status code."
```json
{ "error": true, "reason": "Cannot initialize WeatherVariable from invalid String value tempeture_2m for key hourly" }
```
Real error captured 2026-11-23 (`hourly=tempeture_2m`), HTTP **400**, `content-type: application/json`:
```json
{"reason":"Invalid value: Cannot initialize SurfacePressureAndHeightVariable<…> from invalid String value tempeture_2m","error":true}
```
So: key order differs and the `reason` text is an internal message — **match on `error === true`, never on the reason text**, and don't show `reason` to end users (log it).

Other failures the docs don't describe but a client must handle:
- Rate limiting when over the fair-use limits **[UNVERIFIED: status code (commonly 429) and body are not documented on the docs/terms/pricing pages]**.
- Network failure, offline, DNS, CORS — `fetch` rejects with `TypeError`.
- Timeouts — enforce our own with `AbortSignal.timeout(ms)`; the API has no timeout parameter.
- 5xx / non-JSON bodies.

Recommended client taxonomy (implemented in `examples/01-openmeteo-client/openmeteo.mjs`):
| kind | Trigger | UI |
|---|---|---|
| `api` | body `error: true` (HTTP 400) | "Couldn't load forecast" + log reason (it's our bug) |
| `http` | other non-2xx | "Forecast service busy, showing saved data" |
| `timeout` | AbortSignal timeout | same, serve cache |
| `network` | fetch rejected | "Offline — showing data from 8:15 am" |
| `shape` | validation failed | treat like `api` |

## Multiple locations in one request
Docs: "Multiple coordinates can be comma separated. E.g. &latitude=52.52,48.85&longitude=13.41,2.35. To return data for multiple locations the JSON output changes to a list of structures. CSV and XLSX formats add a column location_id." `elevation` and `timezone` may also be comma lists.

Real response captured 2026-11-23 (`latitude=25.781,26.705&longitude=-80.130,-80.032&daily=sunrise,sunset&timezone=America/New_York&forecast_days=1`):
```json
[ { "latitude": 25.814812, "longitude": -80.12985, ..., "daily": {...} },
  { "latitude": 26.71615, "longitude": -80.05735, ..., "location_id": 1, "daily": {...} } ]
```
- Top level is an **array**, in request order.
- In JSON the **first element has no `location_id`**; the second has `location_id: 1`. Use array index, not `location_id`.
- The Palm Beach land point (26.705, −80.032) snapped to 26.716, −80.057 — ~2.7 km **inland/west** under default `cell_selection=land`.
Fixture: `examples/01-openmeteo-client/fixtures/multi-location.json`.

Cost: the pricing page counts per variable and period "for a single location"; a multi-location request presumably counts once per location **[UNVERIFIED]**. It saves round trips, not quota.

## Beach Day notes
- The single-beach screen does one Forecast + one Marine request in parallel (`Promise.allSettled`), Marine failure is soft.
- The favourites/list screen may batch all favourite beaches into one Forecast request and one Marine request (array response). Keep the order mapping to beach IDs in the caller.
- Validate shape before scoring; a validation failure must never produce a verdict.
- Never surface `reason` strings or stack traces in the UI (secure-by-design: no internal detail leakage).
