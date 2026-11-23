# Example 03: cache-age helper (stale after 30 minutes)

## What it shows
`cache-age.mjs` decides when cached Open-Meteo data is stale and what the "last updated" line says:
- `cacheAge(fetchedAt, now)` → `{ageMs, stale, reason}`; stale at exactly 30:00; missing timestamp and future timestamps (device clock skew > 1 min) count as stale.
- `shouldRefetch(entry, {online, userForced})`: never when offline; only when stale; pull-to-refresh may bypass but not more than once a minute. It is meant to be called on user-driven events only (open, beach change, pull-to-refresh, `visibilitychange` to visible) — **never on a timer**, per the "never poll" rule.
- `freshnessLabel(...)`: plain-text status in beach-local time: `Updated 8:15 am`, `Updating… last data from 8:15 am`, `Offline — showing data from 8:15 am`, `Offline — no saved forecast yet` (status is words, not colour).

Why it is "what good looks like": there is no server cache (ADR-0001), so per-device caching is what keeps each user far below Open-Meteo's fair-use limits (<10,000 calls/day, 600/min — https://open-meteo.com/en/terms). Open-Meteo publishes no TTL; 30 min is our policy (marked as such in docs/06). Pure functions with injected `now`, so boundaries are testable.

## Run
```bash
cd knowledge/open-meteo-integrator/examples/03-cache-age
node --test cache-age.test.mjs
```

## Verified
Command: `node --test --test-reporter=spec cache-age.test.mjs` (Node v22.23.5, 2026-11-23)
```
✔ boundary: 29:59 fresh, 30:00 stale
✔ missing timestamp and clock skew are stale (0.167291ms)
✔ shouldRefetch: offline never, fresh no, stale yes, forced at most once a minute (0.183732ms)
✔ labels in beach local time (11.28465ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
```
