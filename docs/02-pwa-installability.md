# 02 — PWA installability on iPhone and Android (and when to go native)

> Researched 2026-11-23 from MDN, web.dev / developer.chrome.com, webkit.org and Apple/Google docs. **[UNVERIFIED]** marks items not confirmed against a primary source.

## 1. Summary for the team

* Beach Day ships as a **pure PWA** on Netlify. That is enough for both platforms: Android Chrome offers an install prompt; iOS users add it from the Share menu (and since iOS 26, every Home Screen site opens as a web app by default).
* **Required for install (Chromium):** HTTPS, a linked manifest with `name`/`short_name`, 192 px and 512 px icons, `start_url`, `display` (`standalone`), `prefer_related_applications` absent/false. A service worker is **not** required to be installable from the menu, but Chrome's **automatic install prompt still wants a real, non-empty `fetch` handler** (last stated Dec 2023; **[UNVERIFIED]** whether still true) — and we want offline support anyway, so ship one.
* **iOS has no install prompt API.** Show our own "Add to Home Screen" hint on iOS Safari when not in standalone mode.
* **Go native (Capacitor) only if** we need App Store listing, reliable push to users who won't install, background location/alerts, or widgets. A thin wrapper risks App Store rejection (Guideline 4.2). For Play Store presence alone, a **Trusted Web Activity** (Bubblewrap/PWABuilder) is much cheaper.

## 2. Web app manifest

