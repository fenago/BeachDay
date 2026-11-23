# 06 — Testing and accessibility

> Researched 2026-11-23 (Vitest, Playwright, axe-core, W3C WCAG 2.2 / WAI-ARIA 1.2, Netlify, Lighthouse CI). Owner: `qa-engineer`, with Wren/Sable for accessibility design.

## 1. Test pyramid

| Layer | Tool | What | Runs |
|---|---|---|---|
| Unit | **Vitest** (node env) | Scoring functions, Open-Meteo parsing, allow-list, password/session helpers, SSE event formatter | Every commit (GitHub Actions) |
| Function integration | Vitest + **MSW** | Import each Netlify function and call `handler(new Request(...), mockContext)`; MSW fakes `api.anthropic.com` and `api.github.com` | Every commit |
| End-to-end | **Playwright** (iPhone + Pixel profiles) | Beach picker, verdicts, offline, install hint, Console login → chat → proposal → approve (GitHub mocked) | Every Deploy Preview |
| Accessibility | **@axe-core/playwright** + manual | WCAG 2.2 AA automated rules + manual checklist (§5) | Every Deploy Preview |
| Performance/PWA | **Lighthouse CI** + DevTools Application panel | Performance, a11y, best practices; manifest/SW checked manually (Lighthouse has no PWA category since v12) | Deploy Preview / weekly |
| Real devices | iPhone (Safari) + Android (Chrome) | Install, standalone launch, offline, glass rendering, VoiceOver/TalkBack | Before each release |

## 2. Unit tests (Vitest)

