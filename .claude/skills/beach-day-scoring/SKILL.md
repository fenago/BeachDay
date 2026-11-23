---
name: beach-day-scoring
description: The Beach Day scoring model — beach window, hard stops, hourly penalties, day verdicts, reasons, the official thresholds behind them, and the hazards we link out to instead of scoring. Use when implementing, tuning, testing, wording or designing anything about verdicts.
---
# Beach-day scoring (v1 heuristic; source table in docs/01 §5)

There is no authoritative public beach score. This model is **ours**, it is transparent, and it is anchored on official thresholds. All numbers live in `public/js/score-config.js`. Any change needs a boundary test and review by open-meteo-integrator and Wren.

## Beach window
Score only the hours from **max(sunrise + 1 h, 8 am)** to **min(sunset − 0.5 h, 7 pm)**, in local time.

## Hard stops
A hard stop sets the hour's score to 0 and attaches the reason.

| Condition | Reason | Basis |
|---|---|---|
| `weather_code` ∈ {95, 96, 97, 99} (also blocks the next hour) | "Thunderstorms" | NWS: "When thunder roars, go indoors"; wait 30 min |
| Gusts ≥ 32 mph or wind ≥ 25 mph | "Too windy" | Beaufort 6+ |
| Heat index ≥ 103 °F (NWS Rothfusz, from temp + RH) | "Dangerous heat" | NWS Danger band |

## Penalties
Each hour starts at 100 and penalties are subtracted, with a floor of 0.

| Factor | Penalty |
|---|---|
| Rain chance | ≤20% → 0; 21–40% → −10; 41–60% → −25; >60% → −40 |
| Precipitation | >0.02 in → −15 extra |
| Rain codes | Showers (80–82) → −15; rain (61–65) → −25 |
| Storm risk | CAPE ≥ 1500 J/kg and rain chance ≥ 40% → −15 ("Storms possible") |
| Cloud cover | ≤40% → 0; 41–70% → −5; >70% → −15 |
| Feels-like temperature | 78–90 °F → 0; 72–77 or 91–95 → −10; 65–71 or 96–102 → −25; <65 → −40 |
| Wind | ≤12 mph → 0; 13–18 → −10; 19–24 → −25 |
| Offshore waves | <2 ft → 0; 2–3 → −10; 3–5 → −20; >5 → −35 |
| Water temperature | ≥78 °F → 0; 74–77 → −5; 70–73 → −15; <70 → −25 |
| UV | **No penalty.** Advice only: ≥6 high, ≥8 very high, ≥11 extreme ("sunscreen, shade 10 am–4 pm") |

## Day verdict
The verdict comes from the average score of the **best 3-hour window**.

| Score | Text | Icon | Color token |
|---|---|---|---|
| 80–100 | Great beach day | sun | `--verdict-great` |
| 65–79 | Good | sun-cloud | `--verdict-good` |
| 45–64 | Fair — pick your hours | cloud | `--verdict-fair` |
| 0–44 | Skip it | storm | `--verdict-skip` |

## Output and presentation
- **Output:** `{ verdict, score, bestWindow: {start, end}, reasons: [...top 3-4], advice: [...], confidence }`
- **Outlook days:** days 4 and later are `confidence: "outlook"`, shown with less emphasis.
- **Missing marine data:** skip those factors and say so. Don't guess.

## Not scored — always link out (ADR-0002)
| Hazard | Link out to |
|---|---|
| Rip currents | NWS: Miami-area beaches → https://www.weather.gov/beach/mfl, Key West → https://www.weather.gov/key/ |
| Beach flags | Lifeguards only; no API. Text: "Check posted flags." |
| Water quality | FL DOH Healthy Beaches (Enterococci: Good 0–35, Moderate 36–70, Poor ≥71) |
| Red tide | FWC status map |
| Sargassum | USF Sargassum Watch |
| Tides | NOAA Tides & Currents |

Every verdict screen includes: "Beach Day is not a safety service — check NWS rip-current risk and posted beach flags."

## Testing
- Pure functions `scoreHour` and `scoreDay`.
- Boundary tests at every threshold, for example UV 5.9/6.0, wind 12/13, code 94/95.
- Snapshot the reasons for each fixture.
