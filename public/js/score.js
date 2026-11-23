// Beach Day scoring: pure functions scoreHour and scoreDay (docs/01 section 5.2, 5.3).
// No I/O, no Date, no globals. All numbers come from score-config.js.
// Input hours use the field names of the normalizer in api/openmeteo.js (preceding-hour fields already
// shifted to the slot they describe): time, feelsF, tempF, humidity, windMph, gustMph, weatherCode,
// rainChance, rainIn, cloudPct, cape, uv, waveFt, seaTempF.

import { SCORE_CONFIG as C, pick, verdictFor } from './score-config.js';

const has = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (x, places = 0) => { const f = 10 ** places; return Math.round(x * f) / f; };
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * NWS heat index (degF) from air temperature (degF) and relative humidity (%).
 * Procedure (NWS WPC): simple formula; if its average with T is below 80 degF use it, else Rothfusz with the
 * two NWS adjustments. UNVERIFIED this session: the NWS pages were blocked on 2026-11-23. Re-check before release.
 */
export function heatIndexF(t, rh) {
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) return simple;
  let hi = -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t
    - 0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  if (rh > 85 && t >= 80 && t <= 87) hi += ((rh - 85) / 10) * ((87 - t) / 5);
  return hi;
}

const isThunder = (c) => C.hardStops.thunderCodes.includes(c);
const codeGroup = (c) => Object.keys(C.rain.codes).find((g) => C.rain.codes[g].includes(c)) ?? null;
const CORE = Object.freeze(['feelsF', 'windMph', 'weatherCode', 'rainChance']);

/**
 * Score one hour.
 * ctx.priorThunder: the previous hour's weather_code was thunder (30-minute rule, hourly snapshots).
 * h.heatIndexF may be injected (tests); otherwise it is computed from tempF + humidity.
 * @returns {{score:number|null, usable:boolean, hardStops:string[], penalties:{factor:string,points:number}[],
 *            skipped:string[], thunder:boolean, rainGroup:string|null}}
 */
export function scoreHour(h, ctx = {}) {
  const skipped = [];
  const missing = CORE.filter((k) => !has(h[k]));
  if (missing.length) {
    return { score: null, usable: false, hardStops: [], penalties: [], skipped: missing, thunder: false, rainGroup: null };
  }
  const thunder = isThunder(h.weatherCode);
  const rainGroup = codeGroup(h.weatherCode);

  const hardStops = [];
  if (thunder) hardStops.push('thunderstorms');
  else if (ctx.priorThunder) hardStops.push('thunder_wait');
  if (h.windMph >= C.hardStops.windMph || (has(h.gustMph) && h.gustMph >= C.hardStops.gustMph)) hardStops.push('too_windy');
  const hi = has(h.heatIndexF) ? h.heatIndexF : has(h.tempF) && has(h.humidity) ? heatIndexF(h.tempF, h.humidity) : null;
  if (hi !== null && hi >= C.hardStops.heatIndexF) hardStops.push('dangerous_heat');
  if (hardStops.length) return { score: 0, usable: true, hardStops, penalties: [], skipped, thunder, rainGroup };

  const penalties = [];
  const add = (factor, points) => { if (points > 0) penalties.push({ factor, points }); };

  // Rain family counts once: chance + the LARGER of (amount, code), capped. One wet hour is not three crimes.
  const chance = pick(C.bands.rainChance, h.rainChance).penalty;
  const amount = has(h.rainIn) && h.rainIn > C.rain.amountInchOver ? C.rain.amountPenalty : 0;
  const code = rainGroup ? C.rain.codePenalty[rainGroup] : 0;
  const wet = Math.min(Math.max(amount, code), C.rain.familyCap - chance);
  add('rain_chance', chance);
  if (wet > 0) add(code >= amount ? (rainGroup === 'unusual' ? 'unusual_weather' : 'rain_code') : 'rain_amount', wet);

  if (has(h.cape) && h.cape >= C.stormRisk.capeJkg && h.rainChance >= C.stormRisk.rainChance) add('storm_risk', C.stormRisk.penalty);
  if (has(h.cloudPct)) add('clouds', pick(C.bands.cloudPct, h.cloudPct).penalty); else skipped.push('cloudPct');
  add('feels_like', pick(C.bands.feelsF, h.feelsF).penalty);
  add('wind', pick(C.bands.windMph, h.windMph).penalty);
  if (has(h.waveFt)) add('waves', pick(C.bands.waveFt, h.waveFt).penalty); else skipped.push('waveFt');
  if (has(h.seaTempF)) add('water_temp', pick(C.bands.seaTempF, h.seaTempF).penalty); else skipped.push('seaTempF');

  const score = Math.max(0, 100 - penalties.reduce((s, p) => s + p.points, 0));
  return { score, usable: true, hardStops, penalties, skipped, thunder, rainGroup };
}

