// Service worker registration and the safe update flow (docs/02 §5, docs/03 lifecycle notes).
// No blind skipWaiting: a waiting worker is surfaced to the page, the user taps Refresh, the page posts
// SKIP_WAITING, and the page reloads once on controllerchange.
const UPDATE_CHECK_MIN_MS = 60 * 60 * 1000; // at most hourly while the app stays open

/**
 * @param {object} opts
 * @param {(apply: () => void) => void} opts.onUpdateReady  called when a new version is waiting; `apply` = user tapped Refresh
 * @param {Window} [opts.win]
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerServiceWorker({ onUpdateReady, win = window } = {}) {
  const sw = win.navigator.serviceWorker;
  if (!sw) return null;
  const hadController = Boolean(sw.controller);
  const reg = await sw.register("/sw.js", { scope: "/" });

  const offer = () => {
    if (!sw.controller) return; // first install is not an update
    onUpdateReady?.(() => reg.waiting?.postMessage({ type: "SKIP_WAITING" }));
  };
  if (reg.waiting) offer();
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer();
    });
  });

  let reloaded = false;
  sw.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return; // first-ever claim must not reload; reload exactly once
    reloaded = true;
    win.location.reload();
  });

  let lastCheck = Date.now();
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState !== "visible" || Date.now() - lastCheck < UPDATE_CHECK_MIN_MS) return;
    lastCheck = Date.now();
    reg.update().catch(() => {});
  });
  return reg;
}

/** Register after load so install and precache never compete with first paint. */
export function registerAfterLoad(opts = {}) {
  const win = opts.win ?? window;
  const go = () => registerServiceWorker(opts).catch(() => null);
  if (win.document.readyState === "complete") return go();
  return new Promise((resolve) => win.addEventListener("load", () => resolve(go()), { once: true }));
}

/** Ask for persistent storage once the app is installed (standalone). Safe to call anywhere. */
export async function requestPersistentStorage(win = window) {
  try {
    if (win.navigator.storage?.persist && !(await win.navigator.storage.persisted())) return await win.navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
