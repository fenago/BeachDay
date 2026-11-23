---
name: ios-android-install-behavior
description: How installing Beach Day actually works on iPhone/iPad and Android — install criteria, prompts, the iOS Add to Home Screen hint, storage eviction, push limits, and when a TWA or Capacitor wrapper is justified. Use when designing install UX, testing installs, or evaluating native wrappers.
---
# Install behavior by platform (details: docs/02 §3–4, §6)

## Android
- Chrome (with Google Mobile Services) and Samsung Internet install the app as a **WebAPK**, a real app entry. Other browsers add a badged shortcut instead.
- **Chrome shows its install promotion only when all of these hold:**
  - the app is not installed yet;
  - the user tapped at least once and spent at least 30 s on the page;
  - the page is served over HTTPS;
  - the manifest fields are present;
  - the service worker has a non-empty `fetch` handler.
- **Custom install button:**
  1. Listen for `beforeinstallprompt` and call `e.preventDefault()`.
  2. Store the event.
  3. Show an "Install" button.
  4. On click, call `e.prompt()` and await `userChoice`.
  - This works in Chrome, Edge and Samsung Internet. It does not work in Firefox or Safari.
- `description` and `screenshots` show in the richer install sheet on Android only.

## iOS / iPadOS
- **There is no `beforeinstallprompt`.** Install is manual: Share → Add to Home Screen. Since iOS 16.4 this also works from Chrome, Edge and Firefox on iOS.
- **iOS 26:** every site added to the Home Screen opens as a web app by default. The user can switch off "Open as Web App".
- **Show the Beach Day hint** (a sheet that shows the Share icon and steps) when all of these are true:
  - iOS;
  - `!matchMedia('(display-mode: standalone)').matches && !navigator.standalone`;
  - not dismissed in the last 14 days.
- **Ignored on iOS:** `background_color`, `orientation`, `shortcuts`, `description`. Supply `apple-touch-icon` at 180 × 180.
- **Storage:** sites that aren't installed lose all script-writable storage, including SW caches, after 7 days of Safari use without visiting. Installed apps aren't expected to be cleared. Treat favorites as disposable and offer "Install to keep your beaches".
- **Web Push** works only for installed Home Screen apps (iOS 16.4+), and only after a user tap. It is not in v1.
- **EU:** Home Screen web apps still work. Apple reversed its iOS 17.4 removal in March 2024.

## Detecting install state
- Check `matchMedia('(display-mode: standalone)')`.
- Listen for the `appinstalled` event (Chromium).
- Add `?source=pwa` to `start_url` to tell launches apart in analytics, if analytics are ever added. There are none in v1.

## When to go native
| Need | Path |
|---|---|
| Only Play Store presence | Trusted Web Activity via Bubblewrap/PWABuilder: $25 once, plus `/.well-known/assetlinks.json` (strict JSON) |
| App Store listing, reliable push without install, background alerts, widgets | Capacitor: $99/yr Apple fee, a Mac with Xcode, and two store pipelines. Must add native value to pass App Store Guideline 4.2, which rejects a "repackaged website" |
| Everything else | Stay a PWA (current decision) |

## Manual test matrix (each release)
- **iPhone, Safari:** install, launch standalone, rotate, go offline, relaunch.
- **Android, Chrome:** install prompt, WebAPK in the app drawer, offline launch, update toast.
