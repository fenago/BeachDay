// Install UX: Chromium `beforeinstallprompt` button + iOS "Add to Home Screen" hint (docs/02 §3-4).
// Pure detection functions plus a small controller that takes `window` as a parameter, so Node can test them.
// UI code maps `variant` to copy-deck strings; `text` is the fallback wording.
export const HINT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // Dr. Lee: 14-day snooze everywhere
export const HINT_KEY = "bd.installHintDismissedAt";

/** Classify the device from navigator-like fields. */
export function detectPlatform({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  const iPhoneLike = /\b(iPhone|iPod|iPad)\b/.test(userAgent);
  // iPadOS 13+ Safari reports a Mac desktop UA; touch points give it away.
  const iPadDesktopUA = platform === "MacIntel" && maxTouchPoints > 1;
  const isIOS = iPhoneLike || iPadDesktopUA;
  const isAndroid = /\bAndroid\b/.test(userAgent);
  let iosBrowser = null;
  if (isIOS) {
    if (/\bCriOS\//.test(userAgent)) iosBrowser = "chrome";
    else if (/\bFxiOS\//.test(userAgent)) iosBrowser = "firefox";
    else if (/\bEdgiOS\//.test(userAgent)) iosBrowser = "edge";
    else if (/\b(FBAN|FBAV|Instagram|Line)\b/.test(userAgent)) iosBrowser = "in-app";
    else if (/Version\/[\d.]+.*Safari\//.test(userAgent)) iosBrowser = "safari";
    else iosBrowser = "other";
  }
  // Safari 26 freezes the OS token at 18_6, so we only ever compare against 16.4.
  const os = /OS (\d+)_(\d+)/.exec(userAgent);
  const iosVersion = os ? Number(os[1]) + Number(os[2]) / 100 : iPadDesktopUA ? Infinity : null;
  return { isIOS, isAndroid, iosBrowser, iosVersion };
}

/** True when running as an installed app (any platform). */
export function isStandalone({ matchMedia, navigatorStandalone } = {}) {
  const mm = (q) => (typeof matchMedia === "function" ? Boolean(matchMedia(q).matches) : false);
  return mm("(display-mode: standalone)") || mm("(display-mode: fullscreen)") || navigatorStandalone === true;
}

/** True while a dismissal is less than 14 days old (shared by the iOS sheet and the Chromium button). */
export function isSnoozed(storage, now = Date.now()) {
  try {
    const at = Number(storage?.getItem(HINT_KEY)) || null;
    return Boolean(at && now - at < HINT_SNOOZE_MS);
  } catch { return false; /* storage blocked */ }
}

/** Should the iOS Add to Home Screen hint show? Returns null or { variant, text }. */
export function iosHint(env, { storage, now = Date.now() } = {}) {
  const p = detectPlatform(env);
  if (!p.isIOS || isStandalone(env)) return null;
  if (isSnoozed(storage, now)) return null;
  if (p.iosBrowser === "in-app") {
    return { variant: "open-in-browser", text: "To add Beach Day to your Home Screen, open this page in Safari first." };
  }
  if (p.iosBrowser !== "safari" && p.iosVersion !== null && p.iosVersion < 16.4) {
    return { variant: "open-in-safari", text: "To add Beach Day to your Home Screen, open this page in Safari." };
  }
  return { variant: "share-sheet", text: "Install Beach Day: tap Share, then “Add to Home Screen”. Keep “Open as Web App” on." };
}

export function dismissIosHint(storage, now = Date.now()) {
  try { storage?.setItem(HINT_KEY, String(now)); } catch { /* ignore */ }
}

/** Read the live environment once (browser only). */
export function readEnv(win = window) {
  const nav = win.navigator;
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    matchMedia: (q) => win.matchMedia(q),
    navigatorStandalone: nav.standalone,
  };
}

/**
 * Wire the Chromium install button. Hidden until `beforeinstallprompt`.
 * A dismissed prompt is not offered again this session.
 * @returns {{install(): Promise<'accepted'|'dismissed'|'unavailable'>, readonly available: boolean}}
 */
export function createInstallController(win, ui) {
  let deferred = null;
  let dismissedThisSession = false;
  win.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // suppress the mini-infobar; we show our own button in context
    deferred = event;
    if (!dismissedThisSession) ui.show();
  });
  win.addEventListener("appinstalled", () => {
    deferred = null;
    ui.hide();
    ui.installed?.();
  });
  return {
    get available() { return deferred !== null; },
    async install() {
      if (!deferred) return "unavailable";
      const evt = deferred;
      deferred = null; // prompt() works once per event
      ui.hide();
      const result = await evt.prompt(); // { outcome } in current Chromium; older builds use userChoice
      const choice = result && result.outcome ? result : await evt.userChoice;
      if (choice.outcome === "dismissed") dismissedThisSession = true;
      return choice.outcome;
    },
  };
}
