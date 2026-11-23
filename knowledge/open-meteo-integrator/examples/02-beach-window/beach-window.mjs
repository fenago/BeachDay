// Beach window + time-zone helpers for Open-Meteo responses.
// Window rule (beach-day-scoring skill): max(sunrise + 1 h, 8 am) .. min(sunset - 0.5 h, 7 pm), local time.
//
// Open-Meteo returns local ISO strings WITHOUT an offset (e.g. "2026-11-23T06:44"), all computed with ONE
// fixed utc_offset_seconds resolved at request time. DST changes inside the range are ignored
// (https://open-meteo.com/en/docs, parameter `timezone`). So: string -> instant uses utc_offset_seconds,
// and instant -> real wall clock uses the IANA zone via Intl.

const HOUR = 3_600_000;

/** API local ISO string ("YYYY-MM-DDTHH:MM") -> epoch ms, using the response's fixed offset. */
export function apiLocalToInstant(localIso, utcOffsetSeconds) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localIso);
  if (!m) throw new TypeError(`unexpected time format: ${localIso}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - utcOffsetSeconds * 1000;
}

/** Real UTC offset (seconds) of an IANA zone at an instant, DST-aware. */
export function zoneOffsetSeconds(instantMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 1000);
}

/** Instant -> real local wall clock "YYYY-MM-DDTHH:MM" in the zone (DST-aware). */
export function instantToWallClock(instantMs, timeZone) {
  const off = zoneOffsetSeconds(instantMs, timeZone);
  return new Date(instantMs + off * 1000).toISOString().slice(0, 16);
}

/** Instant of a real local wall-clock time (e.g. 08:00) on a date in a zone. */
export function wallClockToInstant(dateYmd, hh, mm, timeZone) {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const naive = Date.UTC(y, mo - 1, d, hh, mm);
  let t = naive - zoneOffsetSeconds(naive, timeZone) * 1000;
  t = naive - zoneOffsetSeconds(t, timeZone) * 1000; // second pass settles DST edges
  return t;
}

/**
 * Beach window for one daily row. Returns instants plus real local labels.
 * @param day {date, sunrise, sunset} from forecast.daily (API local strings)
 */
export function beachWindow(day, { utcOffsetSeconds, timezone }, cfg = {}) {
  const { afterSunriseMin = 60, beforeSunsetMin = 30, earliest = [8, 0], latest = [19, 0] } = cfg;
  const sunrise = apiLocalToInstant(day.sunrise, utcOffsetSeconds);
  const sunset = apiLocalToInstant(day.sunset, utcOffsetSeconds);
  const start = Math.max(sunrise + afterSunriseMin * 60_000, wallClockToInstant(day.date, ...earliest, timezone));
  const end = Math.min(sunset - beforeSunsetMin * 60_000, wallClockToInstant(day.date, ...latest, timezone));
  if (end <= start) return null; // no usable window
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

export { HOUR };
