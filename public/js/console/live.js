// "Live" after a deploying commit (docs/04 §1 step 6): poll /version.json with cache "no-store" every 10 s,
// paused while the tab is hidden, until `commit` equals the full commit SHA. Give up after 10 minutes.
// A 404, a network error or bad JSON counts as "not yet". This module never calls /api/* and needs no token.

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * @param {{commitSha: string, onLive: () => void, onGiveUp: () => void, fetchImpl?: typeof fetch,
 *          intervalMs?: number, maxMs?: number, now?: () => number, doc?: Document,
 *          setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout}} opts
 * @returns {() => void} stop
 */
export function watchDeploy({ commitSha, onLive, onGiveUp, fetchImpl = (...a) => globalThis.fetch(...a), intervalMs = 10_000,
  maxMs = 10 * 60_000, now = () => Date.now(), doc = globalThis.document, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!SHA_RE.test(commitSha ?? "")) throw new Error("watchDeploy needs a full commit SHA");
  const startedAt = now();
  let timer = null;
  let stopped = false;
  let inFlight = false;

  const stop = () => {
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
    doc?.removeEventListener?.("visibilitychange", onVisibility);
  };

  async function liveCommit() {
    try {
      const res = await fetchImpl("/version.json", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body?.commit === "string" ? body.commit : null;
    } catch { return null; }
  }

  async function tick() {
    timer = null;
    if (stopped || inFlight) return;
    if (now() - startedAt >= maxMs) { stop(); onGiveUp(); return; }
    if (doc?.hidden) return; // resumes on visibilitychange
    inFlight = true;
    const commit = await liveCommit();
    inFlight = false;
    if (stopped) return;
    if (commit === commitSha) { stop(); onLive(); return; }
    schedule();
  }

  function schedule() {
    if (stopped || timer) return;
    timer = setTimer(tick, intervalMs);
  }

  function onVisibility() {
    if (stopped) return;
    if (doc.hidden) { if (timer) clearTimer(timer); timer = null; }
    else tick();
  }

  doc?.addEventListener?.("visibilitychange", onVisibility);
  schedule();
  return stop;
}
