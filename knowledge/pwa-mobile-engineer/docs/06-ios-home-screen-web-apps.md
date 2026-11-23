# iOS / iPadOS Home Screen web apps (16.4 → 26)
Source: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
Source: https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
Source: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
Source: https://web.dev/learn/pwa/installation
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
Retrieved: 2026-11-23

## No install prompt on iOS
- web.dev: "A browser prompt to install your PWA doesn't exist On iOS and iPadOS." Users add it manually: Share → **Add to Home Screen** → confirm (editable) name → **Add**.
- MDN: `beforeinstallprompt` "is not supported on iOS".
- So Beach Day must show its own hint text on iOS.

## Which browsers can add to Home Screen
- MDN: iOS 16.3 and earlier → Safari only; iOS 16.4+ → Share menu in Safari, Chrome, Edge, Firefox and Orion.
- WebKit (16.4 post): "third-party browsers can now offer their users the ability to add websites and web apps to the Home Screen from the Share menu."

## iOS 16.4 (WebKit blog 13878, Feb 2023)
- A site whose manifest has `display` `standalone` or `fullscreen` becomes a Home Screen web app: opens "like any other app … instead of opening in a browser", with its own App Switcher entry. True "no matter which browser added the website".
- No manifest (and no `apple-mobile-web-app-capable` meta) → saved as a Home Screen **bookmark**, opening in the user's default browser (16.4 behaviour; changed in 26, below).
- **Web Push** for Home Screen web apps: permission may be requested only "in response to direct user interaction — such as tapping on a 'subscribe' button". Notifications behave like other apps'.
- **Badging API** (`setAppBadge`, `clearAppBadge`) for Home Screen web apps.
- **Manifest `id`** supported.

## iOS / iPadOS 26 (WebKit WWDC25 post, Safari 26.0 features post)
- "By default, every website added to the Home Screen opens as a web app." The user can turn off **"Open as Web App"** in the Add to Home Screen sheet to get a browser bookmark, "even if the site is configured to be a web app. It's up to users to decide."
- Nothing is removed: "If you define your icons in the manifest, they're used! If you want to provide an offline experience by using a Service Worker, great!"
- Home Screen web apps on iOS "never required Service Workers (as PWAs do on other platforms)" (Safari 26.0 post).
- History: `apple-mobile-web-app-capable` meta since iPhone OS 2.1; manifest support since iOS 11.4 (March 2018).
- UA string: Safari 26 keeps the OS token at `iPhone OS 18_6` while `Version/26.0` changes (example strings in the Safari 26.0 post). **Don't parse the OS version for features**; our detector only needs "≥ 16.4", which a frozen 18_6 satisfies.

## What iOS Home Screen apps get / lack (web.dev Installation)
- Appear on Home Screen, Spotlight, Siri Suggestions, App Library search.
- Only `standalone` display is supported (`minimal-ui` → browser shortcut; `fullscreen` → standalone).
- web.dev lists badging and app shortcuts as unsupported; WebKit's 16.4 post adds Badging for Home Screen apps — treat badging as iOS 16.4+ only, and manifest `shortcuts` as unsupported on iOS **[UNVERIFIED: no WebKit statement on `shortcuts` found]**.
- Icon: without `apple-touch-icon` (or, on 26, manifest icons) the icon is a page screenshot.

## Storage
Whether a Home Screen web app shares storage with Safari is not stated on the retrieved pages **[UNVERIFIED]**. Assume separate: favourites saved in Safari won't appear in the installed app; the app must work from an empty state and re-fetch.

## Hint UX (implemented in examples/03-install-prompt)
| Situation | Hint |
|---|---|
| iOS Safari / Chrome / Edge / Firefox (16.4+), not standalone | "Install Beach Day: tap Share, then 'Add to Home Screen'. Keep 'Open as Web App' on." |
| iOS ≤ 16.3, non-Safari | "…open this page in Safari." |
| In-app browser (Instagram, Facebook, Line) | "…open this page in Safari first." **[UNVERIFIED: in-app browsers' Share menus generally lack Add to Home Screen]** |
| Standalone (`display-mode: standalone` or `navigator.standalone`) | none |
| Dismissed < 30 days ago | none (our product choice) |
iPadOS 13+ Safari sends a desktop Mac UA; detect with `navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1`.

## Beach Day notes
- Keep `display: "standalone"` and `id: "/"`; provide `apple-touch-icon` 180×180 opaque.
- iOS 26 makes every added site a web app, so standalone-mode UI (in-app back button, safe areas with `viewport-fit=cover` + `env(safe-area-inset-*)`) must always work.
- Push notifications are out of scope for v1; if ever added, the subscribe button must be a user tap inside the installed app (WebKit rule), and it would need a push backend — a new ADR (ADR-0001 allows no other servers).
- Never imply Beach Day is a safety alert service on iOS either: keep the NWS rip-current link (ADR-0002) on every verdict screen.
