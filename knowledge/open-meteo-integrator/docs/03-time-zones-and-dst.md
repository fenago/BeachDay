# Time zones, `utc_offset_seconds`, DST and `timeformat`
Source: https://open-meteo.com/en/docs (parameters `timezone`, `timeformat`; JSON return object `utc_offset_seconds`)
Source: https://open-meteo.com/en/docs/marine-weather-api (same wording for Marine)
Retrieved: 2026-11-23

## What the docs say
- `timezone` (default `GMT`): "The requested timezone's UTC offset at request time is returned as utc_offset_seconds and used for ISO 8601 timestamps and daily boundaries throughout the response. Daylight saving time (DST) changes within the requested range are ignored. For DST-aware local times, request timeformat=unixtime and convert using the returned timezone in your application."
- Any tz-database name works; `auto` resolves it from the coordinates; for multiple coordinates a comma-separated list of zones may be given.
- `utc_offset_seconds`: "UTC offset for the requested timezone, in seconds, resolved at request time and fixed throughout the response, including across daylight saving time transitions."
- `timeformat` (default `iso8601`): "By default, timestamps use ISO 8601 format with a fixed offset, utc_offset_seconds, resolved at request time (see timezone). With unixtime, timestamps are seconds since 1970-01-01 00:00 UTC. To reproduce the API's dates and times, format them using utc_offset_seconds."
- `daily` requires `timezone` (daily boundaries are local midnights at that fixed offset).
- `timezone_abbreviation` is the abbreviation at request time.

## What a response actually looks like (Miami Beach, 2026-11-23)
```json
"utc_offset_seconds": -18000, "timezone": "America/New_York", "timezone_abbreviation": "GMT-5",
"hourly": { "time": ["2026-11-23T00:00", "2026-11-23T01:00", ...] },
"daily":  { "sunrise": ["2026-11-23T06:44"], "sunset": ["2026-11-23T17:29"] }
```
- Strings have **no offset suffix**. `new Date("2026-11-23T06:44")` in a browser parses it as *device* local time — wrong if the device is not in Eastern time. Never do that.
- The abbreviation was `"GMT-5"` rather than `"EST"`; don't show it.

## Correct conversions
```js
// API string -> instant (exactly what the API meant)
const toInstant = (s, off) => {
  const [, y, mo, d, h, mi] = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(s).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - off * 1000;
};
// instant -> real wall clock in the beach's zone (DST-aware)
new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
  .format(new Date(instant));
```
Tested in `examples/02-beach-window/`.

## The DST trap, concretely
US Eastern time switches to EDT on 2027-03-14 at 02:00. A 7-day request made on 2027-03-12 comes back with `utc_offset_seconds = -18000` for **all** 168 hours. The row labelled `2027-03-15T12:00` is 17:00 UTC, which on the beach is **13:00 EDT**. Sunrise/sunset strings after the switch are likewise one hour "early" in wall-clock terms. (Example test: "DST caveat ...".)

Options:
1. **Convert via instants** (what the example does): parse with `utc_offset_seconds`, then display with `Intl` in `America/New_York`. Labels are right on both sides of the switch.
2. **`timeformat=unixtime`**: `hourly.time` and `daily.sunrise/sunset` become integers (seconds). Same instants, no string parsing; display with `Intl`. Daily boundaries are still based on the fixed offset **[UNVERIFIED: the docs do not say how daily rows are cut with unixtime across a DST switch; assume the fixed offset]**.
3. Ignore it: off by one hour for up to 7 days twice a year. Not acceptable for "best window 10 am–1 pm" copy.

Daily rows: day boundaries come from the fixed offset, so across the switch a "day" is 00:00–24:00 at the old offset, i.e. 01:00–01:00 local EDT. For beach windows (08:00–19:00) this doesn't change which day an hour belongs to.

## Multi-source joins
Forecast and Marine responses requested with the same `timezone` at the same moment have the same `utc_offset_seconds` and the same `time` strings, so joining by the string is safe (the example does this). If the two requests straddle a DST switch moment (very unlikely), compare `utc_offset_seconds` and fall back to joining by instant.

## Beach Day notes
- Always request `timezone=America/New_York` (all beaches incl. Key West are Eastern). Don't use `auto`: it costs nothing but makes fixtures less predictable.
- The beach-window rule (max(sunrise+1h, 8 am) .. min(sunset−0.5h, 7 pm)) must compare instants, not strings; 8 am / 7 pm are **real** local wall-clock times computed with `Intl`.
- Show all times in the beach's zone, not the device's (a visitor from California planning a Miami day wants Miami times). Label it once: "Times in Miami (ET)".
- Add a fixture spanning 2027-03-14 when available; until then the synthetic DST test in example 02 is the guard.