Sources: [Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [Manifest reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest), [icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons), [maskable icons](https://web.dev/articles/maskable-icon), [screenshots](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/screenshots).

```json
{
  "id": "/",
  "name": "Beach Day",
  "short_name": "Beach Day",
  "description": "Is today a good beach day in South Florida?",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0b3b5c",
  "theme_color": "#0b3b5c",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "screenshots": [
    { "src": "/screens/today.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "Today's beach verdict" }
  ],
  "shortcuts": [
    { "name": "Agent Console", "url": "/console", "icons": [{ "src": "/icons/console-96.png", "sizes": "96x96" }] }
  ]
}
```

* Every page links it: `<link rel="manifest" href="/manifest.webmanifest">`. Serve as `application/manifest+json` (set explicitly in `_headers`; Netlify's default type is **[UNVERIFIED]**).
* **Maskable icons:** key content inside the central circle of radius 40 % of the width; outer 10 % may be cropped. Ship separate `any` and `maskable` files (a padded maskable icon looks small unmasked — common practice, **[UNVERIFIED]** in the sources). Test at maskable.app / DevTools.
* `description` and `screenshots` show in the richer install sheet **on Android only**. Exact screenshot size rules **[UNVERIFIED]**.
* iOS ignores `background_color`, `description`, `orientation`, `shortcuts` and `display_override`; it honors `name`, `short_name`, `start_url`, `scope`, `display: standalone` (11.3+), `theme_color` (15+), `icons` (15.4+), `id` (16.4+).
* Splash screen is generated from `name`, `background_color` and icons (Android).

## 3. iOS / iPadOS specifics

| Topic | Fact | Source |
|---|---|---|
| Install | Share → Add to Home Screen. From iOS 16.4 also from Chrome, Edge, Firefox, Orion. No `beforeinstallprompt`. | [MDN installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) |
| iOS 26 | "By default, every website added to the Home Screen opens as a web app"; user can turn off "Open as Web App". | [WebKit WWDC25](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/) |
| Web Push | iOS 16.4+, **only for Home Screen web apps**, permission only after a user tap; uses APNs; also Badging API and manifest `id`. | [WebKit Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| Icon | Add `<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">` (manifest icons only since 15.4). | [Apple archive](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) |
| Status bar | `apple-mobile-web-app-status-bar-style` = `default` / `black` / `black-translucent` (optional polish; deprecation of `black-translucent` **[UNVERIFIED]**). | Apple archive |
| Storage | Non-installed sites: all script-writable storage (incl. SW caches) deleted after 7 days of Safari use without interaction. Home Screen apps have their own counter and are not expected to be cleared. Quotas up to 60 % of disk per origin (Safari 17+); `navigator.storage.persist()` supported. | [WebKit ITP 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), [WebKit storage 2023](https://webkit.org/blog/14403/updates-to-storage-policy/) |
| EU (DMA) | Apple removed Home Screen web apps in iOS 17.4 betas, then reversed on 1 Mar 2024 — they still work in the EU. | Press: [TechCrunch](https://techcrunch.com/2024/03/01/apple-reverses-decision-about-blocking-web-apps-on-iphones-in-the-eu/) (not a webkit.org source) |
| Mac | Safari 17+ File → Add to Dock for any site. | MDN |

**Implications:** saved beaches (localStorage) and cached forecasts may vanish for users who never install — treat them as a convenience, not durable data. Show the iOS install hint when `matchMedia('(display-mode: standalone)').matches` is false (and `navigator.standalone` is falsy on older iOS).

## 4. Android specifics

* Chrome (with Google Mobile Services) and Samsung Internet install as a **WebAPK** (real app entry, appears in app drawer). Firefox, Edge, Opera, or Chrome without GMS add a browser-badged shortcut. [web.dev installation](https://web.dev/learn/pwa/installation)
* Chrome's install promotion needs: not already installed, ≥1 click/tap and ≥30 s on the page, HTTPS, the manifest fields above. [install criteria](https://web.dev/articles/install-criteria)
* Since Chrome 108 (mobile) a `fetch` handler isn't required for menu install; Chrome shows a default offline page. But the auto-prompt algorithm still required a non-no-op `fetch` handler as of the announcement. [update-install-criteria](https://developer.chrome.com/blog/update-install-criteria)
* Custom install button: capture `beforeinstallprompt`, `preventDefault()`, later call `prompt()` from a click. Supported in Chrome/Edge/Samsung; not Firefox or Safari. [MDN event](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)

## 5. Service worker plan

Sources: [MDN Caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching), [SW lifecycle](https://web.dev/articles/service-worker-lifecycle).

| Request | Strategy | Why |
|---|---|---|
| App shell (HTML, CSS, JS, icons, offline page) | **Precache** at install (cache-first) | Never changes within a version |
| Open-Meteo forecast & marine (`api.open-meteo.com`, `marine-api.open-meteo.com`) | **Network-first**, fallback to cache, with a 3–5 s timeout; show "last updated …" | Freshness matters but stale beats nothing at the beach |
| `/api/*` (Agent Console) | **Network-only**, never cached | Auth'd, private, streaming |
| Images/fonts | Stale-while-revalidate | Responsiveness |

Update flow (avoid stale apps after a Netlify deploy):

1. Keep `sw.js` at a **stable URL**; embed the build version so each deploy changes its bytes (`const VERSION = "2026-11-23T…"`).
2. Versioned cache names (`beachday-shell-<VERSION>`); delete old caches in `activate`.
3. Don't blindly `skipWaiting()` + `clients.claim()` (a page with old assets can be controlled by a new SW → 404s on removed files). Instead: detect a waiting SW → show "New version available — Refresh" → `postMessage({type:"SKIP_WAITING"})` → reload on `controllerchange`.
4. Browsers ignore HTTP caching for SW update checks by default (Chrome 68+), but still set `/sw.js  Cache-Control: no-cache` in `_headers` as a guard. Netlify's default for static files is already `max-age=0, must-revalidate`, and every deploy invalidates the CDN. [Netlify caching](https://docs.netlify.com/build/caching/caching-overview/)

## 6. Native wrapper decision

Sources: [Capacitor docs](https://capacitorjs.com/docs), [push plugin](https://capacitorjs.com/docs/apis/push-notifications), [Background Runner](https://capacitorjs.com/docs/apis/background-runner), [App Store Guidelines 4.2](https://developer.apple.com/app-store/review/guidelines/), [Apple Developer Program](https://developer.apple.com/programs/whats-included/), [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap), [TWA for web devs](https://developer.chrome.com/docs/android/trusted-web-activity/android-for-web-devs), [PWABuilder](https://docs.pwabuilder.com/#/builder/app-store).

| Need | Pure PWA | TWA (Android, Bubblewrap/PWABuilder) | Capacitor (iOS + Android) |
|---|---|---|---|
| Install from browser | ✓ (Android prompt; iOS via Share) | — | — |
| Store listing | ✗ | Play Store ($25 one-time) | App Store ($99/yr) + Play |
| Push on iOS | Only if installed, iOS 16.4+ | — | ✓ native APNs |
| Push on Android | ✓ Web Push | ✓ | ✓ FCM |
| Background tasks | Very limited | As web | Background Runner (iOS ~30 s/run, OS decides; Android ≥15 min interval) |
| Widgets | ✗ | ✗ | Needs custom Swift/Kotlin (**[UNVERIFIED]** no core plugin) |
| Review risk | None | Low | Guideline 4.2: must be more than "a repackaged website" |
| Updates | Instant on deploy | Web layer instant | Web layer can update; native changes need review |
| Effort | Lowest | Keystore + `/.well-known/assetlinks.json` (strict JSON) | Mac + Xcode, signing, two pipelines |

**Recommendation:** pure PWA now. Add a TWA if Play Store presence becomes a goal. Consider Capacitor only for a concrete native feature (e.g. "alert me at 7 am when Saturday turns into a great beach day" for users who won't install), and then add enough native value to pass Guideline 4.2.

## 7. Verifying installability

* **Lighthouse removed its PWA category in v12 (Apr 2024)** — don't look for a PWA score. [release notes](https://github.com/GoogleChrome/lighthouse/releases/tag/v12.0.0)
* Use **Chrome DevTools → Application**: Manifest pane (Installability errors, maskable safe-area preview), Service Workers (update on reload, bypass, offline), Cache Storage, Clear storage. [DevTools PWA](https://developer.chrome.com/docs/devtools/progressive-web-apps)
* iOS: Safari Web Inspector against a real iPhone (or the Simulator); test Add to Home Screen, standalone launch, offline launch and the iOS hint.
* Check deployed headers: `curl -I https://<site>/manifest.webmanifest` and `/sw.js`.
* Automated checks are in doc 06.
