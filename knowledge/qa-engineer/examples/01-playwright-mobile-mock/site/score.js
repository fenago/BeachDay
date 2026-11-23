// A SUBSET of the Beach Day v1 scoring model (.claude/skills/beach-day-scoring),
// small enough for a test example. Implemented: beach window, thunderstorm
// and wind hard stops, rain-chance / cloud / feels-like / wind penalties,
// best-3-hour verdict. Not implemented here: heat index, precip amount,
// rain codes, CAPE, marine factors, UV advice.
const THUNDER = new Set([95, 96, 97, 99]);

const band = (v, rows) => rows.find(([test]) => test(v)) ?? [null, 0, null];

export function scoreHour(h) {
  if (THUNDER.has(h.weather_code)) return { score: 0, reasons: ["Thunderstorms"], thunder: true };
  if (h.wind_gusts_10m >= 32 || h.wind_speed_10m >= 25) return { score: 0, reasons: ["Too windy"] };

  const parts = [
    band(h.precipitation_probability, [[(p) => p <= 20, 0], [(p) => p <= 40, 10, "Some rain chance"], [(p) => p <= 60, 25, "Rain likely"], [() => true, 40, "Rain very likely"]]),
    band(h.cloud_cover, [[(c) => c <= 40, 0], [(c) => c <= 70, 5, "Partly cloudy"], [() => true, 15, "Mostly cloudy"]]),
    band(h.apparent_temperature, [
      [(t) => t >= 78 && t <= 90, 0], [(t) => t >= 72 && t < 78, 10, "A bit cool"], [(t) => t > 90 && t <= 95, 10, "Hot"],
      [(t) => t >= 65 && t < 72, 25, "Cool"], [(t) => t > 95 && t <= 102, 25, "Very hot"], [() => true, 40, "Too cold"],
    ]),
    band(h.wind_speed_10m, [[(w) => w <= 12, 0], [(w) => w <= 18, 10, "Breezy"], [() => true, 25, "Windy"]]),
  ];
  const score = Math.max(0, 100 - parts.reduce((s, [, pen]) => s + pen, 0));
  return { score, reasons: parts.map(([, , r]) => r).filter(Boolean) };
}

const VERDICTS = [[80, "Great beach day"], [65, "Good"], [45, "Fair — pick your hours"], [0, "Skip it"]];
export const verdictFor = (score) => VERDICTS.find(([min]) => score >= min)[1];

// Open-Meteo times are local wall-clock strings ("2026-11-23T06:44") when
// `timezone` is set, so compare them as minutes-since-midnight.
const minutes = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function scoreDay(forecast, dayIndex = 0) {
  const { hourly, daily } = forecast;
  const date = daily.time[dayIndex];
  const start = Math.max(minutes(daily.sunrise[dayIndex]) + 60, 8 * 60);
  const end = Math.min(minutes(daily.sunset[dayIndex]) - 30, 19 * 60);

  const hours = [];
  let blockNext = false;
  hourly.time.forEach((t, i) => {
    if (!t.startsWith(date)) return;
    const h = Object.fromEntries(Object.keys(hourly).map((k) => [k, hourly[k][i]]));
    let s = scoreHour(h);
    if (blockNext && !s.thunder) s = { score: 0, reasons: ["Thunderstorms nearby"] }; // wait after thunder
    blockNext = Boolean(s.thunder);
    const m = minutes(t);
    if (m >= start && m < end) hours.push({ m, ...s });
  });

  if (hours.length < 3) return { date, verdict: "Skip it", score: 0, bestWindow: null, reasons: ["Too few daylight hours"] };

  let best = 0;
  for (let i = 1; i + 3 <= hours.length; i++) {
    const avg = (j) => (hours[j].score + hours[j + 1].score + hours[j + 2].score) / 3;
    if (avg(i) > avg(best)) best = i;
  }
  const win = hours.slice(best, best + 3);
  const score = Math.round(win.reduce((s, h) => s + h.score, 0) / 3);
  const reasons = [...new Set(win.flatMap((h) => h.reasons))].slice(0, 4);
  return {
    date,
    verdict: verdictFor(score),
    score,
    bestWindow: { start: hhmm(win[0].m), end: hhmm(win[2].m + 60) },
    reasons,
  };
}
