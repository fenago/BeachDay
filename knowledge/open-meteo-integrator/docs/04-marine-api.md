# Marine API: waves, swell, sea-surface temperature
Source: https://open-meteo.com/en/docs/marine-weather-api
Retrieved: 2026-11-23

## Endpoint
`GET https://marine-api.open-meteo.com/v1/marine` — same licence and limits as the Forecast API ("Only for non-commercial use and less than 10.000 daily API calls").

## Parameters (differences from Forecast in bold)
| Parameter | Range / values | Default | Notes |
|---|---|---|---|
| `latitude`, `longitude` | float | required | Comma lists → JSON array |
| `hourly`, `daily`, `current` | string arrays | – | `daily` requires `timezone` |
| `timeformat` | `iso8601` \| `unixtime` | `iso8601` | Same fixed-offset semantics (03-time-zones-and-dst.md) |
| `timezone` | IANA / `auto` | `GMT` | DST within range ignored |
| `past_days` | 0–92 | 0 | |
| **`forecast_days`** | **0–8** | **documented as `5` in the table, but the description says "Per default, 7 days are returned. Up to 8 days of forecast are possible."** | The page contradicts itself — always pass it explicitly. |
| `forecast_hours`, `past_hours` | int > 0 | – | |
| `start_date`/`end_date`, `start_hour`/`end_hour` | dates | – | |
| **`length_unit`** | `metric` \| `imperial` | `metric` | Wave heights in m or ft |
| **`cell_selection`** | `land` \| `sea` \| `nearest` | **`sea`** | Marine prefers sea cells |
| `apikey` | string | – | Commercial only |

Velocity unit for `ocean_current_velocity`: the page's settings panel shows a "Velocity Unit" control but the parameter table does not list its name **[UNVERIFIED: parameter name, likely `velocity_unit`]**. Beach Day doesn't request currents.

## Hourly variables
| Variable(s) | Valid time | Unit | Meaning |
|---|---|---|---|
| `wave_height`, `wind_wave_height`, `swell_wave_height`, `secondary_swell_wave_height`, `tertiary_swell_wave_height` | Instant | Meter (ft with imperial) | Significant mean / wind / swell wave height |
| `wave_direction`, `wind_wave_direction`, `swell_wave_direction`, (secondary/tertiary) | Instant | ° | "Wave directions are always reported as the direction the waves come from. 0° = From north towards south; 90° = From east" |
| `wave_period`, `wind_wave_period`, `swell_wave_period`, (secondary/tertiary) | Instant | Seconds | Mean period |
| `wind_wave_peak_period`, `swell_wave_peak_period` | Instant | Seconds | Peak period (also `wave_peak_period` in the variable picker) |
| `sea_surface_temperature` | Instant | **Celsius** | "The sea surface temperature close to the water surface" |
| `ocean_current_velocity` | Instant | km/h (mph, m/s, knots) | Eulerian + waves + tides |
| `ocean_current_direction` | Instant | ° | Direction the current is **heading to** (opposite convention from waves!) |
| `sea_level_height_msl` | Instant | metre | Tides + inverted barometer + …, datum = global mean sea level, "not suitable for coastal navigation" |
| `invert_barometer_height` | Instant | metre | Already included in `sea_level_height_msl` |

Caveats quoted from the page:
- "Tides and ocean currents are computed at 0.08° (~8 km) resolution using numerical models. Accuracy at coastal areas is limited. This is not suitable for coastal navigation and does not replace your nautical almanac. Use with caution!"
- "Secondary swell components are only available for some models. Tertiary components are only available for the GFS wave models."

## Daily variables
"Aggregations are a simple 24 hour aggregation from hourly values."
- `wave_height_max`, `wind_wave_height_max`, `swell_wave_height_max` (Meter/ft)
- `wave_direction_dominant`, `wind_wave_direction_dominant`, `swell_wave_direction_dominant` (°)
- `wave_period_max`, `wind_wave_period_max`, `swell_wave_period_max`, `wind_wave_peak_period_max`, `swell_wave_peak_period_max` (s)
- **No daily SST.** Aggregate hourly `sea_surface_temperature` yourself.

