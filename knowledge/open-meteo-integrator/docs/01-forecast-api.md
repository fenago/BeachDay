# Forecast API: endpoint, parameters, variables Beach Day uses
Source: https://open-meteo.com/en/docs
Retrieved: 2026-11-23

## Endpoint
`GET https://api.open-meteo.com/v1/forecast` — keyless for non-commercial use. Commercial (`apikey`) access uses a `customer-` prefixed host instead (see 06-terms-limits-attribution.md).
Source: https://open-meteo.com/en/docs (parameter `apikey`: "The server URL requires the prefix customer-").

## URL parameters (only the ones that matter to us)
| Parameter | Format / range | Default | Notes |
|---|---|---|---|
| `latitude`, `longitude` | float, WGS84 | required | Comma-separated lists allowed → response becomes a JSON **array** (see 05). Americas use **negative** longitudes. |
| `elevation` | float | 90 m DEM | Used for statistical downscaling. `&elevation=nan` disables downscaling. |
| `hourly` | string array | – | Comma-separated, or repeat `&hourly=`. |
| `daily` | string array | – | "If daily weather variables are specified, parameter timezone is required." |
| `current` | string array | – | Current conditions (15-minutely based). Not used by Beach Day v1. |
| `temperature_unit` | `celsius` \| `fahrenheit` | `celsius` | Converts **all** temperature values. |
| `wind_speed_unit` | `kmh` \| `ms` \| `mph` \| `kn` | `kmh` | |
| `precipitation_unit` | `mm` \| `inch` | `mm` | |
| `timeformat` | `iso8601` \| `unixtime` | `iso8601` | See 03-time-zones-and-dst.md. |
| `timezone` | IANA name or `auto` | `GMT` | Offset fixed at request time; DST inside range ignored. |
| `past_days` | 0–92 | 0 | |
| `forecast_days` | 0–16 | 7 | "Up to 16 days of forecast are possible." |
| `forecast_hours`, `past_hours` | int > 0 | – | Counted from the current hour instead of today 00:00. |
| `start_date`, `end_date` | `yyyy-mm-dd` | – | |
| `start_hour`, `end_hour` | `yyyy-mm-ddThh:mm` | – | |
| `models` | string array | `auto` | "Per default, the best suitable weather models will be combined." Leave it alone. |
| `cell_selection` | `land` \| `sea` \| `nearest` | `land` | `land` picks a land cell of similar elevation. |

The page also promises API stability: "Additional optional URL parameters will be added. For API stability, no required parameters will be added in the future!"

Hourly data: "Time always starts at 0:00 today and contains 168 hours" (that is the 7-day default; with `forecast_days=2` we got 48 rows).

## Hourly variables used by Beach Day
"Valid time" matters: some values are instantaneous, others describe the **preceding hour**.

| Variable | Valid time | Unit (our unit params) | Official description (short) |
|---|---|---|---|
| `temperature_2m` | Instant | °C (°F) | Air temperature at 2 m above ground |
| `apparent_temperature` | Instant | °C (°F) | Feels-like, "combining wind chill factor, relative humidity and solar radiation" |
| `relative_humidity_2m` | Instant | % | Relative humidity at 2 m |
| `precipitation_probability` | Preceding hour probability | % | "Probability of precipitation with more than 0.1 mm of the preceding hour", from ensemble models at 0.25° (~27 km), 30 members |
| `precipitation` | Preceding hour sum | mm (inch) | Rain + showers + snow, sum of the preceding hour |
| `weather_code` | Instant | WMO code | See 02-weather-codes.md |
| `cloud_cover` | Instant | % | Total cloud cover as area fraction |
| `wind_speed_10m` | Instant | km/h (mph, m/s, knots) | "Wind speed on 10 meters is the standard level." |
| `wind_gusts_10m` | Preceding hour max | km/h (mph, m/s, knots) | Max gust of the preceding hour |
| `wind_direction_10m` | Instant | ° | Direction wind comes from (meteorological convention) **[UNVERIFIED: the page does not state from/to for wind; "from" is the standard convention]** |
| `uv_index` | Preceding hour mean | Index | "UV index starting from 0 as average of the preceding hour." `uv_index_clear_sky` assumes no clouds |
| `cape` | Instant | J/kg | Convective available potential energy |
| `is_day` | Instant | Dimensionless | "1 if the current time step has daylight, 0 at night." |

Consequence of "preceding hour": the 13:00 row's `precipitation`, `uv_index` and `wind_gusts_10m` describe 12:00–13:00. When scoring the hour slot 13:00–14:00, the strictly correct row is 14:00 for those fields. **Decided 2026-11-23 (docs/01 §5.2): scoring corrects the skew.** For the slot starting at T, `precipitation`, `precipitation_probability`, `wind_gusts_10m` and `uv_index` are read from row T+1 h; instant fields stay on row T. Example 01's normalizer does not apply the shift yet.

## Daily variables used by Beach Day
| Variable | Unit | Notes |
|---|---|---|
| `sunrise`, `sunset` | iso8601 | Local strings like `2026-11-23T06:44` (no offset suffix) |
| `uv_index_max` | Index | Daily max UV; `uv_index_clear_sky_max` = cloud-free |
| `precipitation_probability_max` | % | Also `_mean`, `_min` |
| `weather_code` | WMO code | "The most severe weather condition on a given day" |
| `daylight_duration` | seconds | Optional |
| `sunshine_duration` | seconds | DNI > 120 W/m² (WMO definition); always less than daylight |
| `wind_speed_10m_max`, `wind_gusts_10m_max` | wind unit | Optional |

## Canonical Beach Day request
```
https://api.open-meteo.com/v1/forecast?latitude=25.781&longitude=-80.130
&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,cape,is_day
&daily=sunrise,sunset,uv_index_max,precipitation_probability_max,weather_code
&timezone=America/New_York&forecast_days=7
&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch
```
Real response (`forecast_days=2`) captured 2026-11-23 via Firecrawl: `examples/01-openmeteo-client/fixtures/forecast-miami-beach.json`. Observed facts from it:
- `hourly_units.wind_speed_10m` is `"mp/h"` (not `"mph"`), `uv_index` and `is_day` units are `""`, `weather_code` unit is `"wmo code"`, `precipitation` is `"inch"`.
- Requested 25.781, −80.130 → grid cell 25.814812, −80.12985 (≈3.8 km away). The docs: the coordinate "might be a few kilometres away from the requested coordinate."
- `timezone_abbreviation` came back as `"GMT-5"`, not `"EST"`. Don't display it; format times yourself.
- `elevation: 5.0`.

## Variable count and cost
13 hourly + 5 daily = 18 variables. Pricing: requests with "more than 10 weather variables" count as multiple calls, fractionally (15 vars ≈ 1.5 calls). So one Beach Day forecast request ≈ 1.8 calls **[UNVERIFIED: whether daily variables count toward the 10 the same way hourly ones do]**. Source: https://open-meteo.com/en/pricing

## Beach Day notes
- Build this URL in `public/js/api/openmeteo.js` only; the example in `examples/01-openmeteo-client/openmeteo.mjs` is the reference shape.
- Always send `timezone=America/New_York` (all beaches are in one zone) and the three unit params so no conversion code is needed for weather fields.
- Browser calls only (ADR-0001): no Netlify Function may proxy this endpoint.
- Do not set `models`; keep `best_match`/auto.
- Batch: one request per beach with all variables, never one per variable.
