---
name: pwa-manifest-service-worker
description: Beach Day web app manifest, icons and service worker — caching strategies per request type, versioned caches, the safe update flow, offline page, and Netlify headers for sw.js and the manifest. Use when touching manifest.webmanifest, sw.js, icons, offline behavior or install readiness.
---
# Manifest & service worker (details: docs/02 §2, §5)

## Manifest — `public/manifest.webmanifest`
- **Required by Chromium to install** (MDN):
  - `name` / `short_name`
  - `icons`: a 192 px and a 512 px icon (Chrome needs nothing more)
  - `start_url`
  - `display: standalone` (any installable value)
  - `prefer_related_applications` absent or false
- **Beach Day's own rules** (ours, not Chrome's): the 192 and 512 icons use `purpose: any`, **plus** a separate 512 px `maskable` icon.
- **Also set:** `id: "/"`, `scope: "/"`, `start_url: "/?source=pwa"`, `theme_color`, `background_color`, `description`, and one `narrow` screenshot with a `label`.
- **No `shortcuts`.** Decision: there is no `/console` shortcut in the public manifest. (iOS ignores `shortcuts` anyway.)
- **File names** (match `knowledge/pwa-mobile-engineer/examples/01-manifest-validator/`):
  - `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png`
  - `/icons/apple-touch-icon-180.png`
  - `/screenshots/today-narrow-1080x2340.png`, declared `1080x2340`
- **Colours:** `theme_color` = `background_color` = `#0b3b5c` (Sable; see `liquid-glass-visual-design`, "Brand color for the PWA"). The maskable and apple-touch icons need a **full-bleed `#0b3b5c` background** so Android's splash (icon centred on `background_color`) shows no box edge. The page's `<meta name="theme-color">` matches.
- **Maskable icons:** keep key art inside the centre circle (radius 40% of the width). The outer 10% may be cropped.
- **Link it from every page:** `<link rel="manifest" href="/manifest.webmanifest">`. Also add `<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png">`.
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

- **Fetch handler:** a service worker is not needed for menu install (Chrome 108 mobile, 112 desktop). Chrome's December 2023 post said the automatic install prompt "still requires the presence of a `fetch()` handler" and that empty handlers are ignored. **UNVERIFIED** whether that is still true today (the source pages were unreachable on 2026-11-23). We ship a real, non-empty handler anyway, and never an empty one "for install".
- **`start_url` has a query string** (`/?source=pwa`). The precache holds `/`, so every shell lookup in `sw.js` must pass `{ ignoreSearch: true }` (navigation fallback and cache-first), or the installed app will miss the cache offline.

## Versioning & updates
- `sw.js` stays at a **stable URL**. Embed a build version so every deploy changes its bytes: `const VERSION = "__BUILD_VERSION__";`
- **The build stamps it.** `__BUILD_VERSION__` is replaced from `COMMIT_REF` by a build step; the design, fallback and smoke test are in `docs/03-architecture-netlify.md` (netlify-engineer). Don't duplicate them here.
- **`public/sw.js` is deny-listed for the Agent Console** (and so is every file it imports): it changes only through a human-reviewed commit.
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
