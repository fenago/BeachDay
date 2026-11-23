# 01 — Use case, data sources and the beach-day score

> Researched 2026-11-23 against the Open-Meteo docs, live API calls, NWS, Florida DEP/DOH, FWC and USF pages. Owner: `open-meteo-integrator` (with Wren for wording). **[UNVERIFIED]** = not confirmed in a primary source.

## 1. The use case

**Who:** people in (or visiting) South Florida deciding *whether* and *when* to go to the beach.
**Job to be done:** "Pick my beach → tell me if today, and the next few days, are good beach days — and *why* — in two seconds, on my phone, even with a weak signal on the sand."

Core screens (Wren designs, Sable styles):

1. **Beach picker** — list of ~13 beaches (§6), optional "nearest" via geolocation, favorites saved locally.
2. **Today** — big verdict (text + icon + color), best time window ("Best 9 am–1 pm"), the 3–4 reasons that drove it (e.g. "Storms likely after 2 pm", "UV 9 — very high"), key numbers (feels-like, wind, rain chance, waves, water temp, UV, sunset).
3. **Next days** — a day strip (up to 7 days; marine data is shorter) with each day's verdict and best window.
4. **Safety & conditions links** — rip-current risk, flags, water quality, red tide, sargassum (not in Open-Meteo; §5).
5. Footer: "Weather data by Open-Meteo.com" (licence requirement) and "Not a safety service — check posted flags and lifeguards."

Non-goals: surf forecasting for surfers, tide tables, navigation, hurricane tracking.

## 2. Open-Meteo Forecast API

Docs: https://open-meteo.com/en/docs

* `GET https://api.open-meteo.com/v1/forecast` — required `latitude`, `longitude`. Multiple locations via comma lists → response becomes a JSON **array**.
* Useful options: `timezone=America/New_York` (required if `daily` is used; DST changes inside the range are ignored — use `timeformat=unixtime` if that matters), `forecast_days` 0–16 (default 7), `temperature_unit=fahrenheit`, `wind_speed_unit=mph`, `precipitation_unit=inch`, `models` (leave `best_match`; NAM was discontinued 2026-11-01), `cell_selection` (`land` default).
* Errors: HTTP 400 `{"error":true,"reason":"…"}`.

**Variables Beach Day needs**

| Hourly | Unit (with our options) | Use |
|---|---|---|
| `temperature_2m`, `apparent_temperature` | °F | comfort |
| `relative_humidity_2m` | % | NWS heat index (computed) |
| `precipitation_probability` | % (chance of >0.1 mm in preceding hour; ensemble-based) | rain penalty |
| `precipitation` | inch | rain penalty |
| `weather_code` | WMO | thunderstorms (95, 96, 97, 99), showers (80–82), rain (61–65) |
| `cloud_cover` | % | sun |
| `wind_speed_10m`, `wind_gusts_10m`, `wind_direction_10m` | mph, ° | wind comfort; onshore/offshore |
| `uv_index` | index (preceding-hour mean) | UV warning |
| `cape` | J/kg | storm-risk support |
| `is_day` | 0/1 | beach window |

| Daily | Use |
|---|---|
| `sunrise`, `sunset`, `daylight_duration` | beach window |
| `uv_index_max`, `precipitation_probability_max`, `weather_code` (most severe of day), `temperature_2m_max`, `wind_gusts_10m_max` | day strip summary |

Verified live call (2026-11-23):

```
https://api.open-meteo.com/v1/forecast?latitude=25.79&longitude=-80.13
 &hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,cape,is_day
 &daily=sunrise,sunset,uv_index_max,precipitation_probability_max,weather_code
 &timezone=America/New_York&forecast_days=7&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch
```

Response shape: `latitude/longitude` (actual grid cell — can differ by a few km), `utc_offset_seconds`, `timezone`, `hourly{time[], <var>[]}`, `hourly_units`, `daily{…}`, `daily_units`. Note the mph unit string is `"mp/h"` and UV's unit is `""`.

