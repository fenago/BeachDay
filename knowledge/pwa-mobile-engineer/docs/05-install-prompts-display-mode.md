# Install prompts (`beforeinstallprompt`), Android install types, `display-mode`
Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
Source: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode
Source: https://web.dev/learn/pwa/installation
Retrieved: 2026-11-23

## `beforeinstallprompt` (MDN)
- Status: "Limited availability … not Baseline because it does not work in some of the most widely-used browsers." Spec: WICG Manifest Incubations (not a W3C standard).
- Fires when the browser "has detected that a website can be installed"; "There's no guaranteed time this event is fired, but it usually happens on page load."
- Event type `BeforeInstallPromptEvent`. Method `prompt()`: "Show a prompt asking the user if they want to install the app. This method returns a Promise that resolves to an object describing the user's choice". Older Chromium returned the choice through the `userChoice` promise instead **[UNVERIFIED: userChoice is not described on the retrieved MDN event page; it is on the BeforeInstallPromptEvent interface page]** — handle both (our controller does).
- Pattern (MDN):
  1. Install button hidden by default ("not all browsers will support installation").
  2. On the event: `event.preventDefault()` (stops the browser's own UI on some platforms), keep the event, reveal the button.
  3. On click: `await installPrompt.prompt()`, read `result.outcome`, clear the stored event, hide the button.
- MDN install guide: "This is not supported on iOS."
- Chrome additionally gates it on engagement (≥ 1 click/tap and ≥ 30 s viewing) — see 01.
- `appinstalled` event: fired after install **[UNVERIFIED: not on the retrieved pages]**; we hide the button on it.

## Android install outcomes (web.dev Learn PWA: Installation)
- Install UI varies: menu item "Install" or "Add to Home Screen"; mini-infobar or detailed dialog.
- **WebAPK** (Chrome with Google Mobile Services; Samsung Internet on Samsung devices — "the majority of Android users"): a minting server packages and signs an APK, installed silently. Gets launcher + home-screen icon, appears in Settings → Apps, supports badging, app shortcuts, link capturing, can update icon/metadata, can't be installed twice.
- **Shortcut** (Firefox, Edge, Opera, Brave, Samsung Internet on non-Samsung, or Chrome when minting fails / criteria unmet): browser-badged home-screen icon, not in launcher or Settings, no install-only capabilities, can't update icon/metadata, can be added multiple times (all share one storage).
- QuickApps (Huawei, ZTE) are a separate case.
- Stores: Play (Trusted Web Activity), App Store (WKWebView + App-Bound Domains), Microsoft Store, Galaxy Store, AppGallery.

## `display-mode` media feature (MDN)
| Value | Meaning |
|---|---|
| `browser` | Normal tab/window |
| `fullscreen` | All display area, no UA chrome (manifest `fullscreen` or Fullscreen API) |
| `minimal-ui` | Standalone look with minimal navigation controls |
| `picture-in-picture` | Document Picture-in-Picture window |
| `standalone` | "look and feel like a standalone application … the user agent will exclude UI elements for controlling navigation" |
| `window-controls-overlay` | Desktop standalone with Window Controls Overlay |

Usage:
```css
@media (display-mode: standalone) { .install-cta { display: none; } .back-button { display: inline-flex; } }
```
```js
const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
```
`navigator.standalone` is Apple's non-standard flag for iOS Home Screen apps **[UNVERIFIED: not on the retrieved pages; widely used]**. Checking both is harmless.

iOS supports only `standalone`: `minimal-ui` falls back to a browser shortcut, `fullscreen` falls back to standalone (web.dev Installation).

## Code shape (examples/03-install-prompt/install-prompt.mjs)
```js
const ctl = createInstallController(window, { show: () => btn.hidden = false, hide: () => btn.hidden = true });
btn.addEventListener("click", async () => { const outcome = await ctl.install(); /* 'accepted' | 'dismissed' */ });
```
Tested: `preventDefault` is called; button appears only after the event; `prompt()` used once; `appinstalled` hides the button; both `prompt()`-result and `userChoice` outcomes handled.

## Beach Day notes
- Show the install button in context (after the first verdict renders), never as a blocking modal (apple-hig / accessibility skills). Label: "Install Beach Day". 44 px target.
- In standalone mode there is no browser back button: show an in-app back control on sub-screens (`display-mode: standalone`).
- Don't nag: if the user dismisses (`outcome: 'dismissed'`), don't re-show the custom button this session.
- TWA/Capacitor are not justified now (agent rules); WebAPK on Chrome/Samsung already gives a real app entry.