## Models (Data Sources table)
| Model | Region | Resolution | Time step | Length |
|---|---|---|---|---|
| MeteoFrance MFWAM | Global | 0.08° (~8 km) | 3-hourly | 10 days |
| MeteoFrance SMOC currents, tides | Global | 0.08° | Hourly | 10 days |
| MeteoFrance SST | Global | 0.08° | 6-hourly | 10 days |
| ECMWF WAM | Global | 9 km | Hourly | 15 days |
| ECMWF WAM 0.25 | Global | 0.25° | 3-hourly | 15 days |
| NCEP GFS Wave | Global | 0.25° | Hourly | 16 days |
| NCEP GFS Wave | 52.5°N–15°S | 0.16° (~16 km) | Hourly | 16 days |
| DWD EWAM | Europe | 0.05° | Hourly | 78 h |
| DWD GWAM | Global | 0.25° | Hourly | 174 h |
| ERA5-Ocean | Global | 0.5° | Hourly | reanalysis |

Default `best_match` picks per location. The page header says "Hourly wave forecasts at 5 km resolution" (that is EWAM, Europe only); for Florida expect ~8–16 km cells. SST is 6-hourly at source, so hourly SST values are interpolated (our fixture changes by 0.1 °C steps) **[UNVERIFIED: interpolation method]**.

## Real response (Miami Beach, captured 2026-11-23 via Firecrawl)
Request: `latitude=25.781&longitude=-80.110&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature&daily=wave_height_max&timezone=America/New_York&forecast_days=2&length_unit=imperial`
- Grid cell returned: 25.791664, −80.12499. The same cell came back for the land point −80.130 (checked separately), ≈1.3 km from 25.781, −80.130.
- `hourly_units`: `wave_height: "ft"`, `wave_period: "s"`, `wave_direction: "°"`, **`sea_surface_temperature: "°C"`** even with `length_unit=imperial`. Convert: °F = °C × 9/5 + 32 (25.5 °C → 77.9 °F).
- Wave heights 0.85–1.31 ft, periods 3.9–6.05 s: typical calm November day.
- `elevation: 0.0` on the full request; `5.0` on a daily-only request for the same point (cosmetic).
Fixture: `examples/01-openmeteo-client/fixtures/marine-miami-beach.json`.

## Live check, 2026-11-23 (pending)
One direct call to `marine-api.open-meteo.com` at 25.781, -80.110 was blocked by the sandbox proxy (`CONNECT tunnel failed, response 403`). **Pending live verification**; the grid-cell figures above come from the earlier Firecrawl capture. Nothing was invented to fill the gap.

## Beach Day notes
- Request: `wave_height, wave_period, wave_direction, swell_wave_height, swell_wave_period, swell_wave_direction, sea_surface_temperature` + daily `wave_height_max`, `length_unit=imperial`, explicit `forecast_days` ≤ 8. That is 7 hourly + 1 daily = 8 variables, so it stays at 1 call (the 10-variable threshold on the pricing page).
- Label every wave figure **"offshore waves"**; it is a model cell ~1–15 km out, not breaking surf.
- Each beach has a hand-picked `marine` point; test that the returned cell is within ~5 km (example 01 enforces `maxSnapKm = 5` and fails soft).
- Never show `sea_level_height_msl` as tides and never derive rip-current risk from waves or currents (ADR-0002) — link to NWS (https://www.weather.gov/beach/mfl) and NOAA Tides & Currents.
- Day values (docs/01 §5.2): water temp = mean of hourly SST (°F) over the best window; waves = max `wave_height` inside the best window. Daily `wave_height_max` covers 24 h including night, so don't headline it.
- Marine failure must not break the forecast: score without wave/SST factors and say "Waves unavailable".
