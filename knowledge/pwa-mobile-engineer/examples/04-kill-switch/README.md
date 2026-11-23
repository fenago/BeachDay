# Example 04: emergency kill-switch service worker

`kill-sw.js` is the file shipped as `/sw.js` in an emergency (copied verbatim into `docs/runbooks/rollback.md`). Self-contained, no imports, **no fetch handler**: on install `skipWaiting()`; on activate it deletes every cache, unregisters itself and navigates every window client to its own URL.

`kill-test.mjs` (Playwright Chromium, reuses example 02's server): the page is controlled by a "bad" SW with caches; the kill file is swapped in at the same `/sw.js` URL; `registration.update()` fetches it. Run: `node kill-test.mjs`.

## Verified
Node v22.23.5, Playwright 1.63.0 Chromium, 2026-11-23:
```
✔ before: page controlled by bad sw, caches = beachday-shell-v-bad, beachday-data-v1
✔ after: registrations=0, caches=0, controlled=false, client reloaded (1 navigation), page still loads from network

KILL SWITCH CHECKS PASSED
```
Not verified: WebKit/iOS (use a real iPhone); an installed standalone app; the browser's own 24 h update-check bound (a navigation or `update()` triggers the check sooner).
