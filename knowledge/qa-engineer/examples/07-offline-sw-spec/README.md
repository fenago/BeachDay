# Example 07 — Offline and service-worker spec (Chromium), install-hint snooze, SW update

## What it demonstrates
`tests/offline.spec.mjs` is the Chromium-only offline spec with Pip's cases (docs/02 §5, docs/06 §4.3), run against a **test-double** service worker (`site/sw.js`) that follows the docs/02 table. The real `public/sw.js` does not exist yet; keep the assertions, change the target.

- **Install:** shell precached as `beachday-shell-<VERSION>`, forecast in `beachday-data-v1`.
- **Never in Cache Storage:** after visiting them online, none of `/sw.js`, `/version.json`, `/api/*`, `/console*`, `/js/console/*`, `/vendor/*`, `/generated/*`, `*.supabase.co` appears in any cache.
- **Offline shell for `/?source=pwa`** (the installed `start_url`): `response.fromServiceWorker()`, the cached forecast and the "Offline — showing data from …" banner. This needs `{ ignoreSearch: true }` in the SW.
- **Offline `/console`, `/console.html` and in-page fetches of `/vendor/*`, `/sw.js`, `/version.json`, `/api/*`, `/generated/config.js` fail** with a network error, never the beach shell.
- **Update flow:** a "deploy" (the server stamps a new `__BUILD_VERSION__`, like `scripts/stamp-sw.mjs`) changes the `sw.js` bytes; the new worker waits; `SKIP_WAITING` swaps it once; the old shell cache is deleted on `activate`.
- **14-day snooze** of the iPhone install hint with `page.clock`: hidden at +1 h and at +13 d 23 h 59 min 59.999 s, shown at exactly +14 d; never shown standalone. (The hint is a stand-in too.)
- **Mutants:** a SW without `ignoreSearch` serves `offline.html` for `/?source=pwa`; a SW that precaches `/console.html`, `/vendor/auth.mjs` and `/version.json` is caught by the Cache Storage check (3 forbidden entries).

## Findings from running it
1. **`context.setOffline(true)` does not stop a fulfilling `context.route` from answering the service worker's own request.** With a `fulfill` route still registered, the handler ran once, the page showed fresh data and no offline banner. An offline spec built that way passes for the wrong reason. Swap the route for `route.abort("internetdisconnected")` (or remove it) and the SW falls back to Cache Storage. `goOffline()` in the spec does the swap; the "observed" test asserts both halves. This answers the item marked UNVERIFIED in `docs/02-playwright-network-mocking-sw-offline.md`.
2. **The SW does not claim clients on first install** (Pip: no unconditional `skipWaiting()`/`clients.claim()`), so the helper reloads once before asserting `navigator.serviceWorker.controller`.
3. **`page.clock.install({ time })` keeps the clock running.** To test "exactly 14 days" call `page.clock.setFixedTime(T0)` right after it, or the click lands a few milliseconds after T0 and the boundary is off by those milliseconds. My first run failed for exactly that reason.
4. **One worker only.** The specs share one server whose "deploy" version and mutant flag they change. With two workers, a repeat run failed (`const VERSION = "v1"` expected, `v2` received). `workers: 1` is in the config; 90 of 90 passed over ten repeats after that.
5. My first "no ignoreSearch" mutant did nothing, because the fallback called `caches.match("/")` (a string key, which matches without `ignoreSearch`). The real bug is `caches.match(event.request)` for a navigation to `/?source=pwa`, so the SW double and the mutant now use the request.

## Run
```bash
cd knowledge/qa-engineer/examples/07-offline-sw-spec
npm install                 # @playwright/test 1.63.0, matching the preinstalled Playwright and its Chromium
npx playwright test --trace off
```
Reads the forecast fixture from `../01-playwright-mobile-mock/fixtures/`.

## Verified
Run 2026-11-23, Node v22.23.5, `@playwright/test@1.63.0`, Chromium (`/opt/pw-browsers/chromium-1243`), from a scratch copy:
```
Running 9 tests using 1 worker
  ✓  1 installs: shell precached under a versioned name, forecast cached; network-only paths stay out of Cache Storage ...
  ✓  2 offline: /?source=pwa (the installed start_url) gets the cached shell and the last forecast with an offline banner
  ✓  3 offline: /console, /vendor/*, /sw.js, /version.json and /api/* fail with a network error and never return the beach shell
  ✓  4 observed: setOffline(true) does NOT stop a fulfilling context.route from answering the SW's own fetch; ...
  ✓  5 update flow: a new deploy changes sw.js bytes; the new worker waits; SKIP_WAITING swaps it; the old shell cache is deleted
  ✓  6 mutant: a SW that forgets ignoreSearch serves offline.html for /?source=pwa, and the shell assertion would fail
  caught: beachday-shell-v1: 127.0.0.1:4174/console.html | beachday-shell-v1: 127.0.0.1:4174/vendor/auth.mjs | beachday-shell-v1: 127.0.0.1:4174/version.json
  ✓  7 mutant: a SW that precaches the Console, the vendored auth client and version.json is caught by the Cache Storage check
  ✓  8 install hint snooze › hidden until exactly 14 days have passed, then shown again
  ✓  9 install hint snooze › not shown when launched standalone (installed app)
  9 passed (4.2s)
$ npx playwright test --trace off --repeat-each=10    ->  90 passed (39.8s)
```
**Not run:** WebKit (not installed; service workers are Chromium-only in Playwright anyway), a real iPhone or Pixel, and anything against the real `public/sw.js`. Cache Storage and `caches.match` behaviour on iOS Safari is not covered by Playwright's WebKit build.
