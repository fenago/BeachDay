---
name: beach-day-scoring
description: The Beach Day scoring model — beach window, hard stops, hourly penalties, day verdicts, reasons, the official thresholds behind them, and the hazards we link out to instead of scoring. Use when implementing, tuning, testing, wording or designing anything about verdicts.
---
# Beach-day scoring (v1 heuristic; source table in docs/01 §5)

## Always: the safety line goes with every verdict
Wherever a verdict appears (screen, list row, card, share text, notification), the same view shows
"Beach Day is not a safety service — check NWS rip-current risk and posted beach flags." with the NWS link.
Why: verdicts ignore rip currents and flags (ADR-0002), so a "Great" day can still be dangerous.

There is no authoritative public beach score. This model is **ours**, it is transparent, and it is anchored on official thresholds. All numbers live in `public/js/score-config.js`. Any change needs a boundary test and review by open-meteo-integrator and Wren.

## Beach window
Score only the hours from **max(sunrise + 1 h, 8 am)** to **min(sunset − 0.5 h, 7 pm)**, in local time. For today, only slots from the current hour on; none left → "beach window is over".

## Bands: half-open, lower bound inclusive
A value belongs to the band whose lower bound it meets or exceeds (wind 12.9 → `[0,13)`; 13 → `[13,19)`). Every band list starts at −∞ and is strictly ascending, so there are no gaps and no overlaps (Dr. Lee, 2026-11-23). Full rationale: docs/01 §5.2.

## Hard stops
A hard stop sets the hour's score to 0 and attaches the reason. Checked before penalties.

| Condition | Reason | Basis |
|---|---|---|
| `weather_code` ∈ {95, 96, 97, 99} | `thunderstorms` | NWS: "When thunder roars, go indoors"; wait 30 min |
| The hour after a thunder hour (and the first window hour if thunder was in the hour before the window) | `thunder_wait` | same 30-min rule; codes are hourly snapshots |
| Gusts ≥ 32 mph or wind ≥ 25 mph | `too_windy` | Beaufort 7 / 6 |
| NWS heat index ≥ 103 °F, computed from `temperature_2m` + RH (not apparent temperature); simple formula, Rothfusz only when the average with T is ≥ 80 °F | `dangerous_heat` | NWS Danger band (edges UNVERIFIED this session) |

A window containing any hard-stopped or unscorable hour is **not eligible**. A thunder hour outside the best window still gets the reason `storm_outside_window` (with the hour), first in the list.

## Penalties
Each hour starts at 100; penalties are subtracted; floor 0.

| Factor | Bands → penalty |
|---|---|
| Rain chance (integer %) | [0,21) 0 · [21,41) −10 · [41,61) −25 · [61,100] −40 |
| Precipitation | > 0.02 in → −15 (the one strict ">") |
| Rain codes | rain **61/63/65 only** −25 · showers 80–82 −15 · drizzle 51/53/55 −10 · unusual (56, 57, 66, 67, 71, 73, 75, 77, 85, 86) −25 `unusual_weather` · any other value: no penalty, never "clear" |
| Storm risk | CAPE ≥ 1500 J/kg and rain chance ≥ 40 → −15 `storm_risk` |
| Cloud cover | [0,41) 0 · [41,71) −5 · [71,100] −15 |
| Feels-like (°F) | <65 −40 · [65,72) −25 · [72,78) −10 · **[78,91) 0** · [91,96) −10 · [96,103) −25 · ≥103 −40 |
| Wind (mph) | [0,13) 0 · [13,19) −10 · [19,25) −25 · ≥25 hard stop |
| Offshore waves (ft) | [0,2) 0 · [2,3) −10 · [3,5) −20 · ≥5 −35 |
| Water temperature (°F) | <70 −25 · [70,74) −15 · [74,78) −5 · ≥78 0 |
| UV | **No penalty.** Advice from the highest UV in the best window, unrounded: [3,6) moderate (optional low-priority line) · [6,8) high · [8,11) very high · ≥11 extreme ("sunscreen, shade 10 am–4 pm") |
| Fog 45/48 | No penalty; advice `fog` |

