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
| [examples/04-approve-cap-boundaries/](examples/04-approve-cap-boundaries/) | Approve-cap boundary table (5th/6th, 14th/15th, New York midnight, both DST changes, 744 h window) plus four planted-bug mutants | Ran: **23/23 pass**, also under `TZ=Pacific/Auckland` and `TZ=UTC` |
| [examples/05-every-function-matrix/](examples/05-every-function-matrix/) | 401/403/503 on every route x 20 cases, nothing-touched spies, route list parsed from docs/04, approve step-up wiring, four mutants. Guard and handlers are stand-ins | Ran: **15/15 pass**, 160 checks |
| [examples/06-github-actions-no-secrets/](examples/06-github-actions-no-secrets/) | Actions workflow template (`contents: read`, no secrets, SHA pins) and its lint with 18 planted violations | Ran: **21/21 pass**. `actionlint` and GitHub itself: **not run** |
| [examples/07-offline-sw-spec/](examples/07-offline-sw-spec/) | Chromium offline spec: Cache Storage never holds network-only paths, `/?source=pwa` shell, Console fails offline, SW update flow, 14-day snooze with `page.clock`, two mutants | Ran: **9/9 pass**, 90/90 over 10 repeats. WebKit **not run** |

## Things found by running (not obvious from the docs)
- `AxeBuilder.analyze()` throws "Please use browser.newContext()" for a page created by `browser.newPage()`.
- Leave `wcag22aa` out of the tag list and axe stops checking target size.
- `@axe-core/playwright` exports both a default export and a named `{ AxeBuilder }`.
- MSW 3 handlers without a query string matched Open-Meteo URLs that had one.

- `context.setOffline(true)` does **not** stop a fulfilling `context.route` from answering a service worker's own fetch; abort or remove the route first (example 07).
- `page.clock.install()` keeps ticking; add `setFixedTime(T0)` for exact boundaries (example 07).
- A "mutant" that is a no-op looks like a pass: my first calendar-days mutant equalled the real window and "NOTHING caught it" (example 04). Always run the mutants.
- With one shared test server, Playwright needs `workers: 1` (example 07).

## Sources not reachable on 2026-11-23
playwright.dev, docs.github.com and supabase.com did not resolve from the sandbox this round. The Playwright notes above are from the earlier read; GitHub Actions `permissions`/`secure-use` facts in docs/06 §6 are UNVERIFIED (rules come from security-engineer's decision).

## [UNVERIFIED] / not run
- The **WebKit/iPhone** project was not run in this sandbox. It must run in CI before any iOS-related PASS.
- ~~How `setOffline` treats a SW's own fetches~~ — observed in example 07 (see above); still not checked on WebKit.
- GitHub Actions workflow on GitHub itself, `actionlint`, real action SHAs.
- Whether axe reports contrast over glass or `backdrop-filter` as `incomplete` rather than as a violation (doc 03).
