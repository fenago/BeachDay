# Installability criteria (Chromium, Safari, Firefox)
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
Source: https://web.dev/articles/install-criteria
Source: https://developer.chrome.com/blog/update-install-criteria
Retrieved: 2026-11-23

## Chromium (Chrome, Edge, Samsung Internet): required manifest members
MDN lists, for Chromium-based browsers:
- `name` **or** `short_name`
- `icons` — "must contain a 192px and a 512px icon"
- `start_url`
- `display` and/or `display_override`
- `prefer_related_applications` — "must be `false` or not present"

web.dev adds that `display` "must be one of `fullscreen`, `standalone`, `minimal-ui`, or `window-controls-overlay`" (so `browser` is not installable).

## Chrome: when `beforeinstallprompt` fires / the install promotion shows
From web.dev install-criteria (last updated 2024-09-19), Chrome needs all of:
- "The web app is not already installed."
- User engagement heuristics: "clicked or tapped on the page at least once, at any time, even during a previous page load" **and** "spent at least 30 seconds viewing the page, at any time."
- "Be served over HTTPS."
- The manifest members above.

## The service-worker / fetch-handler question
From the Chrome blog "Revisiting Chrome's installability criteria" (2023-12-05):
- Chrome removed the service-worker-with-`fetch` requirement for **installing from the browser menu** "since version 108 on mobile and 112 on Desktop".
- Chrome "eventually mitigated the problem by ignoring empty handlers" (sites had added no-op fetch handlers just to pass).
- But: "For now the algorithm that displays the install prompt still requires the presence of a `fetch()` handler". So the **automatic** prompt / `beforeinstallprompt` path still wants a real, non-empty fetch handler.
- Chrome ships a default offline page for sites without their own.
- Lighthouse's PWA category was removed because it mirrored these criteria; use DevTools (Application panel) instead.
**[UNVERIFIED]** whether Chrome has changed the fetch-handler rule for the prompt since that post; the post is the latest official statement found.

## Secure origin
MDN: must be served over `https`, or from `localhost` / `127.0.0.1` (any port). This is stricter than "secure context" (which also counts `file://`). Netlify serves HTTPS by default, and our Playwright tests use `http://127.0.0.1:<port>`.

## Other browsers (MDN "Browser support", page modified 2026-10-06)
Desktop:
- Chromium: installs PWAs with a manifest on all supported desktop OSes.
- Safari: "Add to Dock" on macOS Sonoma (Safari 17)+, with or without a manifest.
- Firefox: "does not support installing PWAs using a manifest file."
Mobile:
- Android: only Chrome on devices with Google Mobile Services and Samsung Internet on Samsung devices install as **WebAPKs** (real launcher entry, app switcher, settings). Firefox, Edge, Opera and others (and Chrome without GMS) add a **browser-badged shortcut** that opens in the browser.
- iOS ≤ 16.3: Safari only. iOS ≥ 16.4: Share menu → Add to Home Screen in Safari, Chrome, Edge, Firefox, Orion.
- Chrome (desktop + Android), Safari desktop and Edge desktop also let users install *any* site, manifest or not; a manifest makes the browser actively promote it and lets you customise install.

## In-page install UI
Chromium fires `beforeinstallprompt` "as soon as the browser has determined that the PWA is installable"; call `preventDefault()`, keep the event, show your own button, call `prompt()` on click. MDN: "This is not supported on iOS." Details in 05-install-prompts-display-mode.md.

Android only: if the manifest has `description` and `screenshots`, they are shown in the install prompt (MDN "Customizing the installation prompt").

## How to verify
- DevTools → Application → Manifest shows installability errors; Service Workers pane; Cache Storage.
- Our scripted check: `examples/01-manifest-validator/validate-manifest.mjs` (manifest fields + icon files/sizes).
- Engagement heuristics make `beforeinstallprompt` hard to trigger in automation; test the controller logic with a synthetic event (`examples/03-install-prompt`).

## Beach Day notes
- Manifest must meet every Chromium bullet above plus our own: separate `maskable` 512 icon, `id: "/"`, `scope: "/"`, narrow screenshot with a `label`, `description` (Android rich install UI).
- `sw.js` must have a real fetch handler (it does: Open-Meteo network-first, shell cache-first, navigation fallback). Never ship an empty handler "for install".
- The install button stays hidden until `beforeinstallprompt`; on iOS show the Add to Home Screen hint instead (06-ios-home-screen-web-apps.md).
- Netlify Free serves HTTPS on the `*.netlify.app` domain and custom domains (ADR-0004); nothing extra needed for the secure-origin rule.
