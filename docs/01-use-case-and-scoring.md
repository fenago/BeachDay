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
| `weather_code` | WMO | thunderstorms (95, 96, 97, 99), showers (80–82), rain (61, 63, 65 only), drizzle (51, 53, 55) |
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
* **Live check 2026-11-23 (25.781, -80.110): pending live verification.** The sandbox blocked `marine-api.open-meteo.com` (CONNECT tunnel 403), so the marine point is unchecked this round. The earlier Firecrawl capture of the same point returned grid cell 25.7917, -80.1250 (about 1.3 km from the land point).
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

### 5.2 Beach Day heuristic (v1, tune with real use)

Decided 2026-11-23 (Dr. Lee: half-open bands; Dewey: the rest, rationale below; **wording is Wren's**, so reasons are specified as codes). All numbers live in `public/js/score-config.js` (§5.5). Reference implementation with 65 passing tests: `knowledge/open-meteo-integrator/examples/04-score-config/`.

**Band rule (all factors):** every band is **half-open and lower-bound inclusive**: a value belongs to the band whose lower bound it meets or exceeds, e.g. wind 12.9 is in `[0,13)`, 13.0 is in `[13,19)`. Bands start at minus infinity and are checked for gaps in a test, so nothing can fall between bands. This closes the old gaps (feels-like 77.1-77.9 and above 90, wind 12.1-12.9, water 77.1-77.9) and the old overlap (waves 3.0).

**Beach window:** hours from max(sunrise + 1 h, 8 am) to min(sunset - 0.5 h, 7 pm), local time. An hour slot belongs to the window if its start is inside it. For **today**, only slots from the current hour onward count; if fewer than 3 remain, the short-window rule below applies, and if none remain the screen says the beach window is over and points to tomorrow.

**Hard stops** (hour scored 0, reason attached; checked before penalties):

| Condition | Reason code | Basis |
|---|---|---|
| `weather_code` in {95, 96, 97, 99} | `thunderstorms` | NWS lightning safety: no safe place outside; wait 30 min after the last thunder |
| the hour **after** a thunder hour (and the first window hour if thunder was in the hour just before the window) | `thunder_wait` | same 30-minute rule. Weather codes are hourly snapshots, so one full hour is the conservative reading |
| gust >= 32 mph or wind >= 25 mph | `too_windy` | Beaufort 7 / 6 (NWS Miami Beaufort page) |
| NWS heat index >= 103 degF | `dangerous_heat` | NWS "Danger" band starts at 103 (**band edges UNVERIFIED**, NWS pages were blocked in the 2026-11-23 session) |

Decisions:
* **Thunder is a score of 0 for the hour, not just a reason line.** Rationale: a 0 makes the hour unusable for any window, and the average of a window containing it can never hide it.
* **A window that contains any hard-stopped or unscorable hour is not eligible** to be the best window. If no eligible window exists the verdict is "Skip it" with the stop reasons, no best window.
* **Storm hour outside the best window gets its own reason**, `storm_outside_window` with the hour (for example "thunderstorms around 3 pm"), placed first in the reasons. A Great morning must not hide an afternoon storm.
* **Heat-index inputs:** computed from **air temperature (`temperature_2m`) and relative humidity**, not from `apparent_temperature`, because the NWS regression is defined on air temperature and humidity. Procedure (NWS WPC, **UNVERIFIED this session**): simple formula first; if its average with T is below 80 degF use it, otherwise use the Rothfusz regression with the two NWS adjustments (RH < 13 % at 80-112 degF; RH > 85 % at 80-87 degF). Full-sun exposure (up to +15 degF per NWS) is **not** added: `apparent_temperature` already includes solar radiation and is penalised below, and exposure is advice, not a hard stop.
* **Feels-like >= 103 degF** (from `apparent_temperature`) is the top penalty band (-40); it is a penalty, not a stop, because the stop uses the NWS definition.

**Hourly score** = 100 minus penalties, floored at 0. UV never reduces the score.

| Factor | Bands (lower bound inclusive) -> penalty |
|---|---|
| Rain chance (`precipitation_probability`, integer %) | [0,21) 0 / [21,41) -10 / [41,61) -25 / [61,100] -40 |
| Rain amount (`precipitation`) | > 0.02 in -> -15 (the one strict ">": a single trigger on data given to 0.01 in, not a band; **rounding of inch values UNVERIFIED**) |
| Rain codes | rain 61/63/65 -25 / showers 80-82 -15 / **drizzle 51/53/55 -10 (new)** / unusual 56, 57, 66, 67, 71, 73, 75, 77, 85, 86 -25 (`unusual_weather`). Any other value (62, 64, 94, ...) is not a published code: no code penalty, never treated as clear sky |
| Storm risk | `cape` >= 1500 J/kg **and** rain chance >= 40 -> -15 (`storm_risk`) |
| Clouds (`cloud_cover`) | [0,41) 0 / [41,71) -5 / [71,100] -15 |
| Feels-like (`apparent_temperature`, degF) | < 65 -40 / [65,72) -25 / [72,78) -10 / **[78,91) 0** / [91,96) -10 / [96,103) -25 / >= 103 -40 |
| Wind (sustained, mph) | [0,13) 0 / [13,19) -10 / [19,25) -25 / >= 25 hard stop |
| Offshore waves (`wave_height`, ft) | [0,2) 0 / [2,3) -10 / [3,5) -20 / >= 5 -35 |
| Water temp (SST converted to degF) | < 70 -25 / [70,74) -15 / [74,78) -5 / >= 78 0 |
| UV | no penalty. Advice by the highest UV in the best window: [3,6) "UV n, moderate" (optional low-priority line, **decided: show it, as advice only, not in the reasons list**), [6,8) high, [8,11) very high, >= 11 extreme. Values are used unrounded (5.9 moderate, 6.0 high). |
| Fog 45/48 | no penalty (rare in South Florida by 8 am, clears quickly); advice line `fog` "reduced visibility" |

Stacking decisions:
* **Rain family is counted once.** Rain chance (how likely) plus the **larger** of rain amount and rain code (how wet; both describe the same observed wetness, so adding them double counts), with the whole family **capped at -60**. Storm risk, clouds, feels-like, wind, waves and water temperature are independent factors and add normally. No other global cap: the floor of 0 and the hard stops already bound the score.
* **Why drizzle is penalised (reverses the v1 note):** Open-Meteo's chance is "more than 0.1 mm in the preceding hour", and drizzle is often less than that, so chance and amount can both read 0 while the code says it is drizzling (the 2026-11-23 fixture has code 53 with a Great-looking forecast). A beach-goer calls that a wet hour.
* **Cloud + rain** correlate; both stay because clouds also cost sun on a dry day.

**Fields that describe the preceding hour:** `precipitation`, `precipitation_probability`, `wind_gusts_10m` and `uv_index` at row T describe T-1h to T. **Decision: for the hour slot starting at T, read these four from row T+1h** (the normalizer does the shift; instant fields `weather_code`, `cloud_cover`, `wind_speed_10m`, `apparent_temperature`, `cape`, marine values stay on row T). Rationale: it costs one index offset, the last row needed (19:00) always exists, and it removes the 1-hour skew that matters most for gusts and rain at the window edges. If row T+1h is null, that factor is skipped (not guessed).

**Day verdict** = the **best 3-hour window**: the consecutive 3 eligible hours with the highest average; ties go to the earliest.

* The window average is **rounded to a whole number first** and the verdict bands are applied to that integer, so the number on screen and the verdict always agree.
* **Windows shorter than 3 hours** (late today, or hours dropped for missing data): use the longest run that exists (1-2 hours), add reason `short_window`, **cap the verdict at "Good"** (a 1-2 hour sample never earns "Great") and lower confidence one level. With no usable hour there is no verdict: "no beach hours" (window over) or "data unavailable".

Verdict text is final (Wren, 2026-11-23): the label is the accessible name of the chip, the icon is decorative (`aria-hidden`), and the color is never the only signal. A short window (see above) caps the label at "Good" and always shows the `short_window` reason next to it.

| Score (rounded, lower bound inclusive) | Verdict | Icon | Color (never color alone) |
|---|---|---|---|
| [80,100] | **Great beach day** | sun | green |
| [65,80) | **Good** | sun + cloud | teal |
| [45,65) | **Fair — pick your hours** | cloud | amber (dark text) |
| [0,45) | **Skip it** | storm/flag | red |

**Output:** `{ verdict, score, bestWindow: {start, end, hours}, reasons: [up to 4 {code, ...}], advice: [{code, ...}], confidence, seaTempMeanF }`. Reasons are **codes** (Wren owns the copy): `storm_outside_window`, `short_window`, `thunderstorms`, `thunder_wait`, `too_windy`, `dangerous_heat`, then penalty factors by mean penalty over the best window (`rain_chance`, `rain_code`, `rain_amount`, `unusual_weather`, `storm_risk`, `clouds`, `feels_like`, `wind`, `waves`, `water_temp`). Advice codes: `uv_moderate|uv_high|uv_very_high|uv_extreme`, `fog`, `marine_missing`, `marine_partial`. The NWS rip-current/flags line is **not** a reason: it is always shown with every verdict (ADR-0002).

**Reason and advice wording (final, Wren, 2026-11-23).** One short phrase per code, sentence case, no "we", numbers with units. `{…}` is filled at runtime. The machine-checked deck (length, reading ease, banned words) is `knowledge/ux-designer-apple-hig/examples/02-copy-deck/copy-deck.json`; Dewey reviews any change to this table.

| Code | Text | Notes |
|---|---|---|
| `storm_outside_window` | Thunderstorms around {time} | always first; `{time}` like "3 pm" |
| `thunderstorms` | Thunderstorms | hard stop |
| `thunder_wait` | Waiting out thunder | hard stop; pairs with advice "Thunder means go indoors. Wait 30 minutes after it stops." |
| `too_windy` | Too windy | hard stop |
| `dangerous_heat` | Dangerous heat | hard stop |
| `short_window` | Only {hours} usable beach hours · Only 1 usable beach hour | ids `reason.short`, `reason.short.one` (1 hour); shown with a verdict capped at Good. Not "left": it also appears on future days |
| `unusual_weather` | Unusual weather | codes 56, 57, 66, 67, 71-77, 85, 86 |
| `storm_risk` | Storms possible | variant "Storms possible after {time}" if the first risky hour is known |
| `rain_chance` | {pct}% chance of rain · Rain likely, {pct}% chance | same bands as the penalty: [21,61) first text, [61,100] second (deck `reason.rain.chance`, `reason.rain`). One code; the text variant is picked by the band, like `rain_code` |
| `rain_code` | Rain in the forecast (61/63/65), Showers around (80-82), Drizzle around (51/53/55) | picked by the weather code |
| `rain_amount` | About {in} in of rain | only if it is the larger of amount and code (it is the one counted) |
| `clouds` | Partly cloudy · Mostly cloudy | [41,71) "Partly cloudy" (`reason.cloudy.part`), [71,100] "Mostly cloudy" (`reason.cloudy`); same bands as the penalty. One code, variant picked by the band, so no new code and no change to score.mjs |
| `feels_like` | Hot, feels like {temp} °F · Cool, feels like {temp} °F · Feels like {temp} °F | `reason.hot` from 91, `reason.cool` below 72, otherwise `reason.feels` (neutral, [72,91)). Variant chosen from the UNROUNDED window mean; the number shown is rounded. "Sunny" is no longer a penalty text (see the D3 codes below) |
| `wind` | Light wind, {mph} mph · Breezy, {mph} mph | breezy from 13 mph |
| `waves` | Offshore waves under 2 ft · Choppy, waves {ft} ft offshore · Rough, waves {ft} ft offshore | choppy for [2,5) ft; rough from 5 ft |
| `water_temp` | Warm water, {temp} °F · Water {temp} °F, a bit cool · Cool water, {temp} °F | `reason.water.warm` from 78 °F, `reason.water.cool` below 74 °F, neutral `reason.water` for [74,78) (it carries a penalty of -5, so "a bit cool"). Chosen from the UNROUNDED mean: a 77.6 mean reads "Water 78 °F, a bit cool", never "Warm water, 78" |

| Advice code | Text |
|---|---|
| `uv_moderate` | UV {n}, moderate. Sunscreen helps. (low priority, shown after other advice) |
| `uv_high` | UV high. Wear sunscreen. |
| `uv_very_high` | UV very high. Use sunscreen. Seek shade 10 am to 4 pm. |
| `uv_extreme` | UV extreme. Use sunscreen. Seek shade 10 am to 4 pm. |
| `lightning` | Thunder means go indoors. Wait 30 minutes after it stops. | emitted whenever the scored hours of the day contain a `thunderstorms` or `thunder_wait` hour (inside or outside the best window); shown first |
| `fog` |
| `marine_missing` | No wave or water data for this day. (and the two lines "Waves unavailable", "Water temperature unavailable" replace the numbers) |
| `marine_partial` | Some wave or water data is missing. |

**Positive reasons (D3, off by default: `SCORE_CONFIG.reasons.positiveOnGoodDays`).** When on, Great and Good days also list what is going well, after the driver reasons and inside the 4-item cap. A code is emitted only when its data is present and its factor has no penalty in any best-window hour.

| Code | Text (copy id) | Condition |
|---|---|---|
| `dry` | Low chance of rain (`reason.pos.dry`) | no rain-family, storm-risk or unusual-weather penalty |
| `sunny_sky` | Mostly sunny (`reason.pos.sunny`) | no cloud penalty (cloud cover < 41 %) |
| `comfortable` | Comfortable, feels like {temp} °F (`reason.pos.comfortable`) | feels-like in [78,91) |
| `light_wind` | Light wind, {mph} mph (`reason.pos.wind`) | wind < 13 mph |
| `calm_waves` | Calm, waves under 2 ft offshore (`reason.pos.waves`) | wave data present, < 2 ft |
| `warm_water` | Warm water, {temp} °F (`reason.pos.water`) | water data present, mean >= 78 °F |

The older ids `reason.sunny`, `reason.wind.light`, `reason.waves.calm` are no longer emitted.

**Placeholders (all over the best window):** `{temp}`, `{mph}` = mean; `{ft}` = max; `{pct}` = max rain chance, integer %; `{in}` = total precipitation, two decimals; `{time}` = start of the first hour concerned, local; `{hours}` = count of usable hours (`bestWindow.hours`). Word variants (Sunny/Hot/Cool, Breezy, Choppy/Rough, Warm/Cool water, Partly/Mostly cloudy) are chosen from the same window value that fills the placeholder, using the band edges above. Status codes: `no_beach_window` → deck `status.after.hours`; `data_unavailable` → `status.no.verdict`.

Other states: window over → "Beach hours are over for today. Here is tomorrow."; no usable hour → "No verdict yet. Some forecast data is missing." Confidence: `high` shows nothing; `medium` shows "Fairly sure." (the reason line says why); `low` shows "Less sure. Check again later."; `outlook` shows the tag "Outlook" and "Outlook. Less certain this far out." The NWS safety line is fixed text on every verdict, never in the reasons list: "Beach Day is not a safety service — check NWS rip-current risk and posted beach flags."

**Water temperature per day** = the **mean of the hourly SST (degF) over the best window** (Open-Meteo has no daily SST). **Waves per day** = the max `wave_height` inside the best window, labelled "offshore waves" (the optional daily `wave_height_max` covers 24 h including night, so do not headline it).

Data caveats: Open-Meteo hourly values can be null; a null optional factor is skipped, and a null core field (`apparent_temperature`, `wind_speed_10m`, `weather_code`, `precipitation_probability`) makes that hour unscorable and it is left out (never read as fine).

### 5.3 Confidence

`confidence` is one of `"high" | "medium" | "low" | "outlook"`:

* **`outlook`**: day index 3 and later (day 4+, 0-based `dayIndex >= 3`). Shown with less emphasis; overrides the rest of this list.
* Start at **high**. Lower by one level for each of: (a) waves **or** water temperature missing for any best-window hour (advice `marine_partial`; both missing entirely is `marine_missing`: score without them and say so, never guess); (b) best window shorter than 3 hours or some window hours unscorable. Floor: `low`.
* **Marine day coverage:** the Marine request asks for 7 days (max 8); each day's marine coverage is counted from the non-null hours in its best window, not assumed from the request. A day with no marine data scores on the forecast factors only and shows "Waves unavailable" and "Water temperature unavailable" instead of numbers.
* The verdict is **never** hidden because confidence is low; the label and advice carry it.

### 5.4 Things Open-Meteo can't tell us (link out)

| Hazard | What to do |
|---|---|
| **Rip currents, surf, NWS UV** | **Decided (ADR-0002): link out, no proxy.** Link each beach to its NWS office: Miami-area beaches → https://www.weather.gov/beach/mfl and the Surf Zone Forecast https://forecast.weather.gov/product.php?site=mfl&product=srf&issuedby=mfl ; Key West beaches → https://www.weather.gov/key/ . (NWS Miami also publishes `MFL_GIS_day1.json`/`day2.json` GeoJSON; not used, because a proxy function is out of scope and browser CORS is unverified.) |
| **Beach flags** | Posted live by lifeguards; no API. Always say "Check posted flags." |
| **Water quality** | Link to FL DOH Healthy Beaches map (bi-weekly samples, 30 counties). |
| **Red tide** | Link to FWC status / daily map (https://gis.myfwc.com/redtidecurrentstatus/). As of 2026-11-20, not observed on the east coast. |
| **Sargassum** | Link to USF Sargassum Watch outlook (https://optics.marine.usf.edu/projects/saws.html); bulletins are regional, not per-beach. |
| **Tides** | Link to NOAA Tides & Currents (Open-Meteo sea level not reliable at the coast). |

### 5.5 Score config spec (`public/js/score-config.js`)

Thresholds are **data**, code only looks them up. Shape (reference: `knowledge/open-meteo-integrator/examples/04-score-config/score-config.mjs`):

```js
export const SCORE_CONFIG = {
  version: 1,
  window: { afterSunriseMin: 60, beforeSunsetMin: 30, earliest: [8, 0], latest: [19, 0], bestWindowHours: 3 },
  hardStops: { thunderCodes: [95, 96, 97, 99], gustMph: 32, windMph: 25, heatIndexF: 103 },
  bands: {                       // [{from, penalty}] ascending; first from = -Infinity; lower bound inclusive
    rainChance: [...], cloudPct: [...], feelsF: [...], windMph: [...], waveFt: [...], seaTempF: [...],
  },
  rain: { amountInchOver: 0.02, amountPenalty: 15, codes: {drizzle, showers, rain, unusual}, codePenalty: {...}, familyCap: 60 },
  stormRisk: { capeJkg: 1500, rainChance: 40, penalty: 15 },
  uvAdvice: [...], fogCodes: [45, 48],
  verdict: [{from: -Infinity, id: 'skip'}, {from: 45, id: 'fair'}, {from: 65, id: 'good'}, {from: 80, id: 'great'}],
  shortWindowVerdictCap: 'good', outlookFromDayIndex: 3,
};
pick(bands, x)  // the last band with from <= x
```

Rules for editing it: (1) keep the file frozen and unit-free (units are in the key names: `F`, `Mph`, `Ft`, `Pct`, `Inch`); (2) a band edit needs the cited source or a stated rationale, a boundary test on both sides of each changed edge, and review by open-meteo-integrator + Wren (wording) (change-proposal-protocol gate); (3) a structural test asserts every band list starts at `-Infinity` and is strictly ascending, so gaps and overlaps cannot be introduced; (4) `version` is bumped on any change and shown on the about screen.

### 5.6 Boundary test list (for qa-engineer)

Each row: test the values on **both** sides of the edge and on it. Penalty shown is the expected penalty from a base hour that scores 100 (calm, 80 degF, 50 % RH, wind 6, code 1). Full executable table: `BOUNDARIES` in `knowledge/open-meteo-integrator/examples/04-score-config/score.test.mjs`.

| Factor | Values -> expected |
|---|---|
| Rain chance % | 20 -> 0, 21 -> 10, 40 -> 10, 41 -> 25, 60 -> 25, 61 -> 40 |
| Clouds % | 40 -> 0, 41 -> 5, 70 -> 5, 71 -> 15 |
| Feels-like degF | 64.9 -> 40, 65 -> 25, 71.9 -> 25, 72 -> 10, 77.9 -> 10, 78 -> 0, 90.9 -> 0, 91 -> 10, 95.9 -> 10, 96 -> 25, 102.9 -> 25, 103 -> 40 |
| Wind mph | 12.9 -> 0, 13 -> 10, 18.9 -> 10, 19 -> 25, 24.9 -> 25, 25 -> hard stop |
| Gust mph | 31.9 -> no stop, 32 -> stop |
| Waves ft | 1.9 -> 0, 2 -> 10, 2.9 -> 10, 3 -> 20, 4.9 -> 20, 5 -> 35 |
| Water degF | 69.9 -> 25, 70 -> 15, 73.9 -> 15, 74 -> 5, 77.9 -> 5, 78 -> 0 |
| Thunder code | 94 -> no, 95/96/97 -> yes, 98 -> no, 99 -> yes; next hour -> `thunder_wait`; thunder in the hour before the window blocks the first window hour |
| Heat index degF | 102.9 -> no stop, 103 -> stop, 103.1 -> stop; air 75 degF/40 % stays on the simple formula |
| Rain amount in | 0.02 -> 0, 0.021 -> -15 |
| Rain codes | 51/53/55 -> 10, 61/63/65 -> 25, 80-82 -> 15, 62 and 64 -> 0 (not published), 71 -> 25 (`unusual_weather`), 45/48 -> 0 |
| Rain family | chance 70 % + 0.5 in + code 65 -> -60 (capped); chance 30 % + 0.5 in + code 80 -> -25 (amount and code counted once) |
| Storm risk | cape 1499/1500 x chance 39/40 -> only 1500 and 40 trigger |
| UV advice | 2.9 none, 3 moderate, 5.9 moderate, 6 high, 7.9 high, 8 very high, 10.9 very high, 11 extreme; score unchanged |
| Day verdict | scores 80 great, 75 good, 65 good, 60 fair, 45 fair, 40 skip; window average rounded before banding |
| Windows | ties -> earliest; window containing a stop hour ineligible; 2-hour window capped at Good; 0 hours -> no verdict |
| Confidence | day index 2 -> high, 3 -> outlook; marine all null -> medium + `marine_missing`; SST mean over best window |
| Preceding-hour shift | slot 13:00 reads `precipitation`, `precipitation_probability`, `wind_gusts_10m`, `uv_index` from row 14:00 |
| Reason snapshots | one inline snapshot of `reasons` + `advice` per fixture (calm sunny, thunderstorm afternoon, windy front, high UV, rough seas, multi-location) |

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
