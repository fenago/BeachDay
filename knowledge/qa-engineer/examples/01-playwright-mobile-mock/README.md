# Example 01 — Playwright on iPhone 15 / Pixel 7 with Open-Meteo mocked

## What it demonstrates
- `playwright.config.mjs`:
  - Two device projects. `iphone` uses `devices["iPhone 15"]`, which is **WebKit**. `pixel` uses `devices["Pixel 7"]`, which is **Chromium**.
  - The device is spread first and overrides come after it.
  - `serviceWorkers: "block"`, so `page.route` sees every request.
  - `timezoneId: "America/New_York"` and `locale: "en-US"`.
  - `trace: "off"`.
  - A `webServer` that starts `server.mjs`, a tiny `node:http` static server for `site/`.
- `site/`:
  - A minimal Beach Day page. The **browser fetches Open-Meteo directly** (ADR-0001), scores the day with `score.js` (the same subset scorer as example 03), and shows a **text** verdict in `role="status"`.
  - It also shows the NWS rip-current link (ADR-0002) and the Open-Meteo attribution.
- `tests/verdict.spec.mjs`:
  - `page.route("https://api.open-meteo.com/v1/forecast?**", r => r.fulfill({ json }))` with a **real** captured response.
  - Four cases: calm day → "Great beach day (95/100)"; all-day thunderstorms → "Skip it (0/100)"; `429` → friendly fallback; and no horizontal scroll at the phone width, with a screenshot.
  - A guard fails the test if the page contacts any host other than `127.0.0.1` or the mocked API.
- `fixtures/forecast-miami-beach-2026-11-23.json`: a real Open-Meteo Forecast response. `api.open-meteo.com` is not reachable from this sandbox's shell, so the URL in `site/app.js` was fetched through the Firecrawl scrape tool on 2026-11-23 and saved verbatim.

Why this is "what good looks like":
- Assertions use roles and visible text, the way users and assistive tech see the page. They don't use CSS classes.
- The verdict is checked as **text**, never colour.
- The glob matches the **whole URL**, including the query (`?**`). Playwright globs must match the entire URL ([network](https://playwright.dev/docs/network#glob-url-patterns)).
- Nothing reaches the network, so the tests are deterministic and free.

## How to run
```bash
npm install                                     # @playwright/test pinned to the preinstalled Playwright 1.63.0
npx playwright test --project=pixel --trace off  # Chromium
npx playwright test --trace off                  # both projects; iphone needs WebKit installed
```

## Verified
Ran on 2026-11-23 with Node v22.23.5 and `@playwright/test@1.63.0` (matching the preinstalled `playwright@1.63.0`, browsers in `/opt/pw-browsers`), from a scratch copy:
```
$ npx playwright test --project=pixel --trace off
Running 4 tests using 2 workers
  ✓  2 [pixel] › tests/verdict.spec.mjs:41:1 › thunderstorms all day -> Skip it (197ms)
  ✓  1 [pixel] › tests/verdict.spec.mjs:22:1 › calm real-world day shows a text verdict, best window and reasons (270ms)
  ✓  3 [pixel] › tests/verdict.spec.mjs:50:1 › API error (429) degrades to a friendly message (142ms)
  ✓  4 [pixel] › tests/verdict.spec.mjs:58:1 › layout fits the phone viewport (no horizontal scroll) (272ms)
  4 passed (1.3s)
```
The screenshot `test-results/.../verdict-pixel.png` (1082×2202 at deviceScaleFactor 2.625) was inspected and shows the verdict, best time, reasons, NWS link and attribution.

**iPhone project: not run.** WebKit is not installed here (only `chromium-1243` is under `/opt/pw-browsers`), and the brief forbids `playwright install`. Actual output:
```
$ npx playwright test --project=iphone --trace off
  ✘  1 [iphone] › tests/verdict.spec.mjs:38:1 › thunderstorms all day -> Skip it (2ms)
    Error: browserType.launch: Executable doesn't exist at /opt/pw-browsers/webkit-2359/pw_run.sh
```
Run the `iphone` project in CI, or on a machine where `npx playwright install webkit` is allowed. Do not report it as PASS until then.
