# Example 02: service worker with versioned caches, Open-Meteo network-first + timeout, network-only /api, SKIP_WAITING update flow — proven in Chromium

## What it shows
`public/sw.js`:
- Precaches the shell (`/`, `/app.js`, `/offline.html`, `/manifest.webmanifest`) into `beachday-shell-${VERSION}` on install, with `cache: "reload"`; **no** automatic `skipWaiting()`.
- `api.open-meteo.com` / `marine-api.open-meteo.com`: network-first with a **4 s timeout**, falls back to `beachday-data-v1`; stamps `x-bd-fetched-at` for "Updated hh:mm"; keeps refreshing the cache via `event.waitUntil` after a timeout; caches only `ok`, non-opaque responses; trims to 20 entries.
- Same-origin `/api/*` (the Agent Console's Netlify Functions): **not intercepted, never cached**. Non-GET requests are not intercepted.
- Navigations: network, then cached shell, then `offline.html`.
- `activate` deletes old `beachday-shell-*` caches only (data cache survives deploys).
- `message`: `SKIP_WAITING` → `self.skipWaiting()`; `GET_VERSION` (used by the test).

`public/app.js`: registers after `load`, detects a waiting worker (`reg.waiting` or `updatefound` → `installed` with an existing controller), shows a `role="status"` toast, posts `SKIP_WAITING` on tap, reloads exactly once on `controllerchange`.

`server.mjs`: mimics Netlify — replaces `const VERSION = "__BUILD_VERSION__"` at serve time (the build step), sends `Cache-Control: no-cache` for `/sw.js`, `application/manifest+json` for the manifest, and a fake `/api/hello` function with `no-store`.

`sw-test.mjs`: Playwright (Chromium) script. Open-Meteo is mocked with `context.route()` (Chromium routes service-worker fetches through the context), with CORS headers; no real network calls.

Why it is "what good looks like": matches the pwa-manifest-service-worker skill exactly, follows MDN's caching guide (clone before put, only cache `ok`) and web.dev's lifecycle guidance (stable SW URL, byte-changed per deploy, user-triggered `skipWaiting`), and every claim is checked in a real browser including offline.

## Run
```bash
cd knowledge/pwa-mobile-engineer/examples/02-service-worker
node sw-test.mjs                # headless Chromium from the preinstalled global playwright
VERSION=dev node server.mjs     # optional: serve it at http://localhost:8080/ and poke at DevTools
```
No `npm install` (uses the global `playwright` via `createRequire`; NODE_PATH points at it here). This is a plain Playwright library script, not `@playwright/test`, so there is no trace to switch off; if you port it to the test runner, run with `--trace off`. The example manifest has no icons on purpose; see example 01 for the real one.

## Verified
Command: `node sw-test.mjs` (Node v22.23.5, Playwright 1.63.0, Chromium build 1243), earlier runs 3 times on 2026-11-23, re-run once after adding the `/?source=pwa` offline-launch check (step 4b); all passed:
```
✔ registered, scope http://127.0.0.1:39349/ state activated version v1, page controlled
✔ caches: {"beachday-shell-v1":["/","/app.js","/manifest.webmanifest","/offline.html"],"beachday-data-v1":["https://api.open-meteo.com/v1/forecast?latitude=25.781&longitude=-80.13&daily=sunrise,sunset&timezone=America%2FNew_York&forecast_days=1"]}
✔ slow network: answered from cache in 4011 ms; status = "Network slow — showing data from 12:30 PM"
✔ offline reload: shell from cache, status = "Offline — showing data from 12:30 PM", /api/hello -> failed
✔ offline launch at /?source=pwa: shell served from the "/" precache (ignoreSearch)
✔ update found: v2 waiting, toast shown, page still on v1
✔ after Refresh: version v2, reloads=1, caches=beachday-data-v1, beachday-shell-v2

ALL CHECKS PASSED (Open-Meteo mock hits: 7)
```
The offline step stops the static server **and** calls `context.setOffline(true)` **and** aborts Open-Meteo, so nothing but the SW caches can answer.
Not verified: WebKit/iOS behaviour (Playwright's WebKit does not stand in for iOS Safari service workers); test on a real iPhone.

Colour update (wave 2): `theme_color`, `background_color` and the page `theme-color` meta are now `#0b3b5c`. Re-run of `node sw-test.mjs` on 2026-11-23: ALL CHECKS PASSED (Open-Meteo mock hits: 7).

ADR-0006 update (2026-11-23): `sw.js` now also leaves `/sw.js`, `/version.json`, `/generated/*`, `/vendor/*`, `/console*`, `/js/console/*` and `*.supabase.co` alone (not intercepted, not precached). `sw-test.mjs` adds step 2b (none of those in Cache Storage), an offline check that the vendored bundle fails, and a check that `/version.json` is fresh through the old worker. Re-run: ALL CHECKS PASSED (Open-Meteo mock hits: 7). The Supabase host rule is a suffix match and is not exercised by the test; custom Supabase domains are UNVERIFIED and would need adding.
