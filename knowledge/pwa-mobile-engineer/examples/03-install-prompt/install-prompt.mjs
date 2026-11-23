// Install UX for Beach Day: Android/desktop Chromium `beforeinstallprompt` button + iOS "Add to Home Screen" hint.
// Pure detection functions (testable in Node) + a small controller that takes `window` as a parameter.
// Sources: MDN beforeinstallprompt_event, MDN Making_PWAs_installable, web.dev/learn/pwa/installation,
//          webkit.org/blog/13878 (iOS 16.4), webkit.org/blog/16993 + 17333 (iOS 26 "Open as Web App").

const HINT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // Dr. Lee's decision: re-show a dismissed hint after 14 days
const KEY = 'bd.installHintDismissedAt';

/** Classify the device from navigator-like fields. */
export function detectPlatform({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const iPhoneLike = /\b(iPhone|iPod|iPad)\b/.test(userAgent);
  // iPadOS 13+ Safari reports a Mac desktop UA by default; touch points give it away.
  const iPadDesktopUA = platform === 'MacIntel' && maxTouchPoints > 1;
  const isIOS = iPhoneLike || iPadDesktopUA;
  const isAndroid = /\bAndroid\b/.test(userAgent);
  let iosBrowser = null;
  if (isIOS) {
    if (/\bCriOS\//.test(userAgent)) iosBrowser = 'chrome';
    else if (/\bFxiOS\//.test(userAgent)) iosBrowser = 'firefox';
    else if (/\bEdgiOS\//.test(userAgent)) iosBrowser = 'edge';
    else if (/\b(FBAN|FBAV|Instagram|Line)\b/.test(userAgent)) iosBrowser = 'in-app';
    else if (/Version\/[\d.]+.*Safari\//.test(userAgent)) iosBrowser = 'safari';
    else iosBrowser = 'other';
  }
  // NOTE: Safari 26 freezes the OS token at "18_6" (see WebKit's Safari 26.0 post), so never gate on it
  // for anything newer than 18.6. We only need ">= 16.4" (third-party browsers can Add to Home Screen).
  const os = /OS (\d+)_(\d+)/.exec(userAgent);
  const iosVersion = os ? Number(os[1]) + Number(os[2]) / 100 : iPadDesktopUA ? Infinity : null;
  return { isIOS, isAndroid, iosBrowser, iosVersion };
}

/** True when running as an installed app (any platform). */
export function isStandalone({ matchMedia, navigatorStandalone } = {}) {
  const mm = (q) => (typeof matchMedia === 'function' ? matchMedia(q).matches : false);
  return mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || navigatorStandalone === true;
}

/**
 * Should the iOS Add to Home Screen hint be shown?
 * @returns {null | {text: string, variant: string}}
 */
export function iosHint(env, { storage, now = Date.now() } = {}) {
  const p = detectPlatform(env);
  if (!p.isIOS || isStandalone(env)) return null;
  let dismissedAt = null;
  try { dismissedAt = Number(storage?.getItem(KEY)) || null; } catch { /* storage blocked */ }
  if (dismissedAt && now - dismissedAt < HINT_SNOOZE_MS) return null;
  if (p.iosBrowser === 'in-app') {
    return { variant: 'open-in-browser', text: 'To add Beach Day to your Home Screen, open this page in Safari first.' };
  }
  // iOS 16.3 and earlier: only Safari can add to Home Screen.
  if (p.iosBrowser !== 'safari' && p.iosVersion !== null && p.iosVersion < 16.4) {
    return { variant: 'open-in-safari', text: 'To add Beach Day to your Home Screen, open this page in Safari.' };
  }
  return {
    variant: 'share-sheet',
    text: 'Install Beach Day: tap Share, then “Add to Home Screen”. Keep “Open as Web App” on.',
  };
}

export function dismissIosHint(storage, now = Date.now()) {
  try { storage?.setItem(KEY, String(now)); } catch { /* ignore */ }
}

/**
 * Wire the Chromium install button. Hidden by default; shown only after `beforeinstallprompt`.
 * @param win window-like EventTarget
 * @param ui  {show(): void, hide(): void}
 * @returns {{install(): Promise<'accepted'|'dismissed'|'unavailable'>, get available(): boolean}}
 */
export function createInstallController(win, ui) {
  let deferred = null;
  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // suppress the mini-infobar; we show our own button in context
    deferred = event;
    ui.show();
  });
  win.addEventListener('appinstalled', () => {
    deferred = null;
    ui.hide();
  });
  return {
    get available() { return deferred !== null; },
    async install() {
      if (!deferred) return 'unavailable';
      const evt = deferred;
      deferred = null; // prompt() can only be used once per event
      ui.hide();
      const result = await evt.prompt(); // resolves to { outcome, platform } in current Chromium
      const choice = result?.outcome ? result : await evt.userChoice;
      return choice.outcome;
    },
  };
}