// ---------------------------------------------------------------------------------------------------------
// Day

const STOP_ORDER = Object.freeze(['thunderstorms', 'thunder_wait', 'too_windy', 'dangerous_heat']);
const hourPlus1 = (t) => `${t.slice(0, 11)}${String(Number(t.slice(11, 13)) + 1).padStart(2, '0')}:00`;
const LEVELS = Object.freeze(['low', 'medium', 'high']);
const defaultFormatTime = (t) => {
  const h = Number(String(t).slice(11, 13));
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
};
const UV_CODES = Object.freeze(['', 'uv_moderate', 'uv_high', 'uv_very_high', 'uv_extreme']);
const UV_COPY = Object.freeze(['', 'advice.uv.moderate', 'advice.uv.high', 'advice.uv.veryhigh', 'advice.uv.extreme']);

const emptyResult = (code, copyId) => ({
  verdict: null, score: null, rawScore: null, bestWindow: null,
  reasons: [{ code, copyId, params: {} }], advice: [], confidence: 'low',
  seaTempMeanF: null, wavesMaxFt: null, marineAvailable: false, numbers: null, hourScores: [],
});

/**
 * Score a day.
 * @param hours    normalized hours INSIDE the beach window, in order (for today: only the remaining ones)
 * @param priorHour the hour just before the first hour (thunder there blocks the first hour)
 * @param dayIndex 0 = today. >= 3 gives confidence 'outlook'
 * @param formatTime (apiLocalTimeString) => "3 pm", for {time} placeholders. forecast.js passes a DST-aware one.
 * @returns {{verdict:'great'|'good'|'fair'|'skip'|null, score:number|null, rawScore:number|null,
 *   bestWindow:{start:string,end:string,hours:number}|null, reasons:{code:string,copyId:string,params:object}[],
 *   advice:{code:string,copyId:string,params:object}[], confidence:'high'|'medium'|'low'|'outlook',
 *   seaTempMeanF:number|null, wavesMaxFt:number|null, marineAvailable:boolean, numbers:object|null,
 *   hourScores:{time:string,score:number|null,hardStops:string[]}[]}}
 */
