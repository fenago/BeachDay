# Service worker lifecycle, updates and the SKIP_WAITING flow
Source: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
Source: https://web.dev/articles/service-worker-lifecycle
Retrieved: 2026-11-23

## Basics (MDN Service Worker API)
- Secure contexts only: HTTPS, or `http://localhost` for development.
- Fully asynchronous: "synchronous XHR and Web Storage can't be used inside a service worker" — no `localStorage` in `sw.js`; use Cache Storage / IndexedDB.
- Registered with `navigator.serviceWorker.register()`; controls URLs in its scope (whole origin or a subset).
- Download happens on first visit, and when "an event is fired on the service worker and it hasn't been downloaded in the last 24 hours."
- If a worker already exists, the new one installs in the background and becomes the "worker in waiting"; it activates "when there are no longer any pages loaded that are still using the old service worker", or sooner via `skipWaiting()`; `Clients.claim()` lets the active worker take existing pages.
- Key interfaces: `Cache`, `CacheStorage`, `Client`, `Clients`, `FetchEvent`, `ServiceWorkerRegistration`.

## Lifecycle details (web.dev)
**install**
- "the first event a service worker gets, and it only happens once." Pass a promise to `event.waitUntil()`; if it rejects, "the browser throws the service worker away. It'll never control clients." → precache here.
- Until installed and active, it gets no `fetch`/`push` events.
**First load is not controlled**: "By default, a page's fetches won't go through a service worker unless the page request itself went through a service worker." Reload (or `clients.claim()`) to be controlled. Our Playwright test reloads once before asserting control.
**activate**
- Fires once the old worker is gone: "the ideal time to … [clear] caches." `waitUntil()` in activate buffers fetch events until done.
**Update checks** — triggered by:
- a navigation to an in-scope page;
- functional events (push, sync) unless checked within the previous 24 hours;
- `.register()` with a changed URL — but "you should avoid changing the worker URL".
- manual `reg.update()` (web.dev suggests e.g. hourly for long-lived pages).
**What counts as an update**: the script is "byte-different" (being extended to imported scripts/modules). Chrome 68+ ignores HTTP caching headers when checking the registered SW script by default (still honoured for `importScripts()`); override with `updateViaCache` on register.
**Failure safety**: a new worker with a non-OK status (e.g. 404), parse error, runtime error or install rejection "is thrown away, but the current one remains active."
**waiting**: "the updated worker will wait until the existing worker is controlling zero clients." A refresh is not enough because the old and new page overlap during navigation; all tabs must close/navigate away.
**skipWaiting()**: "prevents the waiting, meaning the service worker activates as soon as it's finished installing." It "doesn't cause your worker to skip installing, just waiting." Common to call in install, "But you may want to call it as a result of a postMessage() to the service worker … following a user interaction." Like `clients.claim()` it is a race with the page's own requests.
**controllerchange**: fires on `navigator.serviceWorker` when the controlling worker changes, e.g. after skipWaiting.
**clients.claim() caution**: if the SW changes how pages load, claiming pages that loaded without it "can be troublesome".

## The Beach Day update flow (implemented and tested in examples/02-service-worker)
1. Build injects a version: `const VERSION = "__BUILD_VERSION__"` → bytes change every deploy; URL stays `/sw.js`. The stamp comes from `COMMIT_REF` in a build step; its design, fallback and smoke test are in `docs/03-architecture-netlify.md` (netlify-engineer), not repeated here. `public/sw.js` and every file it imports are deny-listed for Console proposals.
2. New worker installs, precaches `beachday-shell-${VERSION}`, then **waits** (no skipWaiting in install).
3. Page sees `reg.waiting` (or `updatefound` → `statechange` = `installed` while a controller exists) → shows toast "New version available. Refresh" (`role="status"`).
4. Tap → `reg.waiting.postMessage({type: "SKIP_WAITING"})` → SW calls `self.skipWaiting()`.
5. New worker activates, deletes old `beachday-shell-*` caches (keeps `beachday-data-v1`).
6. Page listens for `controllerchange` and reloads **once** (guard flag prevents loops).
Verified by Playwright: v2 waits while v1 controls; both shell caches exist while waiting; after tap exactly one reload; version v2; caches = `beachday-data-v1`, `beachday-shell-v2`.

Why not `skipWaiting()` + `clients.claim()` unconditionally: the old page would keep running old JS against a new cache/shell mid-session; with user-triggered refresh the switch happens at a moment the user chose.

## Registration snippet
```js
window.addEventListener("load", () => {
  navigator.serviceWorker.register("/sw.js", { scope: "/" });
});
```
Registering after `load` keeps SW install/precache from competing with first paint **[UNVERIFIED: performance rationale is general guidance, not from the pages above]**.

## Beach Day notes
- Netlify `_headers`: `/sw.js` → `Cache-Control: no-cache` (belt and braces; Chrome ignores HTTP cache for the SW script by default, other browsers/proxies may not).
- Never rename `sw.js` per deploy.
- An install failure (one 404 in the precache list) silently keeps the old version: QA must check DevTools/Playwright after every shell file rename.
- Long-lived standalone sessions: optionally call `reg.update()` on `visibilitychange` → visible, at most hourly; never poll Open-Meteo (that is a data concern, not SW update).
- Every SW/manifest change needs a QA offline test (agent rules); hand off via `needs: qa-engineer`.
