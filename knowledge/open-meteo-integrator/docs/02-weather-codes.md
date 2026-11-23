# WMO weather interpretation codes (`weather_code`)
Source: https://open-meteo.com/en/docs (section "WMO Weather interpretation codes (WW)")
Retrieved: 2026-11-23

`weather_code` is returned hourly (instant) and daily ("the most severe weather condition on a given day"). Unit string in responses: `"wmo code"` (observed in our fixture).

## Full table (as published)
| Code | Description |
|---|---|
| 0 | Clear sky |
| 1 | Mainly clear |
| 2 | Partly cloudy |
| 3 | Overcast |
| 45 | Fog |
| 48 | Depositing rime fog |
| 51 | Light drizzle |
| 53 | Moderate drizzle |
| 55 | Dense drizzle |
| 56 | Light freezing drizzle |
| 57 | Dense freezing drizzle |
| 61 | Slight rain |
| 63 | Moderate rain |
| 65 | Heavy rain |
| 66 | Light freezing rain |
| 67 | Heavy freezing rain |
| 71 | Slight snowfall |
| 73 | Moderate snowfall |
| 75 | Heavy snowfall |
| 77 | Snow grains |
| 80 | Slight rain showers |
| 81 | Moderate rain showers |
| 82 | Violent rain showers |
| 85 | Slight snow showers |
| 86 | Heavy snow showers |
| 95 | Thunderstorm |
| 96 | Thunderstorm with slight hail * |
| 97 | Heavy thunderstorm |
| 99 | Thunderstorm with heavy hail * |

Footnote, quoted: "(*) Codes 96 and 99 are only reported by models with an explicit hail forecast, such as DWD ICON or UKMO. All other models derive thunderstorms from instability parameters and report codes 95 and 97."

Note the table is **sparse**: there is no 4, 10–44, 46, etc. Any other integer is unexpected input — treat it as unknown (no code penalty, no "clear" claim).

## Groups Beach Day uses
| Group | Codes | Scoring use (beach-day-scoring skill) |
|---|---|---|
| Thunderstorm (hard stop) | 95, 96, 97, 99 | Hour = 0, also blocks the next hour |
| Rain showers | 80, 81, 82 | −15 |
| Rain | 61, 63, 65 only (the table has no 62 or 64) | −25 |
| Drizzle | 51, 53, 55 | **−10 (decided 2026-11-23)**: chance is "more than 0.1 mm", so drizzle can read 0 % and 0 in while the code says it is wet |
| Fog | 45, 48 | not penalised; advice line only |
| Clear → overcast | 0–3 | cloud handled via `cloud_cover` |
| Freezing / snow | 56, 57, 66, 67, 71–77, 85, 86 | Should never appear in South Florida; −25 with reason `unusual_weather`, and log |

Since the models used for Florida under `best_match` are mostly US/ECMWF, expect 95/97 for storms more often than 96/99 (per the footnote). Test both anyway.

## Code shape
```js
export const WMO = Object.freeze({
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snowfall', 73: 'Moderate snowfall', 75: 'Heavy snowfall', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 97: 'Heavy thunderstorm',
  99: 'Thunderstorm with heavy hail',
});
export const isThunder = (c) => c === 95 || c === 96 || c === 97 || c === 99;
export const describe = (c) => WMO[c] ?? 'Unknown conditions';
```

## Observed in the 2026-11-23 Miami Beach fixture
Hourly codes seen: 0, 1, 2, 3, 51, 53. Daily: `[3, 53]` — day 2's daily code is 53 (moderate drizzle) because the daily value is the most severe hour (hour 19:00 on 11-24 had 53), even though most hours were 3. Lesson: **don't headline a day from the daily code**; derive the verdict from hourly scores inside the beach window.

## Beach Day notes
- Thunder boundary tests: 94 → not a stop (and also not a valid code), 95 → stop, 96/97/99 → stop.
- Show the text description beside any icon (verdicts never colour- or icon-only; accessibility rule in CLAUDE.md).
- Thunderstorm text must include the NWS-style advice already defined in the scoring skill; still link to NWS for rip currents (ADR-0002).