* Keep scoring **pure**: `scoreHour(hourData, prefs) → {score, reasons}` and `scoreDay(hours) → {verdict, score, bestWindow, reasons}` — no fetch, no DOM.
* **Fixtures:** save real Open-Meteo responses for a few beaches and weather types (sunny calm, thunderstorm afternoon, windy cold front, high UV, rough surf) under `tests/fixtures/`. Re-record occasionally; responses change shape rarely.
* Mock network with **MSW** (Vitest's recommended approach): `setupServer(http.get(url, () => HttpResponse.json(fixture)))`, `server.listen({ onUnhandledRequest: 'error' })`, `resetHandlers()` after each test. [Vitest mocking requests](https://vitest.dev/guide/mocking/requests)
* Or `vi.stubGlobal('fetch', vi.fn(...))` — remember `vi.unstubAllGlobals()` (not auto-reset). [globals](https://vitest.dev/guide/mocking/globals)
* Time-dependent logic ("today", sunrise/sunset windows, America/New_York): `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-04T12:00:00-04:00'))`. [dates](https://vitest.dev/guide/mocking/dates)
* Snapshot the **reasons text** for each fixture (`toMatchInlineSnapshot`) so threshold changes are visible in review. [snapshots](https://vitest.dev/guide/snapshot)
* Boundary tests for each threshold in doc 01 (e.g. UV 5.9 vs 6.0, wind 14.9 vs 15 mph, thunderstorm code 95).

## 3. Netlify Function tests

* Functions use the web `Request → Response` signature ([get started](https://docs.netlify.com/build/functions/get-started/)), so tests can import and call them directly:
  ```ts
  import approve from "../netlify/functions/approve.mts";
  const res = await approve(new Request("http://x/api/proposals/p1/approve", { method: "POST", headers }), mockContext);
  expect(res.status).toBe(401);
  ```
  (Direct invocation is our pattern, inferred from the signature.)
* Must-have cases: 401 without session; 403 bad CSRF; 429 over limit; allow-list rejects; secret-scan rejects; stale base SHA; non-fast-forward retry; double approve (CAS); Claude refusal / 429 / timeout; background job retry is idempotent.
* Blobs: use the local sandbox store under `netlify dev`, or inject a fake store in unit tests.
* Local manual testing: `netlify dev` (port 8888) / `netlify functions:serve` (port 9999). [local dev](https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/)

## 4. End-to-end (Playwright)

Sources: [emulation](https://playwright.dev/docs/emulation), [network](https://playwright.dev/docs/network), [service workers](https://playwright.dev/docs/service-workers).

```ts
// playwright.config.ts
projects: [
  { name: "iphone", use: { ...devices["iPhone 15"], serviceWorkers: "block" } },   // WebKit
  { name: "pixel",  use: { ...devices["Pixel 7"],  serviceWorkers: "block" } },    // Chromium
  { name: "offline-sw", use: { ...devices["Pixel 7"] }, testMatch: /offline\.spec/ }, // SW allowed
],
use: { baseURL: process.env.BASE_URL, timezoneId: "America/New_York", locale: "en-US", trace: "off" },
```

* Device names `iPhone 15` / `Pixel 7` exist in Playwright's registry (exact viewport values **[UNVERIFIED]** — check `require('playwright').devices`).
* **Mock Open-Meteo** with `page.route('https://api.open-meteo.com/**', r => r.fulfill({ json: fixture }))` so e2e is deterministic. The glob must match the whole URL.
* **Service-worker caveat:** requests answered by the SW never reach `page.route`. Run most specs with `serviceWorkers: 'block'`; run a dedicated **Chromium-only** offline spec (Playwright supports SWs only in Chromium): load → wait for `controllerchange` → `context.setOffline(true)` → reload → assert cached forecast + "Offline — last updated …" banner.
* Emulate preferences: `reducedMotion: 'reduce'`, `colorScheme: 'dark'`, `forcedColors: 'active'`, `contrast: 'more'` — verify glass falls back to solid surfaces and nothing breaks.
* Geolocation ("nearest beach"): `permissions: ['geolocation']` + `geolocation: {latitude: 26.12, longitude: -80.10}`.
* Console e2e: mock `/api/chat` with a canned SSE body and `/api/proposals/*/approve` with success, stale, and 429 responses. Never hit real GitHub or Claude in CI.
* Install behavior can't be fully automated; assert the manifest link, SW registration, and that the iOS hint shows when not standalone.

## 5. Accessibility — WCAG 2.2 AA

WCAG 2.2 is a W3C Recommendation (12 Dec 2024; 4.1.1 Parsing removed). [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

| Criterion | Level | What it means for Beach Day |
|---|---|---|
| **1.4.1 Use of Color** | A | Verdicts must not rely on red/yellow/green alone — always text ("Great", "OK", "Skip it") + icon/shape. [Understanding 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) |
| 1.4.3 Contrast (Minimum) | AA | 4.5:1 text (3:1 large). White on yellow fails; **text over glass must be measured against the worst-case background** behind the blur — add a tint/scrim. |
| 1.4.11 Non-text Contrast | AA | 3:1 for controls, focus rings, rating dots, chart lines, glass panel edges that convey a boundary. |
| 1.4.10 Reflow | AA | Works at 320 CSS px without horizontal scroll (e.g. the 5-day strip wraps or scrolls as a list, not the page). |
| 1.4.12 Text Spacing / 1.4.4 Resize | AA | Layout survives larger text (iOS Dynamic Type equivalent via rem units). |
| 2.4.7 Focus Visible / **2.4.11 Focus Not Obscured** | AA | Visible focus; sticky header / chat composer must not cover focused items. |
| **2.5.8 Target Size (Minimum)** | AA | ≥ 24×24 CSS px; use **44×44** (Apple HIG and WCAG 2.5.5 AAA) for beach chips, day tabs, Approve/Reject. [Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| 2.2.2 Pause, Stop, Hide | A | Auto-refreshing forecasts/animations must not distract; no auto-rotating carousels. |
| 3.3.8 Accessible Authentication | AA | Console password field allows paste and password managers; no puzzles. |
| 4.1.3 Status Messages | AA | "Updated", "Offline", "Committed", "Deploying" announced without moving focus (`role="status"`). |
| 2.3.3 Animation from Interactions | AAA | Not required, but honor `prefers-reduced-motion` (and `prefers-reduced-transparency` for glass). |

**Chat streaming (Agent Console)** — [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/):

* Message list: `role="log"` (implicit `aria-live="polite"`, new items appended at the end).
* While a reply streams, set `aria-busy="true"` on that message and `false` when done so screen readers announce it once instead of every token.
* Status changes ("Proposal ready", "Committed", "Deploy live"): `role="status"`. Reserve `role="alert"` for errors that need immediate attention.
* Diff view: real text (not images), headings per file, "added"/"removed" conveyed by text prefix (`+`/`−`) and not color alone.

**Automated checks:**

```ts
import AxeBuilder from "@axe-core/playwright";
const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
  .analyze();
expect(results.violations).toEqual([]);
```

Run on: home (each verdict state), beach picker, day detail, offline state, Console login, chat with a proposal open, in light/dark and reduced-transparency modes. Automated tools catch only part of the issues — [Playwright a11y testing](https://playwright.dev/docs/accessibility-testing), [axe tags](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md).

**Manual checklist (each release):** VoiceOver on iPhone and TalkBack on Android through the main flow; keyboard-only on desktop; 200 % zoom; reduced motion/transparency on; color-blindness simulation in DevTools on verdict colors.

## 6. CI pipeline

1. **GitHub Actions on push/PR:** `npm ci` → lint → Vitest (unit + function) → build `agents.json` check.
2. **Netlify Deploy Preview** builds automatically for PRs (`deploy-preview-<n>--<site>.netlify.app`, `noindex`). [deploy previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)
3. Actions job waits for the preview URL, then runs Playwright + axe + Lighthouse CI (`@lhci/cli@0.16.x`, `lhci autorun`, `collect.url` = preview URL; set budgets such as performance ≥ 0.9, accessibility = 1.0). [LHCI getting started](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md)
4. Agent Console commits go straight to `main` in the baseline design (doc 04 §7), so unit + function tests also run on `main`, and a failing post-deploy smoke test should prompt an immediate Netlify rollback. In the optional PR mode, Approve is enabled only after the preview checks pass.

## 7. Definition of done (QA gate)

- [ ] Unit + function tests green; new thresholds have boundary tests.
- [ ] Playwright green on iPhone and Pixel profiles; offline spec green.
- [ ] axe: zero violations on listed screens; manual VoiceOver pass for changed screens.
- [ ] Lighthouse budgets met on the Deploy Preview.
- [ ] No secrets in build output; `/api/*` returns 401 without a session.
- [ ] Manifest and SW verified in DevTools Application panel; SW update toast works.
