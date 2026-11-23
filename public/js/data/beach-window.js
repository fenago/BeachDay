// Beach window and time-zone helpers for Open-Meteo responses (browser-safe, no dependencies).
// Window rule (docs/01 5.2): max(sunrise + 1 h, 8 am) .. min(sunset - 0.5 h, 7 pm), real beach-local time.
//
// Open-Meteo returns local ISO strings WITHOUT an offset ("2026-11-23T06:44"), all computed with ONE fixed
// utc_offset_seconds resolved at request time. DST changes inside the range are ignored
// (https://open-meteo.com/en/docs, parameter `timezone`). So: string -> instant uses utc_offset_seconds,
// and instant -> real wall clock uses the IANA zone via Intl. Never `new Date("2026-11-23T06:44")`: that
// parses in the DEVICE's zone.

export const HOUR = 3_600_000;
export const BEACH_TZ = 'America/New_York';

/** API local ISO string ("YYYY-MM-DDTHH:MM") -> epoch ms, using the response's fixed offset. */
export function apiLocalToInstant(localIso, utcOffsetSeconds) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(localIso));
  if (!m) throw new TypeError(`unexpected time format: ${localIso}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - utcOffsetSeconds * 1000;
}

/** Real UTC offset (seconds) of an IANA zone at an instant, DST-aware. */
export function zoneOffsetSeconds(instantMs, timeZone = BEACH_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 1000);
}

/** Instant -> real local wall clock "YYYY-MM-DDTHH:MM" in the zone (DST-aware). */
export function instantToWallClock(instantMs, timeZone = BEACH_TZ) {
  const off = zoneOffsetSeconds(instantMs, timeZone);
  return new Date(instantMs + off * 1000).toISOString().slice(0, 16);
}

/** Instant of a real local wall-clock time (e.g. 08:00) on a date in a zone. */
export function wallClockToInstant(dateYmd, hh, mm, timeZone = BEACH_TZ) {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const naive = Date.UTC(y, mo - 1, d, hh, mm);
  let t = naive - zoneOffsetSeconds(naive, timeZone) * 1000;
  t = naive - zoneOffsetSeconds(t, timeZone) * 1000; // second pass settles DST edges
  return t;
}

/** Local calendar date "YYYY-MM-DD" at the beach for an instant. */
export function beachDate(instantMs, timeZone = BEACH_TZ) {
  return instantToWallClock(instantMs, timeZone).slice(0, 10);
}

/** Whole days from date a to date b ("YYYY-MM-DD"), b - a. */
export function daysBetween(a, b) {
  const ms = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** "15:00" or "2026-11-23T15:00" -> "3 pm"; "15:30" -> "3:30 pm"; midnight "12 am", noon "12 pm". */
export function formatClock(value) {
  const m = /(\d{2}):(\d{2})$/.exec(String(value));
  if (!m) return '';
  const h = Number(m[1]);
  const mm = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm === '00' ? '' : `:${mm}`} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * Beach window for one daily row. Returns instants plus real local labels, or null when there is no
 * usable window. @param day {date, sunrise, sunset} from forecast.daily (API local strings)
 */
export function beachWindow(day, { utcOffsetSeconds, timezone = BEACH_TZ }, cfg = {}) {
  const { afterSunriseMin = 60, beforeSunsetMin = 30, earliest = [8, 0], latest = [19, 0] } = cfg;
  if (!day || !day.sunrise || !day.sunset) return null;
  const sunrise = apiLocalToInstant(day.sunrise, utcOffsetSeconds);
  const sunset = apiLocalToInstant(day.sunset, utcOffsetSeconds);
  const start = Math.max(sunrise + afterSunriseMin * 60_000, wallClockToInstant(day.date, ...earliest, timezone));
  const end = Math.min(sunset - beforeSunsetMin * 60_000, wallClockToInstant(day.date, ...latest, timezone));
  if (end <= start) return null;
  return {
    start, end,
    startLocal: instantToWallClock(start, timezone),
    endLocal: instantToWallClock(end, timezone),
  };
}

/** Hours (normalized model with .time) whose hour slot starts inside [start, end). */
export function hoursInWindow(hours, win, utcOffsetSeconds) {
  if (!win) return [];
  return hours.filter((h) => {
    const t = apiLocalToInstant(h.time, utcOffsetSeconds);
    return t >= win.start && t < win.end;
  });
}