**Stacking:** the rain family counts once: rain chance + the **larger** of (amount, code), capped at −60. All other factors add. No other cap.

**Preceding-hour fields:** for the slot starting at T, read `precipitation`, `precipitation_probability`, `wind_gusts_10m`, `uv_index` from row T+1 h; the rest from row T. Null optional factor → skipped; null core field (feels-like, wind, weather code, rain chance) → hour unscorable, never read as fine.

## Day verdict
The verdict comes from the average score of the **best 3-hour window** (earliest wins ties), **rounded to an integer first**, then banded (lower bound inclusive).

| Score | Text (final, Wren) | Icon | Color token |
|---|---|---|---|
| [80,100] | Great beach day | sun | `--verdict-great` |
| [65,80) | Good | sun-cloud | `--verdict-good` |
| [45,65) | Fair — pick your hours | cloud | `--verdict-fair` |
| [0,45) | Skip it | storm | `--verdict-skip` |

- **Short windows:** fewer than 3 usable hours → use what exists (1–2 h), reason `short_window`, verdict capped at Good, confidence −1. No usable hour → no verdict.
- No eligible window but hard stops present → "Skip it" with the stop reasons.

## Output and presentation
- **Wording (final):** every reason and advice code has fixed copy in docs/01 §5.2 "Reason and advice wording" and in `knowledge/ux-designer-apple-hig/examples/02-copy-deck/copy-deck.json`. Short window: label stays "Good" at most, with "Only {hours} beach hours left". Storm outside the best window: first reason, "Thunderstorms around {time}". Rain codes pick the phrase: 51/53/55 "Drizzle around", 61/63/65 "Rain in the forecast", 80-82 "Showers around". No usable hour: "No verdict yet. Some forecast data is missing." Never write "clear" for an unknown code.
- **Output:** `{ verdict, score, bestWindow: {start, end, hours}, reasons: [≤4 codes], advice: [...], confidence, seaTempMeanF }`. Reasons are codes; Wren owns the copy.
- **Word variants and placeholders:** one code, text variant picked by the same half-open band as the penalty: `rain_chance` [21,61) "{pct}% chance of rain", [61,100] "Rain likely, {pct}% chance"; `clouds` [41,71) "Partly cloudy", [71,100] "Mostly cloudy"; waves "Rough, waves {ft} ft offshore" from 5 ft. Over the best window: `{temp}`/`{mph}` mean, `{ft}` max, `{pct}` max rain chance, `{in}` total precipitation, `{time}` start of the first hour concerned, `{hours}` usable hours. `no_beach_window` → `status.after.hours`; `data_unavailable` → `status.no.verdict`.
- **Confidence:** `high | medium | low | outlook`. Start high; −1 for marine waves or SST missing in the window, −1 for a short window or unscorable hours; day index ≥ 3 (day 4+) is `outlook`, shown with less emphasis.
- **Missing marine data:** skip those factors and say so ("Waves unavailable"). Don't guess. Day water temp = mean of hourly SST over the best window; day waves = max inside the best window, labelled "offshore waves".

## Not scored — always link out (ADR-0002)
| Hazard | Link out to |
|---|---|
| Rip currents | NWS: Miami-area beaches → https://www.weather.gov/beach/mfl, Key West → https://www.weather.gov/key/ |
| Beach flags | Lifeguards only; no API. Text: "Check posted flags." |
| Water quality | FL DOH Healthy Beaches (Enterococci: Good 0–35, Moderate 36–70, Poor ≥71) |
| Red tide | FWC status map |
| Sargassum | USF Sargassum Watch |
| Tides | NOAA Tides & Currents |


## Testing
- Pure functions `scoreHour` and `scoreDay`.
- Boundary tests on both sides of every edge, for example UV 5.9/6.0, wind 12.9/13, code 94/95, feels-like 77.9/78 and 90.9/91, waves 2.9/3.0/5.0. The full list is docs/01 §5.6; a reference implementation with 65 passing tests is `knowledge/open-meteo-integrator/examples/04-score-config/`.
- Snapshot the reasons for each fixture.
