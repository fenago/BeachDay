// Reference implementation of scoreHour / scoreDay (pure; no I/O, no Date use).
// Input hours use the field names of the normalizer in ../01-openmeteo-client/openmeteo.mjs.
import { SCORE_CONFIG as C, pick } from './score-config.mjs';

const has = (v) => v !== null && v !== undefined && Number.isFinite(v);

/** NWS heat index (degF) from air temperature (degF) and RH (%). UNVERIFIED this session (NWS pages were blocked). */
export function heatIndexF(t, rh) {
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) return simple; // regression is only valid at >= 80 degF
  let hi = -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t
    - 0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  if (rh > 85 && t >= 80 && t <= 87) hi += ((rh - 85) / 10) * ((87 - t) / 5);
  return hi;
}

const isThunder = (c) => C.hardStops.thunderCodes.includes(c);
const codeGroup = (c) => Object.keys(C.rain.codes).find((g) => C.rain.codes[g].includes(c)) ?? null;

/**
 * Score one hour. ctx.priorThunder: the previous hour's weather_code was thunder (30-minute rule).
 * Returns { score, usable, hardStops: [codes], penalties: [{factor, points}], skipped: [factors], thunder }.
 */
export function scoreHour(h, ctx = {}) {
  const skipped = [];
  const core = ['feelsF', 'windMph', 'weatherCode', 'rainChance'];
  if (core.some((k) => !has(h[k]))) {
    return { score: null, usable: false, hardStops: [], penalties: [], skipped: core.filter((k) => !has(h[k])), thunder: false };
  }
  const thunder = isThunder(h.weatherCode);
  const hardStops = [];
  if (thunder) hardStops.push('thunderstorms');
  else if (ctx.priorThunder) hardStops.push('thunder_wait');
  if (h.windMph >= C.hardStops.windMph || (has(h.gustMph) && h.gustMph >= C.hardStops.gustMph)) hardStops.push('too_windy');
  const hi = has(h.heatIndexF) ? h.heatIndexF : has(h.tempF) && has(h.humidity) ? heatIndexF(h.tempF, h.humidity) : null;
  if (hi !== null && hi >= C.hardStops.heatIndexF) hardStops.push('dangerous_heat');
  if (hardStops.length) return { score: 0, usable: true, hardStops, penalties: [], skipped, thunder };

  const penalties = [];
  const add = (factor, points) => { if (points > 0) penalties.push({ factor, points }); };

  // Rain family: chance + max(amount, code), capped. One wet hour is not three separate crimes.
  const chance = pick(C.bands.rainChance, h.rainChance).penalty;
  const amount = has(h.rainIn) && h.rainIn > C.rain.amountInchOver ? C.rain.amountPenalty : 0;
  const group = codeGroup(h.weatherCode);
  const code = group ? C.rain.codePenalty[group] : 0;
  const wet = Math.min(Math.max(amount, code), C.rain.familyCap - chance);
  add('rain_chance', chance);
  if (wet > 0) add(code >= amount ? (group === 'unusual' ? 'unusual_weather' : 'rain_code') : 'rain_amount', wet);

  if (has(h.cape) && h.cape >= C.stormRisk.capeJkg && h.rainChance >= C.stormRisk.rainChance) add('storm_risk', C.stormRisk.penalty);
  if (has(h.cloudPct)) add('clouds', pick(C.bands.cloudPct, h.cloudPct).penalty); else skipped.push('cloudPct');
  add('feels_like', pick(C.bands.feelsF, h.feelsF).penalty);
  add('wind', pick(C.bands.windMph, h.windMph).penalty);
  if (has(h.waveFt)) add('waves', pick(C.bands.waveFt, h.waveFt).penalty); else skipped.push('waveFt');
  if (has(h.seaTempF)) add('water_temp', pick(C.bands.seaTempF, h.seaTempF).penalty); else skipped.push('seaTempF');

  const score = Math.max(0, 100 - penalties.reduce((s, p) => s + p.points, 0));
  return { score, usable: true, hardStops, penalties, skipped, thunder };
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const hourPlus1 = (t) => `${t.slice(0, 11)}${String(Number(t.slice(11, 13)) + 1).padStart(2, '0')}:00`;
const LEVELS = ['low', 'medium', 'high'];
const verdictFor = (score) => pick(C.verdict.map((v) => ({ from: v.from, penalty: v.id })), score).penalty;

/**
 * Score a day. `hours`: normalized hours inside the beach window, in order.
 * `priorHour`: the raw hour just before the window (thunder there blocks the first window hour).
 */
export function scoreDay({ hours, priorHour = null, dayIndex = 0 }) {
  if (!hours.length) return { verdict: null, score: null, bestWindow: null, reasons: [{ code: 'no_beach_window' }], advice: [], confidence: 'low' };

  let prior = priorHour ? isThunder(priorHour.weatherCode) : false;
  const res = hours.map((h) => { const r = scoreHour(h, { priorThunder: prior }); prior = r.thunder; return r; });
  const usable = res.filter((r) => r.usable);
  if (!usable.length) return { verdict: null, score: null, bestWindow: null, reasons: [{ code: 'data_unavailable' }], advice: [], confidence: 'low' };

  const k = Math.min(C.window.bestWindowHours, hours.length);
  let best = null;
  for (let i = 0; i + k <= hours.length; i++) {
    const slice = res.slice(i, i + k);
    if (!slice.every((r) => r.usable && r.hardStops.length === 0)) continue;
    const avg = mean(slice.map((r) => r.score));
    if (!best || avg > best.avg) best = { i, avg }; // strict ">" keeps the earliest on ties
  }

  const stormTimes = hours.filter((h, i) => res[i].thunder).map((h) => h.time);
  const advice = [];
  const reasons = [];
  let score; let verdict; let bestWindow = null; let inWin = [];
  if (best) {
    score = Math.round(best.avg);
    verdict = verdictFor(score);
    inWin = res.slice(best.i, best.i + k);
    const winHours = hours.slice(best.i, best.i + k);
    bestWindow = { start: winHours[0].time, end: hourPlus1(winHours[k - 1].time), hours: k };
    const byFactor = new Map();
    for (const r of inWin) for (const p of r.penalties) byFactor.set(p.factor, (byFactor.get(p.factor) ?? 0) + p.points / k);
    for (const [factor, avgPoints] of [...byFactor].sort((a, b) => b[1] - a[1])) reasons.push({ code: factor, avgPoints: Math.round(avgPoints * 10) / 10 });
    if (k < C.window.bestWindowHours) {
      reasons.unshift({ code: 'short_window', hours: k });
      if (verdict === 'great') verdict = C.shortWindowVerdictCap;
    }
    const outside = stormTimes.filter((t) => !winHours.some((h) => h.time === t));
    if (outside.length) reasons.unshift({ code: 'storm_outside_window', at: outside[0] });
    const uv = Math.max(...winHours.filter((h) => has(h.uv)).map((h) => h.uv), -1);
    const uvLevel = uv < 0 ? 0 : pick(C.uvAdvice, uv).penalty;
    if (uvLevel) advice.push({ code: ['', 'uv_moderate', 'uv_high', 'uv_very_high', 'uv_extreme'][uvLevel], uv });
    if (winHours.some((h) => C.fogCodes.includes(h.weatherCode))) advice.push({ code: 'fog' });
  } else {
    score = Math.round(mean(usable.map((r) => r.score)));
    verdict = 'skip';
    const stops = new Set(res.flatMap((r) => r.hardStops));
    for (const s of stops) reasons.push({ code: s });
  }

  const win = best ? hours.slice(best.i, best.i + k) : hours;
  const waves = win.filter((h) => has(h.waveFt)).length / win.length;
  const sst = win.filter((h) => has(h.seaTempF)).length / win.length;
  let level = 2;
  if (waves < 1 || sst < 1) { level -= 1; advice.push({ code: waves === 0 && sst === 0 ? 'marine_missing' : 'marine_partial' }); }
  if (k < C.window.bestWindowHours || usable.length < hours.length) level -= 1;
  const confidence = dayIndex >= C.outlookFromDayIndex ? 'outlook' : LEVELS[Math.max(0, level)];
  const sstVals = win.filter((h) => has(h.seaTempF)).map((h) => h.seaTempF);

  return { verdict, score, bestWindow, reasons: reasons.slice(0, 4), advice, confidence, seaTempMeanF: sstVals.length ? Math.round(mean(sstVals) * 10) / 10 : null };
}