## 3. Open-Meteo Marine API

Docs: https://open-meteo.com/en/docs/marine-weather-api

* `GET https://marine-api.open-meteo.com/v1/marine` — same lat/lon/timezone rules; `forecast_days` 0–**8** (docs disagree on default 5 vs 7 — always pass it); `length_unit=imperial` for feet; `cell_selection` default `sea`.
* Hourly: `wave_height`, `wave_period`, `wave_direction`, `wind_wave_height`, `swell_wave_height`, `swell_wave_period`, `sea_surface_temperature` (°C — **convert to °F yourself**; `temperature_unit` on marine **[UNVERIFIED]**), `ocean_current_velocity`, `sea_level_height_msl`.
* Daily: `wave_height_max`, `wave_direction_dominant`, `wave_period_max`, `swell_wave_height_max`. **No daily SST** — aggregate hourly.
* Models: MeteoFrance MFWAM (0.08°, ~8 km), ECMWF WAM (9 km), NCEP GFS Wave (0.25°/0.16°).
* **Caveats (quoted):** "Accuracy at coastal areas is limited. This is not suitable for coastal navigation…". `sea_level_height_msl` "may be completely unreliable" near coasts. → Present waves as **"offshore waves"**, not surf-zone break height; don't show tides (link to NOAA tides instead).
* **Grid snapping gotcha (tested):** Palm Beach (26.71, −80.03) and Jupiter (26.94, −80.07) snapped to lon −79.875, ~15 km offshore in the Gulf Stream, with warmer SST and bigger waves than near shore. → Store a **hand-picked marine sample point** per beach and assert in tests that the returned grid point is within ~5 km.

## 4. Terms, limits, attribution

