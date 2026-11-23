---
name: pwa-manifest-service-worker
description: Beach Day web app manifest, icons and service worker — caching strategies per request type, versioned caches, the safe update flow, offline page, and Netlify headers for sw.js and the manifest. Use when touching manifest.webmanifest, sw.js, icons, offline behavior or install readiness.
---
# Manifest & service worker (details: docs/02 §2, §5)

## Manifest — `public/manifest.webmanifest`
- **Required for Chromium install:**
  - `name` / `short_name`
  - `icons`: 192 and 512 px with `purpose: any`, **plus** a separate 512 px `maskable`
  - `start_url`
  - `display: standalone`
  - `prefer_related_applications` absent
- **Also set:** `id: "/"`, `scope: "/"`, `theme_color`, `background_color`, `description`, `screenshots` (narrow), and a shortcut to `/console`.
- **Maskable icons:** keep key art inside the centre circle (radius 40% of the width). The outer 10% may be cropped.
- **Link it from every page:** `<link rel="manifest" href="/manifest.webmanifest">`. Also add `<link rel="apple-touch-icon" sizes="180x180" ...>`.
- **Headers** (in `_headers`):
  - `/manifest.webmanifest` → `Content-Type: application/manifest+json`
  - `/sw.js` → `Cache-Control: no-cache`

## Caching strategy
| Request | Strategy |
|---|---|
| App shell (HTML, CSS, JS, icons, `offline.html`) | Precache on install |
| `api.open-meteo.com`, `marine-api.open-meteo.com` | Network-first with a 4 s timeout, then cache; record fetch time for "Updated hh:mm" |
| `/api/*` (Console) | **Network-only, never cached** |
| Other images | Stale-while-revalidate |

Chrome's automatic install prompt wants a **real, non-empty `fetch` handler**. Ship one.

## Versioning & updates
- `sw.js` stays at a **stable URL**. Embed a build version so every deploy changes its bytes: `const VERSION = "__BUILD_VERSION__";`
- Name caches `beachday-shell-${VERSION}` and `beachday-data-v1`. In `activate`, delete old shell caches.
- **Don't** call `skipWaiting()` and `clients.claim()` unconditionally. Instead:
  1. The page detects a `registration.waiting` worker.
  2. It shows a toast: "New version — Refresh".
  3. On tap, it calls `waiting.postMessage({type: "SKIP_WAITING"})`.
  4. The SW calls `self.skipWaiting()`.
  5. The page reloads once on `controllerchange`.
- Register after load: `navigator.serviceWorker.register("/sw.js", { scope: "/" })`.

## Offline
- **Offline navigation:** serve the cached shell, which renders the last cached forecast with "Offline — showing data from 8:15 am".
- **Nothing cached yet:** serve `offline.html`.
- **Storage limits:** ask `navigator.storage.persist()` after the app is installed. Keep the data cache small: favorites only, latest response per beach.

## Verify
- Lighthouse v12+ has no PWA category. Use **DevTools → Application** instead: Manifest installability, the Service Workers pane, and Cache Storage.
- Run `curl -I` on `/sw.js` and `/manifest.webmanifest` against the deploy.
- The Playwright offline spec runs on Chromium only (see `testing-vitest-playwright`).
