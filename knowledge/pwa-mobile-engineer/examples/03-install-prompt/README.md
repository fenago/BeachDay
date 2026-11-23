# Example 03: install prompt (Android `beforeinstallprompt` button + iOS Add to Home Screen hint)

## What it shows
`install-prompt.mjs` (browser ES module, no dependencies, takes `window`-like objects as parameters so it is testable in Node):
- `detectPlatform({userAgent, platform, maxTouchPoints})`: iOS vs Android, iOS browser (`safari`, `chrome` = CriOS, `firefox` = FxiOS, `edge` = EdgiOS, `in-app`), iPadOS desktop-UA detection (`MacIntel` + touch points). Does not rely on the iOS version beyond "≥ 16.4", because Safari 26 freezes the OS token at `18_6` (WebKit Safari 26.0 post).
- `isStandalone(...)`: `display-mode: standalone|fullscreen` or `navigator.standalone === true`.
- `iosHint(env, {storage, now})`: returns `null` or `{variant, text}` — Share-sheet hint (mentions iOS 26's "Open as Web App" toggle), "open in Safari" for iOS ≤ 16.3 non-Safari, "open in Safari first" for in-app browsers; snoozed 14 days after dismissal (Dr. Lee's decision); survives blocked `localStorage`.
- `createInstallController(window, ui)`: MDN's pattern — `preventDefault()`, keep the event, show the button, `prompt()` once, read `outcome` (from `prompt()`'s result, or `userChoice` on older Chromium), hide on `appinstalled`.

Why it is "what good looks like": the button is hidden by default and only appears when the browser says the app is installable (MDN), iOS gets an honest manual instruction because it has no prompt (web.dev, WebKit), and the logic is pure and tested.

## Run
```bash
cd knowledge/pwa-mobile-engineer/examples/03-install-prompt
node --test install-prompt.test.mjs
```
Wiring in the page:
```js
import { createInstallController, iosHint, dismissIosHint } from "./install-prompt.mjs";
const btn = document.querySelector("#install");
const ctl = createInstallController(window, { show: () => (btn.hidden = false), hide: () => (btn.hidden = true) });
btn.addEventListener("click", () => ctl.install());
const hint = iosHint({ userAgent: navigator.userAgent, platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints, matchMedia: (q) => matchMedia(q),
  navigatorStandalone: navigator.standalone }, { storage: localStorage });
```

## Verified
Command: `node --test --test-reporter=spec install-prompt.test.mjs` (Node v22.23.5, 2026-11-23, re-run after the 30 to 14 day change)
```
✔ platform detection
✔ standalone detection: display-mode or navigator.standalone
✔ iOS hint: shown in Safari tab, hidden when installed, Android never
✔ iOS hint variants: Chrome 16.4+ ok, Chrome <=16.3 -> Safari, in-app -> open in browser
✔ dismissal snoozes the hint for 14 days; blocked storage still works
✔ beforeinstallprompt controller: hidden -> shown -> prompt once -> hidden
✔ older Chromium: prompt() resolves undefined, outcome comes from userChoice; appinstalled hides button
ℹ tests 7  ℹ pass 7  ℹ fail 0
```
The `beforeinstallprompt` events are synthetic (Chrome's engagement heuristics make the real event impractical in automation). The CriOS / Instagram UA strings are representative test inputs, not quoted from official docs. Not verified on real devices.
