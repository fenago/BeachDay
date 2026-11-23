// Cache-age helper for Open-Meteo data cached per device (ADR-0001: no server cache).
// Policy (open-meteo-apis skill): refresh at most every 30 min, never poll in the background.
// Open-Meteo publishes no TTL; 30 min is OUR policy (docs/06 of the knowledge notes).
// Banner at 3 h and "too old" at 24 h come from Wren's state matrix (flow-spec.md).

export const STALE_AFTER_MS = 30 * 60 * 1000;
export const STALE_BANNER_MS = 3 * 60 * 60 * 1000;
export const TOO_OLD_MS = 24 * 60 * 60 * 1000;
export const FORCE_MIN_GAP_MS = 60 * 1000;

/**
 * @param fetchedAt epoch ms when the data was fetched
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

/** 'fresh' (< 30 min) | 'stale' (30 min..3 h) | 'banner' (3 h..24 h) | 'too-old' (>= 24 h or untrusted). */
export function ageTier(fetchedAt, now = Date.now()) {
  const { ageMs, stale, reason } = cacheAge(fetchedAt, now);
  if (reason === 'no-timestamp' || reason === 'clock-skew') return 'too-old';
  if (!stale) return 'fresh';
  if (ageMs >= TOO_OLD_MS) return 'too-old';
  if (ageMs >= STALE_BANNER_MS) return 'banner';
  return 'stale';
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
  if (userForced) return now - entry.fetchedAt >= FORCE_MIN_GAP_MS || stale;
  return stale;
}

const fmt = (ms, timeZone) => new Intl.DateTimeFormat('en-US', {
  timeZone, hour: 'numeric', minute: '2-digit',
}).format(new Date(ms)).replace(/\s?AM$/, ' am').replace(/\s?PM$/, ' pm');

/** Plain-words time of a fetch in beach-local time, e.g. "8:15 am". */
export function fetchedAtLabel(fetchedAt, timeZone = 'America/New_York') {
  return fmt(fetchedAt, timeZone);
}

/** Text for the "last updated" line. Never colour-only; plain words. Wren owns final copy ids. */
export function freshnessLabel(entry, { now = Date.now(), online = true, timeZone = 'America/New_York' } = {}) {
  if (!entry) return online ? 'Loading forecast…' : 'Offline — no saved forecast yet';
  const at = fmt(entry.fetchedAt, timeZone);
  const { stale } = cacheAge(entry.fetchedAt, now);
  if (!online) return `Offline — showing data from ${at}`;
  return stale ? `Updating… last data from ${at}` : `Updated ${at}`;
}
