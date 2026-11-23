---
name: open-meteo-apis
description: Open-Meteo Forecast and Marine API reference for Beach Day — endpoints, exact variable names, units, response shape, limits, attribution and known gotchas. Use when fetching, parsing, mocking or testing weather and marine data.
---
# Open-Meteo APIs (details: docs/01-use-case-and-scoring.md §2–4, §7)

## Forecast
`GET https://api.open-meteo.com/v1/forecast`
```
?latitude=25.781&longitude=-80.130
&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,cape,is_day
&daily=sunrise,sunset,uv_index_max,precipitation_probability_max,weather_code
&timezone=America/New_York&forecast_days=7
&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch
```
- `forecast_days` ranges from 0 to 16. `daily` requires `timezone`.
- DST changes within the requested range are ignored, so use `timeformat=unixtime` if you need DST precision.
- Leave `models` at `best_match`. NAM was discontinued on 2026-11-01.
- **Thunderstorm WMO codes:** 95, 96, 97, 99. Showers: 80–82. Rain: 61/63/65.

## Marine
`GET https://marine-api.open-meteo.com/v1/marine`
```
?latitude=<marine point>&longitude=<marine point>
&hourly=wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature
&daily=wave_height_max
&timezone=America/New_York&forecast_days=7&length_unit=imperial
```
- `forecast_days` ranges from 0 to 8. Always pass it explicitly: the docs disagree on the default.
- **SST is returned in °C.** Convert it to °F yourself.
- There is no daily SST value. Aggregate it from the hourly data.
- Waves come from coarse, roughly 8 km offshore models. **Label them "offshore waves"**, not surf height.
- Don't show `sea_level_height_msl` as tides. The data is unreliable at the coast; link to NOAA instead.
- **Grid snapping:** a point near Palm Beach or Jupiter can snap about 15 km out into the Gulf Stream. Use a hand-picked **marine point** for each beach, and test that the returned lat/lon is within about 5 km of it.

## Response shape
```json
{ "latitude": 25.81, "longitude": -80.13, "utc_offset_seconds": -18000, "timezone": "America/New_York",
  "hourly_units": { "temperature_2m": "°F", "wind_speed_10m": "mp/h", "uv_index": "" },
  "hourly": { "time": ["2026-11-23T00:00", "..."], "temperature_2m": [70.9, "..."] },
  "daily": { "time": ["2026-11-23"], "sunrise": ["2026-11-23T06:44"], "uv_index_max": [5.15] } }
```
- Hourly data starts at local midnight. All arrays have the same length as `time`.
- Comma-separated lat/lon lists return a JSON **array**, with `location_id` set on elements after the first.
- Errors come back as `400 {"error":true,"reason":"..."}`.
- Validate the shape and fail soft: show "Waves unavailable" rather than breaking.

## Terms
- Free for **non-commercial** use, meaning no ads and no subscriptions.
- Limits: under 10k calls/day, 5k/hour, 600/minute and 300k/month.
  - A request counts as more than one call if it asks for more than 10 variables (15 variables ≈ 1.5 calls).
- Rate limits are per IP and Open-Meteo warns about Netlify. **Call from the browser** (ADR-0001).
- **CC BY 4.0:** show `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>` next to the data.
- Cache responses and refresh at most every 30–60 minutes. Never poll in the background.

## Testing
Save real responses as fixtures in `tests/fixtures/openmeteo/` for: a calm sunny day, a thunderstorm afternoon, a windy front, high UV, rough seas, and a multi-location array.
