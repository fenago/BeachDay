// Cache-age helper for Open-Meteo data cached per device (ADR-0001: no server cache).
// Policy (open-meteo-apis skill): refresh at most every 30 min, never poll in the background.

export const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * @param fetchedAt epoch ms when the response left Open-Meteo (recorded by app or service worker)
 * @param now       epoch ms (inject for tests)
 * @returns {{ageMs:number|null, stale:boolean, reason:string}}
 */
export function cacheAge(fetchedAt, now = Date.now(), staleAfterMs = STALE_AFTER_MS) {
  if (!Number.isFinite(fetchedAt)) return { ageMs: null, stale: true, reason: 'no-timestamp' };
  const ageMs = now - fetchedAt;
  // A timestamp in the future means the device clock moved: don't trust the cache.
  if (ageMs < -60_000) return { ageMs, stale: true, reason: 'clock-skew' };
  if (ageMs >= staleAfterMs) return { ageMs, stale: true, reason: 'expired' };
  return { ageMs: Math.max(0, ageMs), stale: false, reason: 'fresh' };
}

/**
 * Decide whether to hit the network. Only called on user-driven events
 * (app open, beach change, pull-to-refresh, visibilitychange -> visible). Never on a timer.
 */
export function shouldRefetch(entry, { now = Date.now(), online = true, userForced = false } = {}) {
  if (!online) return false;
  if (!entry) return true;
  const { stale } = cacheAge(entry.fetchedAt, now);
  // Pull-to-refresh may bypass, but still not more often than once a minute.
  if (userForced) return now - entry.fetchedAt >= 60_000 || stale;
  return stale;
}

const fmt = (ms, timeZone) => new Intl.DateTimeFormat('en-US', {
  timeZone, hour: 'numeric', minute: '2-digit',
}).format(new Date(ms)).replace(' AM', ' am').replace(' PM', ' pm');

/** Text for the "last updated" line. Never colour-only; plain words. */
export function freshnessLabel(entry, { now = Date.now(), online = true, timeZone = 'America/New_York' } = {}) {
  if (!entry) return online ? 'Loading forecast…' : 'Offline — no saved forecast yet';
  const at = fmt(entry.fetchedAt, timeZone);
  const { stale } = cacheAge(entry.fetchedAt, now);
  if (!online) return `Offline — showing data from ${at}`;
  return stale ? `Updating… last data from ${at}` : `Updated ${at}`;
}