export function scoreDay({ hours, priorHour = null, dayIndex = 0, formatTime = defaultFormatTime }) {
  if (!hours || !hours.length) return emptyResult('no_beach_window', 'status.after.hours');

  let prior = priorHour ? isThunder(priorHour.weatherCode) : false;
  const res = hours.map((h) => { const r = scoreHour(h, { priorThunder: prior }); prior = r.thunder; return r; });
  const hourScores = hours.map((h, i) => ({ time: h.time, score: res[i].score, hardStops: res[i].hardStops }));
  const usable = res.filter((r) => r.usable);
  if (!usable.length) return { ...emptyResult('data_unavailable', 'status.no.verdict'), hourScores };

  const eligible = res.map((r) => r.usable && r.hardStops.length === 0);
  // Longest run of consecutive eligible hours decides the window length (3, or 1-2 for a short window).
  let longest = 0;
  for (let i = 0, run = 0; i < eligible.length; i++) { run = eligible[i] ? run + 1 : 0; longest = Math.max(longest, run); }
  const k = Math.min(C.window.bestWindowHours, longest);

  let best = null;
  for (let i = 0; k > 0 && i + k <= hours.length; i++) {
    if (!eligible.slice(i, i + k).every(Boolean)) continue;
    const avg = mean(res.slice(i, i + k).map((r) => r.score));
    if (!best || avg > best.avg) best = { i, avg }; // strict ">" keeps the earliest on ties
  }

  const stormHours = hours.filter((h, i) => res[i].thunder).map((h) => h.time);
  const anyThunderWait = res.some((r) => r.hardStops.includes('thunder_wait'));
  let reasons = [];
  const advice = [];
  let score; let verdict; let bestWindow = null; let win = hours; let winRes = res;
  let rawScore = null; // the rounded window average before any short-window cap

  if (best) {
    win = hours.slice(best.i, best.i + k);
    winRes = res.slice(best.i, best.i + k);
    score = Math.round(best.avg);
    rawScore = score;
    verdict = verdictFor(score, C);
    bestWindow = { start: win[0].time, end: hourPlus1(win[k - 1].time), hours: k };
    const short = k < C.window.bestWindowHours;
    if (short && verdictRank(verdict) > verdictRank(C.shortWindowVerdictCap)) {
      verdict = C.shortWindowVerdictCap;
      score = Math.min(score, capScore(C.shortWindowVerdictCap)); // keep number and label in agreement
    }
    const outside = stormHours.filter((t) => !win.some((h) => h.time === t));
    if (outside.length) reasons.push({ code: 'storm_outside_window', copyId: 'reason.storm.outside', params: { time: formatTime(outside[0]) } });
    if (short) reasons.push({ code: 'short_window', copyId: 'reason.short', params: { hours: k } });
    reasons.push(...penaltyReasons(win, winRes, formatTime));
    if (C.reasons.positiveOnGoodDays && (verdict === 'great' || verdict === 'good')) reasons.push(...positiveReasons(win, winRes));
  } else {
    // No eligible hour: every hour is hard-stopped or unscorable. Skip it, with the stop reasons.
    score = 0; // every usable hour is a hard stop (score 0), so the day number is 0 and agrees with Skip it
    verdict = 'skip';
    const stops = new Set(res.flatMap((r) => r.hardStops));
    for (const s of STOP_ORDER) if (stops.has(s)) reasons.push({ code: s, copyId: STOP_COPY[s], params: {} });
  }
  reasons = reasons.slice(0, C.reasons.maxShown);

  // Advice. UV uses the highest UV in the best window, unrounded (5.9 moderate, 6.0 high).
  // Order: lightning, UV high or stronger, fog, marine gaps, then the low-priority "UV moderate" line last.
  const uvs = win.filter((h) => has(h.uv)).map((h) => h.uv);
  const uvMax = uvs.length ? Math.max(...uvs) : null;
  const uvLevel = uvMax === null ? 0 : pick(C.uvAdvice, uvMax).penalty;
  const uvItem = uvLevel ? { code: UV_CODES[uvLevel], copyId: UV_COPY[uvLevel], params: { uv: round(uvMax, 1), n: Math.floor(uvMax) } } : null;
  if (stormHours.length || anyThunderWait) advice.push({ code: 'lightning', copyId: 'advice.lightning', params: {} });
  if (uvItem && uvLevel >= 2) advice.push(uvItem);
  if (win.some((h) => C.fogCodes.includes(h.weatherCode))) advice.push({ code: 'fog', copyId: 'advice.fog', params: {} });
  const wavesN = win.filter((h) => has(h.waveFt)).length;
  const sstN = win.filter((h) => has(h.seaTempF)).length;
  const marineFull = wavesN === win.length && sstN === win.length;
  if (!marineFull) {
    const none = wavesN === 0 && sstN === 0;
    advice.push({ code: none ? 'marine_missing' : 'marine_partial', copyId: none ? 'advice.marine.missing' : 'advice.marine.partial', params: {} });
  }
  if (uvItem && uvLevel === 1) advice.push(uvItem);

  // Confidence: start high; -1 for marine gaps in the window; -1 for a short window or unscorable hours.
  let level = 2;
  if (!marineFull) level -= 1;
  if ((best && k < C.window.bestWindowHours) || usable.length < hours.length) level -= 1;
  const confidence = dayIndex >= C.outlookFromDayIndex ? 'outlook' : LEVELS[Math.max(0, level)];

  const sstVals = win.filter((h) => has(h.seaTempF)).map((h) => h.seaTempF);
  const waveVals = win.filter((h) => has(h.waveFt)).map((h) => h.waveFt);
  return {
    verdict, score, rawScore, bestWindow, reasons, advice, confidence,
    seaTempMeanF: sstVals.length ? round(mean(sstVals), 1) : null, // day water temp = mean over the best window
    wavesMaxFt: waveVals.length ? round(Math.max(...waveVals), 1) : null, // day waves = max inside the best window
    marineAvailable: wavesN > 0 || sstN > 0,
    numbers: windowNumbers(win, uvMax),
    hourScores,
  };
}

const STOP_COPY = Object.freeze({
  thunderstorms: 'reason.thunder', thunder_wait: 'reason.thunder.wait', too_windy: 'reason.wind.stop', dangerous_heat: 'reason.heat.stop',
});
const verdictRank = (id) => C.verdict.findIndex((v) => v.id === id);
/** Highest whole score that still belongs to a verdict (cap used so number and label agree). */
function capScore(id) {
  const i = verdictRank(id);
  return i === C.verdict.length - 1 ? 100 : C.verdict[i + 1].from - 1;
}

/** Numbers over the window, for the key-numbers grid. Null when no data. */
function windowNumbers(win, uvMax) {
  const vals = (k) => win.map((h) => h[k]).filter(has);
  const avg = (k, p = 0) => { const v = vals(k); return v.length ? round(mean(v), p) : null; };
  const max = (k, p = 0) => { const v = vals(k); return v.length ? round(Math.max(...v), p) : null; };
  const rain = vals('rainIn');
  return {
    feelsF: avg('feelsF'), tempF: avg('tempF'), windMph: avg('windMph'), gustMph: max('gustMph'),
    rainChancePct: max('rainChance'), rainIn: rain.length ? round(rain.reduce((s, x) => s + x, 0), 2) : null,
    uv: uvMax === null ? null : round(uvMax, 1), cloudPct: avg('cloudPct'),
    waveFt: max('waveFt', 1), seaTempF: avg('seaTempF', 1),
  };
}

