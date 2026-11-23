# Example 02: beach window and time-zone helpers

## What it shows
`beach-window.mjs` computes the scoring window from the beach-day-scoring skill — **max(sunrise + 1 h, 8 am) .. min(sunset − 0.5 h, 7 pm), local time** — correctly:
- `apiLocalToInstant(s, utc_offset_seconds)`: Open-Meteo's offset-less local strings (`"2026-11-23T06:44"`) become exact instants using the response's fixed offset. Never `new Date(s)` (that uses the device's zone).
- `zoneOffsetSeconds`, `instantToWallClock`, `wallClockToInstant`: DST-aware conversion with `Intl.DateTimeFormat` for `America/New_York`, so "8 am" and "7 pm" are real beach-local times.
- `beachWindow(day, ctx)` returns `{start, end, startLocal, endLocal}` or `null` when there is no usable window.
- `hoursInWindow(hours, win, offset)` picks hour slots starting inside the window.

Why it is "what good looks like": it encodes the documented DST caveat ("Daylight saving time (DST) changes within the requested range are ignored", https://open-meteo.com/en/docs) with a test that proves the 1-hour shift after 2027-03-14, and it compares instants, not strings. No dependencies.

## Run
```bash
cd knowledge/open-meteo-integrator/examples/02-beach-window
node --test beach-window.test.mjs
```
Uses the real forecast fixture from example 01 (`../01-openmeteo-client/fixtures/forecast-miami-beach.json`). The July and March 2027 cases are synthetic inputs in the API's format (no real response spans a DST switch yet).

## Verified
Command: `node --test --test-reporter=spec beach-window.test.mjs` (Node v22.23.5, 2026-11-23)
```
✔ API local string + fixed offset -> instant
✔ zone offsets: EST in November, EDT in July (29.912758ms)
✔ window for 2026-11-23 Miami Beach (real fixture): 08:00 .. 16:59 (2.210173ms)
✔ summer day: late sunset is capped at 19:00, early sunrise +1h wins only if after 08:00 (0.641318ms)
✔ DST caveat: response requested before 2027-03-14 keeps the EST offset for every hour (0.51276ms)
✔ wallClockToInstant is DST-correct on both sides of the switch (0.654839ms)
✔ no window when sunset is too early (degenerate config) (0.678782ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```
Real-data result: sunrise 06:44 / sunset 17:29 on 2026-11-23 → window 08:00–16:59, hours 08:00…16:00 (9 hours).
