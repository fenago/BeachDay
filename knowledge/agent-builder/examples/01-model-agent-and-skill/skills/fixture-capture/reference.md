# fixture-capture reference (loaded only when needed)

## Required scenarios (from the open-meteo-apis skill, "Testing")
| File | Scenario |
|---|---|
| forecast-calm-sunny.json | Calm, sunny day |
| forecast-thunderstorm-pm.json | Afternoon `weather_code` 95–99 |
| forecast-windy-front.json | Gusts ≥ 32 mph |
| forecast-high-uv.json | `uv_index` ≥ 8 |
| marine-rough-seas.json | `wave_height` > 5 ft |
| forecast-multi-location.json | Comma-separated lat/lon → JSON array |

## Shape checks
- `hourly.time.length === hourly[var].length` for every requested hourly variable.
- `daily.time.length === forecast_days`.
- `timezone === "America/New_York"`.
- Marine `sea_surface_temperature` is in °C (`hourly_units.sea_surface_temperature === "°C"`).
- Marine `latitude`/`longitude` is within about 5 km of the requested marine point (grid snapping).