/** Penalty factors over the window, largest mean penalty first, with the copy id and placeholders. */
function penaltyReasons(win, winRes, formatTime) {
  const k = win.length;
  const byFactor = new Map();
  for (const r of winRes) for (const p of r.penalties) byFactor.set(p.factor, (byFactor.get(p.factor) ?? 0) + p.points / k);
  const ranked = [...byFactor].sort((a, b) => b[1] - a[1]); // Map keeps insertion order for ties
  const out = [];
  for (const [factor, avgPoints] of ranked) {
    const r = describeFactor(factor, win, winRes, formatTime);
    out.push({ code: factor, copyId: r.copyId, params: r.params, avgPoints: round(avgPoints, 1) });
  }
  return out;
}

function describeFactor(factor, win, winRes, formatTime) {
  const vals = (key) => win.map((h) => h[key]).filter(has);
  const meanOf = (key) => mean(vals(key));
  switch (factor) {
    case 'rain_chance': {
      const pct = Math.max(...vals('rainChance'));
      return { copyId: pct >= 61 ? 'reason.rain' : 'reason.rain.chance', params: { pct } };
    }
    case 'rain_code': {
      const groups = winRes.map((r) => r.rainGroup).filter((g) => g && g !== 'unusual');
      const g = ['rain', 'showers', 'drizzle'].find((x) => groups.includes(x)) ?? 'rain';
      return { copyId: { rain: 'reason.rain.code', showers: 'reason.showers', drizzle: 'reason.drizzle' }[g], params: {} };
    }
    case 'rain_amount':
      return { copyId: 'reason.rain.amount', params: { in: round(vals('rainIn').reduce((s, x) => s + x, 0), 2) } };
    case 'unusual_weather':
      return { copyId: 'reason.unusual', params: {} };
    case 'storm_risk': {
      const first = win.find((h) => has(h.cape) && h.cape >= C.stormRisk.capeJkg && h.rainChance >= C.stormRisk.rainChance);
      const after = first && first.time !== win[0].time;
      return { copyId: after ? 'reason.storms.possible' : 'reason.storms.risk', params: first ? { time: formatTime(first.time) } : {} };
    }
    case 'clouds':
      return { copyId: meanOf('cloudPct') >= 71 ? 'reason.cloudy' : 'reason.cloudy.part', params: {} };
    case 'feels_like': {
      const temp = round(meanOf('feelsF'));
      // 'reason.feels' is NOT in Wren's deck yet (neutral [72,78) case); flagged in the HANDOFF.
      const copyId = temp >= 91 ? 'reason.hot' : temp < 72 ? 'reason.cool' : 'reason.feels';
      return { copyId, params: { temp } };
    }
    case 'wind':
      return { copyId: 'reason.wind.breezy', params: { mph: round(meanOf('windMph')) } };
    case 'waves': {
      const ft = round(Math.max(...vals('waveFt')), 1);
      return { copyId: ft >= 5 ? 'reason.waves.rough' : 'reason.waves.choppy', params: { ft } };
    }
    case 'water_temp': {
      const temp = round(meanOf('seaTempF'));
      // 'reason.water' (neutral [74,78)) is NOT in Wren's deck yet; flagged in the HANDOFF.
      return { copyId: temp >= 78 ? 'reason.water.warm' : temp < 74 ? 'reason.water.cool' : 'reason.water', params: { temp } };
    }
    default:
      return { copyId: `reason.${factor}`, params: {} };
  }
}

/** D3 (off by default): what is going well. Only factors with data and no penalty anywhere in the window. */
function positiveReasons(win, winRes) {
  const out = [];
  const clean = (factor) => winRes.every((r) => !r.penalties.some((p) => p.factor === factor));
  const all = (key) => win.every((h) => has(h[key]));
  const mean1 = (key) => mean(win.map((h) => h[key]));
  if (clean('feels_like') && clean('clouds') && clean('rain_chance') && clean('rain_code') && clean('rain_amount')) {
    out.push({ code: 'sunny_comfortable', copyId: 'reason.sunny', params: { temp: round(mean1('feelsF')) } });
  }
  if (clean('wind')) out.push({ code: 'light_wind', copyId: 'reason.wind.light', params: { mph: round(mean1('windMph')) } });
  if (all('waveFt') && clean('waves')) out.push({ code: 'calm_waves', copyId: 'reason.waves.calm', params: {} });
  if (all('seaTempF') && clean('water_temp') && mean1('seaTempF') >= 78) {
    out.push({ code: 'warm_water', copyId: 'reason.water.warm', params: { temp: round(mean1('seaTempF')) } });
  }
  return out;
}
