---
name: testing-vitest-playwright
description: How Beach Day is tested — Vitest unit and function tests with MSW, fake Supabase and fixtures, the 401/403/503 matrix on every function, Approve-cap and DST boundaries, Playwright end-to-end on iPhone and Pixel profiles, service-worker and offline specs, axe scans, GitHub Actions with no secrets, Lighthouse on the production URL, and the QA gate (green on the main deploy, rollback ready). Use when writing tests or deciding whether something is done.
---
# Testing (details: docs/06)

## Layout
```
tests/unit/        *.test.js   (Vitest, node env) — score + boundaries, allowlist, secret-scan, step-up, origin, stamp-sw, gen-config, headers/manifest validators, sse, workflow lint
tests/functions/   *.test.mts  (Vitest + MSW + fakes) — handlers called with Request objects; auth matrix; approve; limits; profiles RLS (pglite)
tests/e2e/         *.spec.ts   (Playwright; @prod tag = safe to run against production)
tests/fixtures/openmeteo/*.json, tests/fixtures/claude/*.sse
```
Scripts: `npm test` runs Vitest, `npm run e2e -- --trace off` runs Playwright, and `npm run a11y` runs the axe specs.

## Where tests run (docs/06 §6)
- **GitHub Actions only**, with `permissions: contents: read`, **no secrets**, no `pull_request_target`/`workflow_run`, actions pinned by SHA, `persist-credentials: false`, no `${{ }}` in `run:`. **Never in the Netlify build** (it sees every secret and `tests/**` is agent-writable).
- A human adds `.github/workflows/tests.yml` (agents can't). Template + lint: `knowledge/qa-engineer/examples/06-github-actions-no-secrets/`.
- **No Deploy Previews.** QA is **green on the main deploy, rollback ready** (ADR-0003): poll `/version.json` until it names the commit, run `scripts/smoke.mjs`, the `@prod` specs and Lighthouse on the production URL. Red → roll back first ("Publish deploy" on the previous one), then fix.
- CI holds no login. Console e2e **mocks Supabase** (`page.route` on the project host, read from `/generated/config.js`) and `/api/*`. Never call real Claude, GitHub or Supabase.

## Vitest
- **Network mocks:** MSW (`setupServer`, `onUnhandledRequest: "error"`), `resetHandlers()` after each test. Fake Supabase = a `fetch` fake with a test-minted ES256 JWKS, PostgREST `profiles` and `getUser`; fake Blobs honouring `onlyIfNew`/`onlyIfMatch`.
- **Time:** `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)`; `vi.useRealTimers()` in `afterEach`. Run date tests under another `TZ` too.
- **Scoring:** drive `it.each` from Dewey's list (docs/01 §5.6), both sides of every edge; a structural test that every band list starts at `-Infinity` and ascends; an inline snapshot of `reasons` codes per fixture.
- **Every function (docs/04 §12, ADR-0006):** matrix = route × case, registry checked against the docs/04 §2 table. 401: no/garbage/expired/bad-signature/other-key/wrong-`iss`/wrong-`aud`/anonymous token, PostgREST 401. 403: role `user`, no row, role claim in the JWT ignored, demotion effective on the next request. **503**: profile 5xx or any non-2xx, non-JSON body, hang over 5 s, network error, cold-JWKS failure or 502; `getUser` retryable error returned (not thrown) on Approve. Each asserts headers (`no-store`, `nosniff`, no `Access-Control-Allow-*`, no `Set-Cookie`, `www-authenticate: Bearer` on 401), **no Blobs/GitHub/Claude call**, and no token or secret in the body. Plus a positive control and planted-bug mutants. `/api/jobs-run`: no work and no writes on bad auth, nonce single-use (SHA-256 only stored).
- **SSE/approve shape:** a refusal ends with one `error {code:"refusal", retryable:false}` and no `done` (a refused job ends `failed`); approve 200 may be `committing` (success; reconciler finishes) and always has `deploys`.
- **Origin:** cross-site `Sec-Fetch-Site` or foreign/`null` `Origin` on POST → 403; both absent passes.
- **Approve:** step-up (601 s, `token_refresh`, fresh `totp` + stale sign-in, `aal1` with a factor → 401 `step_up_required`, proposal stays `pending`); hash mismatch 409; double approve 200 + 409; commit order with `base_tree` and `force:false`; unknown ref-update outcome re-reads `main` before `failed`; reconciler (trailer found / not found / GitHub down); `committed ⇒ counted`.
- **Caps (Example 04):** Approve 5th/6th per New York day and 14th/15th per rolling 31 days (744 h), New York midnight to the ms, **both DST changes** (2027-03-14 23 h day, 2026-11-01 25 h day), `retryAt`; per-user 200 chat / 20 jobs; 15 tool rounds; 1M tokens; `site:compute` budget (`budget_exhausted`); 55 s turn deadline. 429 bodies carry `retryAt`.
- **Environments:** 503 outside `context.deploy.context === "production"` before the secret is read; Anthropic client uses explicit `baseURL`; token-name scan (`GITHUB_TOKEN` only in `github-write`, `GITHUB_READ_TOKEN` only in `github-read`; ADR-0009 is Proposed).
- **RLS:** pglite test of `profiles` (own row only, role not self-updatable, no insert/delete, trigger, promotion changes 0 rows for an unconfirmed email). The real project is a manual pre-launch step (docs/04 §4.2 a–e).
- **Static invariants:** `sw.js` imports only from `public/sw/**`; CSP in `_headers` equals docs/04 §10; no `[[headers]]`; no test runner in the Netlify build command; `DEPLOY_PATHS` equals the `ignore` path list; model allow-list fails the build; no secret strings in `public/` or build output; fake secrets are built at runtime (no literal, no "EXAMPLE").
- **Allow-list table:** the whole canonical list (`_headers`, `sw.js`, `sw/**`, `vendor/**`, `generated/**`, `version.json`, `.claude/settings*`, …), traversal, case tricks, symlink mode, limits; re-checked at approve time.
- **Removed:** every shared-password, session-cookie and CSRF-token test (ADR-0006).

## Playwright
```ts
projects: [
  { name: "iphone", use: { ...devices["iPhone 15"], serviceWorkers: "block" } },
  { name: "pixel",  use: { ...devices["Pixel 7"],  serviceWorkers: "block" } },
  { name: "offline-sw", use: { ...devices["Pixel 7"], serviceWorkers: "allow" }, testMatch: /offline\.spec/ },
],
workers: 1,   // offline-sw specs share one server
use: { baseURL: process.env.BASE_URL ?? "http://127.0.0.1:4173", timezoneId: "America/New_York", locale: "en-US", trace: "off" }
```
- **Mock data:** `page.route("https://api.open-meteo.com/**", r => r.fulfill({ json }))`; the glob must match the full URL. Mock `/api/*` and the Supabase host too; guard unexpected hosts.
- **Service workers:** requests served by the SW bypass `page.route`, so most specs block SWs. The offline spec runs on **Chromium only** (Example 07):
  - installs `beachday-shell-<VERSION>` + `beachday-data-v1`; `/sw.js`, `/version.json`, `/api/*`, `/console*`, `/js/console/*`, `/vendor/*`, `/generated/*`, Supabase host **never in Cache Storage**;
  - offline `goto("/?source=pwa")` serves the shell (`ignoreSearch`), cached forecast, offline banner; offline `/console` and `/vendor/*` **fail** with a network error;
  - update: new stamped `sw.js` bytes → waiting → `SKIP_WAITING` → one `controllerchange` → old shell cache deleted.
  - **Trap:** `setOffline(true)` does not stop a *fulfilling* `context.route` from answering the SW's own fetch. Abort or remove the route before going offline.
- **Install and manifest:** hint with a 14-day snooze using `page.clock.install({time})` then `setFixedTime(T0)`; manifest has no `shortcuts` and no `console`, icons/screenshot names and sizes, `#0b3b5c`, `id: "/"`, `start_url: "/?source=pwa"`.
- **Console e2e:** sign-in/up/reset/Google (no popup, no `<form action>`), wrong-password focus and `aria-invalid` rules, 403 no-access vs **503 never no-access**, 401 session ended, step-up sheet (no approve request until the person activates it; `?approve=1`, `#approve`, `?code=` send nothing), cap alerts, "No deploy needed" (no polling) vs "Live", approve 502 never resent, model output rendered as text.
- **Emulation:** `reducedMotion: "reduce"`, `colorScheme: "dark"`, `forcedColors: "active"`, `contrast: "more"`, geolocation with permission.
- Run with `--trace off` unless debugging. Screenshots for review at `deviceScaleFactor: 2` on iPhone and Pixel. WebKit missing → say "iphone: not run".

## Accessibility & performance
- **axe:** `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze()` — zero violations. Include the auth screens, step-up sheet and cap/budget alerts. 44 px targets are a custom `boundingBox()` check.
- **Lighthouse CI:** `lhci autorun` against the **production URL** after a deploy. Performance ≥ 0.9, accessibility = 1.0. No PWA category; check installability in DevTools.

## Gate before anything is "done"
- [ ] Unit and function tests pass; new logic has tests; the auth matrix covers every function and its mutants still fail it.
- [ ] Approve-cap boundaries pass, DST days included.
- [ ] e2e passes on iPhone and Pixel (else the gate is INCOMPLETE); the offline spec passes if SW, manifest or cached-data code changed.
- [ ] axe is clean on the changed screens; manual VoiceOver/TalkBack pass or "not run".
- [ ] Every Console change keeps the security tests from `agent-console-security` passing.
- [ ] Post-deploy smoke, `@prod` specs and Lighthouse met on the main deploy; the previous deploy is publishable.
- [ ] Report the exact commands and results. Anything not run is "not run", never PASS.
