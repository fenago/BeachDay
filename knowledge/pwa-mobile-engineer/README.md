# Knowledge: pwa-mobile-engineer
Date: 2026-11-23. Notes come from MDN, web.dev, developer.chrome.com and webkit.org (each file lists its sources). Examples were run with Node 22 and Playwright 1.63 (Chromium); outputs are in each example's README. Read everything here before any manifest, service worker, offline or install task.

## docs/
| File | Covers | Read when |
|---|---|---|
| [docs/01-installability-criteria.md](docs/01-installability-criteria.md) | Chromium required manifest members, Chrome engagement heuristics, HTTPS/localhost, fetch-handler rule (menu vs prompt), per-browser install support incl. WebAPK and iOS 16.4 | Deciding if/why the app is (not) installable |
| [docs/02-manifest-icons-screenshots.md](docs/02-manifest-icons-screenshots.md) | Manifest MIME/linking, Beach Day member values, `icons` fields and `purpose`, maskable safe zone (40% radius), `apple-touch-icon`, `screenshots` fields | Editing `manifest.webmanifest`, icons or screenshots |
| [docs/03-service-worker-lifecycle-updates.md](docs/03-service-worker-lifecycle-updates.md) | install/activate/waiting, update triggers (navigation, 24 h, byte-diff, `updateViaCache`), `skipWaiting`/`clients.claim` trade-offs, the tested SKIP_WAITING toast flow | Changing `sw.js`, release/update behaviour |
| [docs/04-caching-strategies.md](docs/04-caching-strategies.md) | MDN cache-first / SWR / network-first / network-only, clone rule, quota/eviction, Beach Day per-request strategy table, network-first-with-timeout code | Adding or changing anything cached; offline states |
| [docs/05-install-prompts-display-mode.md](docs/05-install-prompts-display-mode.md) | `beforeinstallprompt` pattern and status, Android WebAPK vs shortcut, `display-mode` values and use | Install button, standalone-only UI |
| [docs/06-ios-home-screen-web-apps.md](docs/06-ios-home-screen-web-apps.md) | No iOS prompt, Add to Home Screen steps, 16.4 (third-party browsers, push on user gesture, badging, `id`), iOS 26 "Open as Web App" for every site, frozen UA, hint matrix | iOS install hint, iOS-specific behaviour, push questions |

## examples/
| Folder | Shows | Read when |
|---|---|---|
| [examples/01-manifest-validator/](examples/01-manifest-validator/) | Valid Beach Day manifest + Node validator (install criteria, Beach Day rules, real PNG sizes) + icon generator; 5 tests | Before shipping any manifest/icon change; CI check |
| [examples/02-service-worker/](examples/02-service-worker/) | Full `sw.js` + `app.js` update toast + Netlify-like server; Playwright proves registration, cache contents, 4 s timeout fallback, offline reload, `/api/*` never cached, v1→v2 update with one reload | Writing/reviewing `public/sw.js`; QA offline spec |
| [examples/03-install-prompt/](examples/03-install-prompt/) | `beforeinstallprompt` controller + iOS hint detection (Safari/Chrome/in-app/iPadOS/standalone, 14-day snooze); 7 tests | Building install UX |

## Key facts (one line each)
- Chromium install: name/short_name, 192+512 icons, start_url, installable display, no prefer_related_applications, HTTPS.
- Chrome's automatic prompt wanted a real (non-empty) fetch handler as of Dec 2023 (**UNVERIFIED** now; sources unreachable 2026-11-23); menu install does not. We ship a real handler.
- Chrome needs only 192 + 512 icons; the separate maskable icon, `id`, `scope`, screenshot are Beach Day's own rules. No `shortcuts` (no `/console` shortcut). `theme_color` = `background_color` = `#0b3b5c` (Sable); maskable and apple-touch icons are full-bleed `#0b3b5c`.
- `start_url` is `/?source=pwa`, so `sw.js` matches the shell with `ignoreSearch: true`. iOS hint snooze is 14 days.
- `sw.js` is deny-listed and its version is stamped at build (docs/03).
- Maskable key art inside a centred circle of radius 40% of the width.
- New SW waits until no client uses the old one; we skipWaiting only on the user's Refresh tap, then reload once on `controllerchange`.
- `/api/*` is network-only and never cached; Open-Meteo is network-first with a 4 s timeout.
- iOS: no install prompt; iOS 16.4+ any browser's Share → Add to Home Screen; iOS 26 opens every added site as a web app unless the user turns "Open as Web App" off.