* Free for **non-commercial** use (no subscriptions or ads; tip jars OK) under **10,000 calls/day, 5,000/hour, 600/minute, 300,000/month**. Calls are counted fractionally: >10 variables or >2 weeks for one location counts as more than one call (e.g. 15 variables ≈ 1.5 calls). [terms](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing)
* Rate limits are per IP; Open-Meteo warns that calls from hosts like **Netlify** can be limited early. → **Call Open-Meteo from the browser**, not from a function (matches the architecture decision).
* Be polite: cache in the service worker; refresh at most every 30–60 min; batch the forecast and marine calls per beach.
* **Licence: CC BY 4.0** — show `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>` next to the data. [licence](https://open-meteo.com/en/licence)
* Commercial plans if Beach Day ever adds ads/subscriptions: from $29/month (1M calls); free tier has no uptime guarantee.
* The API directory at https://mcp-api.netlify.app/ lists Open-Meteo as a free, no-key, browser-safe "top pick" — with "Beach-day predictor" as a suggested build idea.

## 5. Scoring a "beach day"

No authoritative public beach-score formula exists (commercial ones are proprietary; others are qualitative). We define our **own transparent heuristic**, anchored on official thresholds, and always show the reasons.

### 5.1 Official reference thresholds

| Factor | Threshold | Source |
|---|---|---|
| UV Index | 0–2 Low · 3–5 Moderate · 6–7 High · 8–10 Very High · 11+ Extreme | NOAA/NWS beach forecast service ([MapServer](https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/marine_beachforecast_summary/MapServer?f=pjson)); [EPA](https://www.epa.gov/sunsafety/uv-index-scale-1); [WHO](https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index) |
| Lightning | "When Thunder Roars, Go Indoors"; no safe place outside; wait **30 min** after last thunder | [NWS lightning](https://www.weather.gov/safety/lightning-safety-overview) |
| Wind | Beaufort 4 (13–18 mph) moderate; **5 (19–24)** fresh; **6 (25–31)** "umbrellas used with difficulty" | [NWS Miami Beaufort](https://www.weather.gov/mfl/beaufort) |
| Heat index | Caution 80–90 °F · Extreme caution 90–103 · Danger 103–124 · Extreme danger 125+ (full sun adds up to 15 °F) | [NWS heat](https://www.weather.gov/safety/heat-index), [chart PDF](https://www.weather.gov/media/unr/heatindex.pdf) (bands via search snippets **[UNVERIFIED]**) |
| Rip currents | Low / Moderate ("possible") / High ("likely… stay out of the water") | [NWS MFL beach](https://www.weather.gov/beach/mfl), [rip forecasts](https://www.weather.gov/safety/ripcurrent-forecasts) |
| Water quality | Enterococci per 100 mL: Good 0–35 · Moderate 36–70 · Poor ≥71; advisory if sample and resample >70 | [FL DOH Healthy Beaches](https://www.floridahealth.gov/community-environmental-public-health/environmental-public-health/water-quality/beach-water-quality/) |
| Red tide | K. brevis cells/L: background ≤1,000 · very low · low >10k · medium >100k · high >1M | [FWC](https://myfwc.com/research/redtide/statewide/) |
| Beach flags | Green low · Yellow medium · Red high · Double red water closed · Purple dangerous marine life (s. 380.276 F.S.) | [FL DEP flags](https://floridadep.gov/rcp/fcmp/content/beach-warning-flag-program) (meanings via county/press pages **[UNVERIFIED]** in DEP text) |

### 5.2 Beach Day heuristic (v1 — tune with real use)

**Beach window:** hours from max(sunrise + 1 h, 8 am) to min(sunset − 0.5 h, 7 pm), local time.

**Hard stops** (hour scored 0 and labelled with the reason):

* `weather_code` ∈ {95, 96, 97, 99} → "Thunderstorms" (also mark the following hour per the 30-minute rule).
* `wind_gusts_10m` ≥ 32 mph or `wind_speed_10m` ≥ 25 mph (Beaufort 6+) → "Too windy".
* Heat index ≥ 103 °F → "Dangerous heat".
* NWS rip risk **High** for the zone (if fetched, §5.4) → day capped at "Poor — rough surf, stay out of the water".

**Hourly score** = 100 minus penalties (floored at 0):

| Factor | Penalty |
|---|---|
| Rain chance (`precipitation_probability`) | 0 if ≤20 %; −10 at 21–40 %; −25 at 41–60 %; −40 above 60 %. Extra −15 if `precipitation` > 0.02 in |
| Showers code 80–82 / rain 61–65 | −15 / −25 |
| Storm risk (`cape` ≥ 1500 J/kg and rain chance ≥ 40 %) | −15, reason "Storms possible" |
| Clouds (`cloud_cover`) | 0 if ≤40 %; −5 at 41–70 %; −15 above 70 % |
| Feels-like (`apparent_temperature`) | 0 at 78–90 °F; −10 at 72–77 or 91–95; −25 at 65–71 or 96–102; −40 below 65 |
| Wind (sustained) | 0 if ≤12 mph; −10 at 13–18 (Beaufort 4); −25 at 19–24 (Beaufort 5) |
| Waves (offshore `wave_height`) | 0 if <2 ft; −10 at 2–3 ft; −20 at 3–5 ft; −35 above 5 ft |
| Water temp (SST) | 0 if ≥78 °F; −5 at 74–77; −15 at 70–73; −25 below 70 |
| UV | **No score penalty** (sunny is good); instead a reason/advice: ≥6 "UV high — sunscreen, shade 10 am–4 pm", ≥8 "very high", ≥11 "extreme" |

**Day verdict** = the best 3-hour window's average score:

| Score | Verdict | Icon | Color (never color alone) |
|---|---|---|---|
| 80–100 | **Great beach day** | sun | green |
| 65–79 | **Good** | sun + cloud | teal |
| 45–64 | **Fair — pick your hours** | cloud | amber (dark text) |
| 0–44 | **Skip it** | storm/flag | red |

Return the top reasons (largest penalties + hard stops + UV advice) and the best window. All thresholds live in one config file (`public/js/score-config.js`) so tuning is a one-line, reviewable change with tests (doc 06). Use the user's favorite beach and sensible defaults; later allow preferences (e.g. "I don't mind wind").

### 5.3 Confidence

Forecast skill drops with lead time: label days 4+ as "Outlook" and show their verdict with lower emphasis. Marine data may cover fewer days than weather — show "—" for waves/water temp where missing rather than guessing.

### 5.4 Things Open-Meteo can't tell us (link out)

| Hazard | What to do |
|---|---|
| **Rip currents, surf, NWS UV** | NWS Miami publishes machine-readable beach forecasts: `https://www.weather.gov/source/mfl/beachforecast/MFL_GIS_day1.json` / `day2.json` (GeoJSON, zones Miami Beach, Fort Lauderdale, Palm Beach, Naples/Marco; properties `rip`, `uv`, `surf`, `tstorm`, `wtemp`, `srfprod`, `productDate`). **CORS unverified** — if the browser can't fetch it, either link out or add a tiny cached proxy function (an exception to the "functions only for Claude/GitHub" decision — architect must decide). Key West beaches are NWS Key West: link to https://www.weather.gov/key/. Text product: https://forecast.weather.gov/product.php?site=mfl&product=srf&issuedby=mfl |
| **Beach flags** | Posted live by lifeguards; no API. Always say "Check posted flags." |
| **Water quality** | Link to FL DOH Healthy Beaches map (bi-weekly samples, 30 counties). |
| **Red tide** | Link to FWC status / daily map (https://gis.myfwc.com/redtidecurrentstatus/). As of 2026-11-20, not observed on the east coast. |
| **Sargassum** | Link to USF Sargassum Watch outlook (https://optics.marine.usf.edu/projects/saws.html); bulletins are regional, not per-beach. |
| **Tides** | Link to NOAA Tides & Currents (Open-Meteo sea level not reliable at the coast). |

## 6. Beach list (v1)

Coordinates are **approximate** (general knowledge, not surveyed); the `open-meteo-integrator` must verify each, and choose a separate marine point ~1–2 km offshore that the Marine API doesn't snap into the Gulf Stream.

| Beach | Lat | Lon | NWS zone |
|---|---|---|---|
| Miami Beach – South Beach (Lummus Park) | 25.781 | −80.130 | MFL Miami Beach Area |
| Key Biscayne – Crandon Park | 25.717 | −80.154 | MFL Miami Beach Area |
| Bill Baggs Cape Florida SP | 25.667 | −80.157 | MFL Miami Beach Area |
| Haulover Beach | 25.903 | −80.120 | MFL Miami Beach Area |
| Hollywood Beach (Broadwalk) | 26.011 | −80.117 | MFL Fort Lauderdale Area |
| Fort Lauderdale Beach (Las Olas) | 26.119 | −80.104 | MFL Fort Lauderdale Area |
| Deerfield Beach (pier) | 26.317 | −80.074 | MFL Fort Lauderdale Area (near boundary) |
| Boca Raton – Spanish River Park | 26.382 | −80.068 | MFL Palm Beach Area |
| Delray Beach (Atlantic Ave) | 26.461 | −80.059 | MFL Palm Beach Area |
| Palm Beach (Midtown) | 26.705 | −80.034 | MFL Palm Beach Area |
| Jupiter Beach Park | 26.943 | −80.070 | MFL Palm Beach Area |
| Key West – Smathers Beach | 24.551 | −81.771 | NWS Key West |
| Bahia Honda State Park | 24.656 | −81.280 | NWS Key West |

## 7. Fetch strategy

* One forecast call + one marine call per selected beach (or one batched call for all favorites using comma lists).
* Service worker: network-first with a 3–5 s timeout, fall back to cache, show "Updated 10:42 am" / "Offline — showing 8:15 am data".
* Re-fetch on open if data is older than 30 min; never poll in the background.
* Validate responses (arrays same length as `time`, units as expected) and fail soft ("Waves unavailable").
* Keep payloads small: request only the variables above (≈ 15 hourly variables ≈ 1.5 "calls" per request under Open-Meteo's counting).
