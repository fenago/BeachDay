// Beach data seam for the UI (build_plan section 5):
//   loadForecast(beachId, { fetchImpl, now, storage, online, userForced }) -> Forecast
//   getCached(beachId, storage, { now })                                   -> Forecast | null
// Forecast = { beach, days: DayVerdict[], fetchedAt, source: 'network'|'cache', partial: { marine: boolean }, ... }
// No auth, no Supabase, no DOM. The browser calls Open-Meteo directly (ADR-0001/0006).
// Caching: per device, in localStorage (disposable). Stale after 30 min, refetched only on user-driven
// events, never on a timer. A failed refresh falls back to what is saved.

import { loadBeach, OpenMeteoError } from './api/openmeteo.js';
import { getBeach } from './data/beaches.js';
import {
  BEACH_TZ, HOUR, apiLocalToInstant, beachDate, beachWindow, daysBetween, formatClock, instantToWallClock,
} from './data/beach-window.js';
import { ageTier, cacheAge, shouldRefetch } from './data/cache-age.js';
import { scoreDay } from './score.js';

export const CACHE_KEY_PREFIX = 'beachday:forecast:v1:';
export const FORECAST_DAYS = 7;

const toMs = (now) => (typeof now === 'function' ? now() : now instanceof Date ? now.getTime() : now);

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; } // access can throw (privacy modes)
}

function readEntry(beachId, storage) {
  try {
    const raw = storage?.getItem(CACHE_KEY_PREFIX + beachId);
    if (!raw) return null;
    const e = JSON.parse(raw);
    const ok = e && e.v === 1 && e.beachId === beachId && Number.isFinite(e.fetchedAt)
      && e.model && Array.isArray(e.model.hours) && Array.isArray(e.model.days) && Number.isFinite(e.model.utcOffsetSeconds)
      && e.model.marine && typeof e.model.marine.available === 'boolean';
    return ok ? e : null; // stored values are disposable: anything odd is ignored
  } catch {
    return null;
  }
}

function writeEntry(entry, storage) {
  try { storage?.setItem(CACHE_KEY_PREFIX + entry.beachId, JSON.stringify(entry)); } catch { /* quota or privacy mode */ }
}

/**
 * Turn the normalized model into one DayVerdict per day from today on.
 * Pure given (model, now). Times in the result are real beach wall-clock "HH:MM" (DST-correct).
 * Today only counts hour slots that have not ended yet; none left -> verdict null + reason no_beach_window.
 */
export function buildDays(model, now) {
  const tz = model.timezone || BEACH_TZ;
  const off = model.utcOffsetSeconds;
  const today = beachDate(now, tz);
  const instants = model.hours.map((h) => apiLocalToInstant(h.time, off));
  const wall = (apiTime) => instantToWallClock(apiLocalToInstant(apiTime, off), tz).slice(11);
  const formatTime = (apiTime) => formatClock(wall(apiTime));

  const days = [];
  for (const d of model.days) {
    if (d.date < today) continue;
    const dayIndex = daysBetween(today, d.date);
    const win = beachWindow(d, { utcOffsetSeconds: off, timezone: tz });
    const idx = [];
    if (win) {
      for (let i = 0; i < model.hours.length; i++) {
        const t = instants[i];
        if (t >= win.start && t < win.end && (dayIndex > 0 || t + HOUR > now)) idx.push(i);
      }
    }
    const hours = idx.map((i) => model.hours[i]);
    const priorHour = idx.length && idx[0] > 0 ? model.hours[idx[0] - 1] : null;
    const r = scoreDay({ hours, priorHour, dayIndex, formatTime });
    days.push({
      date: d.date,
      dayIndex,
      isToday: dayIndex === 0,
      ...r,
      bestWindow: r.bestWindow ? { start: wall(r.bestWindow.start), end: wall(r.bestWindow.end), hours: r.bestWindow.hours } : null,
      beachWindow: win ? { start: win.startLocal.slice(11), end: win.endLocal.slice(11) } : null,
      sunrise: d.sunrise ? wall(d.sunrise) : null,
      sunset: d.sunset ? wall(d.sunset) : null,
    });
  }
  return days;
}

function toForecast(beach, entry, source, now, extra = {}) {
  const { ageMs } = cacheAge(entry.fetchedAt, now);
  const tier = ageTier(entry.fetchedAt, now);
  const tooOld = tier === 'too-old';
  return {
    beach,
    // Never show yesterday's answer as today's: older than 24 h, or an untrusted timestamp, gives no verdicts.
    days: tooOld ? [] : buildDays(entry.model, now),
    fetchedAt: entry.fetchedAt,
    source,
    partial: { marine: !entry.model.marine.available },
    ageMs,
    stale: tier !== 'fresh', // older than 30 min
    staleBanner: tier === 'banner' || tier === 'too-old', // older than 3 h: show the banner
    tooOld,
    marine: { available: entry.model.marine.available, label: entry.model.marine.label, snapKm: entry.model.marine.snapKm },
    timezone: entry.model.timezone,
    ...extra,
  };
}

const inflight = new Map();

/**
 * Load the forecast for one beach. Reads the device cache first; hits the network only when the cache is
 * missing or stale (30 min) or the person asked (userForced, at most once a minute). On a failed refresh the
 * saved copy is returned with `error` set to the failure kind. With nothing saved the error is thrown.
 * @throws {OpenMeteoError} kind 'offline' | 'timeout' | 'network' | 'http' | 'api' | 'shape'
 */
export async function loadForecast(beachId, opts = {}) {
  const beach = getBeach(beachId);
  if (!beach) throw new RangeError(`unknown beach: ${beachId}`);
  const { fetchImpl, storage = defaultStorage(), userForced = false, days = FORECAST_DAYS, timeoutMs } = opts;
  const now = toMs(opts.now ?? Date.now());
  const online = opts.online ?? (typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true);

  const entry = readEntry(beachId, storage);
  if (entry && !shouldRefetch(entry, { now, online, userForced })) return toForecast(beach, entry, 'cache', now);
  if (!online) {
    if (entry) return toForecast(beach, entry, 'cache', now, { error: 'offline' });
    throw new OpenMeteoError('offline', 'Offline and no saved forecast');
  }

  try {
    let p = inflight.get(beachId);
    if (!p) {
      p = loadBeach(beach, { fetchImpl, days, timeoutMs }).finally(() => inflight.delete(beachId));
      inflight.set(beachId, p);
    }
    const model = await p;
    const fresh = { v: 1, beachId, fetchedAt: now, model };
    writeEntry(fresh, storage);
    return toForecast(beach, fresh, 'network', now);
  } catch (err) {
    if (entry) return toForecast(beach, entry, 'cache', now, { error: err?.kind ?? 'network' });
    throw err;
  }
}

/** The saved forecast for a beach, or null. Never touches the network. */
export function getCached(beachId, storage = defaultStorage(), { now = Date.now() } = {}) {
  const beach = getBeach(beachId);
  if (!beach) return null;
  const entry = readEntry(beachId, storage);
  return entry ? toForecast(beach, entry, 'cache', toMs(now)) : null;
}
