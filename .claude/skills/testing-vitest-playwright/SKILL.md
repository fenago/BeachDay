---
name: testing-vitest-playwright
description: How Beach Day is tested — Vitest unit and function tests with MSW and fixtures, Playwright end-to-end on iPhone and Pixel profiles, service-worker and offline specs, axe accessibility scans, Lighthouse CI on Deploy Previews, and the QA gate. Use when writing tests or deciding whether something is done.
---
# Testing (details: docs/06)

## Layout
```
tests/unit/        *.test.js   (Vitest, node env) — score, parse, allowlist, session, secret-scan, sse
tests/functions/   *.test.mts  (Vitest + MSW) — call handlers directly with Request objects
tests/e2e/         *.spec.ts   (Playwright)
tests/fixtures/openmeteo/*.json, tests/fixtures/claude/*.sse
```
Scripts: `npm test` runs Vitest, `npm run e2e -- --trace off` runs Playwright, and `npm run a11y` runs the axe specs.

## Vitest
- **Network mocks:** MSW (`setupServer`, `onUnhandledRequest: "error"`), with `resetHandlers()` after each test.
- **Time:** `vi.useFakeTimers()` and `vi.setSystemTime(new Date("2026-07-04T12:00:00-04:00"))`. Call `vi.useRealTimers()` in `afterEach`.
- **Scoring:** a boundary test at every threshold, plus an inline snapshot of `reasons` for each fixture.
- **Functions:**
  - `const res = await handler(new Request("http://x/api/chat", { method: "POST", headers, body }), fakeContext)`
  - Assert the status, the headers (`cache-control: no-store`) and that the body never contains secrets.
- **Blobs:** inject a fake store that honors `onlyIfNew` and `onlyIfMatch`.

## Playwright
```ts
projects: [
  { name: "iphone", use: { ...devices["iPhone 15"], serviceWorkers: "block" } },
  { name: "pixel",  use: { ...devices["Pixel 7"],  serviceWorkers: "block" } },
  { name: "offline-sw", use: { ...devices["Pixel 7"] }, testMatch: /offline\.spec/ },
],
use: { baseURL: process.env.BASE_URL ?? "http://localhost:8888", timezoneId: "America/New_York", locale: "en-US" }
```
- **Mock data:** use `page.route("https://api.open-meteo.com/**", r => r.fulfill({ json }))`. The glob must match the full URL. Mock `/api/*` too, and never call real Claude or GitHub in CI.
- **Service workers:** requests served by the SW bypass `page.route`, so most specs block SWs. The offline spec runs on **Chromium only** and goes: install SW → `context.setOffline(true)` → reload → assert the cached forecast and the offline banner.
- **Emulation:** `reducedMotion: "reduce"`, `colorScheme: "dark"`, `forcedColors: "active"`, `contrast: "more"`, and geolocation with permission.
- Run with `--trace off` unless debugging. Take screenshots for review at `deviceScaleFactor: 2`.

## Accessibility & performance
- **axe:** `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze()` must have no violations.
- **Lighthouse CI:** `lhci autorun` against the Deploy Preview or prod URL. Targets: performance ≥ 0.9, accessibility = 1.0. There is no PWA category, so check that in DevTools.

## Gate before anything is "done"
- [ ] Unit and function tests pass, and new logic has tests.
- [ ] e2e passes on the iPhone and Pixel profiles; the offline spec passes if SW or data code changed.
- [ ] axe is clean on the changed screens.
- [ ] Every Console change keeps the security tests from `agent-console-security` passing.
- [ ] Report the commands you ran and their results honestly. If you did not run something, say so.
