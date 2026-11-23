# qa-engineer knowledge
Date: 2026-11-23. Notes are drawn from playwright.dev, vitest.dev and the axe-core API doc (fetched 2026-11-23). The examples were run locally with Node 22, Playwright 1.63.0 (Chromium only), Vitest 5.1.1, MSW 3.0.7 and axe-core 4.14.1.

Read everything here at the start of every task: this file first, then `docs/`, then `examples/`.

## docs/
| File | Covers | Read when |
|---|---|---|
| [docs/01-playwright-config-projects-emulation.md](docs/01-playwright-config-projects-emulation.md) | `defineConfig`, `webServer`, projects and `--project`, device descriptors (iPhone 15 = WebKit, Pixel 7 = Chromium, with real values), spread-then-override, locale/timezone, geolocation, colorScheme, reducedMotion, forcedColors, contrast, offline | Writing or changing `playwright.config` or any e2e spec |
| [docs/02-playwright-network-mocking-sw-offline.md](docs/02-playwright-network-mocking-sw-offline.md) | `page.route`/`route.fulfill`/`route.fetch`, HAR, glob rules (whole URL; `?` is literal), service workers hide requests from `route` (Chromium-only SW support, `serviceWorkers: 'block'`), offline via `setOffline` | Mocking Open-Meteo or `/api/*`, offline and service-worker specs |
| [docs/03-accessibility-axe.md](docs/03-accessibility-axe.md) | `@axe-core/playwright` usage, result shape, axe tags (**no `wcag22a`; `wcag22aa` = `target-size` only**), fingerprint snapshots, what axe misses | Every UI change (the axe gate) |
| [docs/04-vitest-msw-timers-snapshots.md](docs/04-vitest-msw-timers-snapshots.md) | MSW `setupServer` lifecycle and `server.use`, `vi.useFakeTimers`/`setSystemTime`/`toFake`, inline and file snapshots, CI snapshot behaviour | Unit and function tests, scoring tests, fixtures |
| [docs/05-screenshots-trace-reporting.md](docs/05-screenshots-trace-reporting.md) | Screenshot APIs, trace options, how to report PASS/FAIL/not-run honestly | Producing review screenshots and writing the gate verdict |

## examples/
| Folder | Shows | Status |
|---|---|---|
| [examples/01-playwright-mobile-mock/](examples/01-playwright-mobile-mock/) | iPhone 15 and Pixel 7 projects, local static server through `webServer`, Open-Meteo mocked with `page.route` using a **real** captured fixture, verdict/attribution/NWS-link assertions, `429` fallback, no-horizontal-scroll check with a screenshot, unexpected-host guard | Pixel: **4/4 pass**. iPhone: **not run**, WebKit isn't installed here (error captured in the README). |
| [examples/02-axe-scan/](examples/02-axe-scan/) | Page with 5 deliberate violations, then the fixed page, scanned with Beach Day's WCAG 2.2 AA tag set | Ran: bad = 5 violations (incl. `target-size`), fixed = 0 |
| [examples/03-vitest-msw-scoring/](examples/03-vitest-msw-scoring/) | Subset scorer plus forecast client; boundary `it.each`; MSW with `onUnhandledRequest: "error"` and per-test overrides; inline snapshot of `scoreDay`; fake `Date` for the 30-min cache | Ran: **14/14 pass** (snapshot written on the first run, then passing with `CI=true`) |

## Things found by running (not obvious from the docs)
- `AxeBuilder.analyze()` throws "Please use browser.newContext()" for a page created by `browser.newPage()`.
- Leave `wcag22aa` out of the tag list and axe stops checking target size.
- `@axe-core/playwright` exports both a default export and a named `{ AxeBuilder }`.
- MSW 3 handlers without a query string matched Open-Meteo URLs that had one.

## [UNVERIFIED] / not run
- The **WebKit/iPhone** project was not run in this sandbox. It must run in CI before any iOS-related PASS.
- How `context.setOffline(true)` treats a service worker's own fetches (doc 02).
- Whether axe reports contrast over glass or `backdrop-filter` as `incomplete` rather than as a violation (doc 03).
