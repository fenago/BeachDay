# Example 03 — Vitest + MSW + fake timers + inline snapshot for scoring

## What it demonstrates
- `src/score.js`: a **subset** of the Beach Day v1 scoring model (`.claude/skills/beach-day-scoring`).
  - Included: the beach window `max(sunrise+1h, 8am)` to `min(sunset−0.5h, 7pm)`, thunder (95/96/97/99) and wind (gust ≥32 or wind ≥25) hard stops, the hour after thunder blocked, penalties for rain chance, cloud, feels-like temperature and wind, and the best-3-hour verdict.
  - Left out to keep it small: heat index, precipitation amount, rain codes, CAPE, marine data and UV advice.
- `src/forecast.js`: a browser-side Open-Meteo client with `AbortSignal.timeout(8000)`. It checks the response shape, surfaces Open-Meteo's 400 `reason`, and caches for 30 minutes.
- `test/score.test.js`:
  - **Boundary tests** with `it.each` at each threshold: code 94/95, wind 12/13, gust 31.9/32, rain 20/21, feels-like 77.9/78.
  - **MSW:**
    - `setupServer(http.get(...))` with `server.listen({ onUnhandledRequest: "error" })`, `resetHandlers()` after each test, and `close()` at the end, as in the Vitest docs ([mocking requests](https://vitest.dev/guide/mocking/requests)).
    - `server.use(...)` for per-test overrides (storm, 400 error).
  - **Inline snapshot** of the whole `scoreDay` result for the real fixture. Vitest wrote it into the test file on the first local run ([snapshot](https://vitest.dev/guide/snapshot)).
  - **Fake timers:** `vi.useFakeTimers({ toFake: ["Date"] })` plus `vi.setSystemTime(...)` prove the 30-minute cache boundary (29:59 → cached, 30:00 → refetch). `vi.useRealTimers()` runs in `afterEach` ([vi API](https://vitest.dev/api/vi)).
- `fixtures/forecast-miami-beach-2026-11-23.json`: a real Open-Meteo response, fetched through the Firecrawl scrape tool because the sandbox can't reach `api.open-meteo.com`. It is identical to the fixture in example 01.

## How to run
```bash
npm install      # vitest, msw
npx vitest run   # with CI=true, missing or obsolete snapshots fail instead of being written
```

## Verified
Ran on 2026-11-23 with Node v22.23.5, `vitest@5.1.1` and `msw@3.0.7`, from a scratch copy.

The first run, with `CI` unset and an empty `toMatchInlineSnapshot()`, wrote the snapshot:
```
 RUN  v5.1.1 .../run-qa03
  Snapshots  1 written
 Test Files  1 passed (1)
      Tests  14 passed (14)
```
The committed file now contains that snapshot. Re-run in CI mode:
```
$ CI=true npx vitest run
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Duration  267ms
```
The snapshot values (verdict "Great beach day", score 95, window 10:00–13:00, reasons "Partly cloudy" and "A bit cool") match example 01's on-screen result for the same fixture.

Side check: with plain `vi.useFakeTimers()` (all timers faked), the suite also passed, 14/14. The `toFake: ["Date"]` choice is a safety margin. Nothing was observed to break without it.
