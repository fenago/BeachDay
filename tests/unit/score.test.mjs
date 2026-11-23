import { describe, expect, it } from 'vitest';
import { scoreDay, scoreHour, heatIndexF } from '../../public/js/score.js';
import { SCORE_CONFIG as C } from '../../public/js/score-config.js';

// A calm, sunny, comfortable hour that scores exactly 100.
const calm = (over = {}) => ({
  time: '2026-11-23T10:00', tempF: 80, feelsF: 82, humidity: 50, rainChance: 0, rainIn: 0, weatherCode: 1,
  cloudPct: 10, windMph: 6, gustMph: 9, uv: 5, cape: 0, waveFt: 1, seaTempF: 80, ...over,
});
const pts = (h, ctx) => 100 - scoreHour(h, ctx).score;
const T = (h) => `2026-11-23T${String(h).padStart(2, '0')}:00`;
const dayOf = (over, n = 3, start = 9) => Array.from({ length: n }, (_, i) => calm({ time: T(start + i), ...over }));

// Hand-written boundary table (docs/01 5.6), independent of the config on purpose:
// [field, value, expected penalty]. Both sides of every edge, and the edge itself.
const BOUNDARIES = [
  ['rainChance', 20, 0], ['rainChance', 21, 10], ['rainChance', 40, 10], ['rainChance', 41, 25], ['rainChance', 60, 25], ['rainChance', 61, 40], ['rainChance', 100, 40],
  ['cloudPct', 40, 0], ['cloudPct', 41, 5], ['cloudPct', 70, 5], ['cloudPct', 71, 15],
  ['feelsF', 64.9, 40], ['feelsF', 65, 25], ['feelsF', 71.9, 25], ['feelsF', 72, 10], ['feelsF', 77.9, 10], ['feelsF', 77.99, 10], ['feelsF', 78, 0],
  ['feelsF', 90, 0], ['feelsF', 90.9, 0], ['feelsF', 91, 10], ['feelsF', 95.9, 10], ['feelsF', 96, 25], ['feelsF', 102.9, 25], ['feelsF', 103, 40],
  ['windMph', 12, 0], ['windMph', 12.9, 0], ['windMph', 13, 10], ['windMph', 18.9, 10], ['windMph', 19, 25], ['windMph', 24.9, 25],
  ['waveFt', 1.9, 0], ['waveFt', 2, 10], ['waveFt', 2.9, 10], ['waveFt', 3, 20], ['waveFt', 4.9, 20], ['waveFt', 5, 35], ['waveFt', 5.1, 35],
  ['seaTempF', 69.9, 25], ['seaTempF', 70, 15], ['seaTempF', 73.9, 15], ['seaTempF', 74, 5], ['seaTempF', 77.9, 5], ['seaTempF', 78, 0],
];

describe('hour penalties: every band edge from both sides', () => {
  it.each(BOUNDARIES)('%s = %s -> -%s', (field, value, expected) => {
    const h = calm({ [field]: value });
    h.heatIndexF = 80; // keep the computed heat index out of the feels-like cases
    expect(pts(h)).toBe(expected);
  });
});

describe('hard stops', () => {
  it('thunder codes 94/95/96/97/98/99', () => {
    const stop = (c) => scoreHour(calm({ weatherCode: c })).hardStops.includes('thunderstorms');
    expect([94, 95, 96, 97, 98, 99].map(stop)).toEqual([false, true, true, true, false, true]);
    expect(scoreHour(calm({ weatherCode: 95 })).score).toBe(0);
  });
  it('wind 24.9/25 and gust 31.9/32', () => {
    const stop = (o) => scoreHour(calm(o)).hardStops.includes('too_windy');
    expect([stop({ windMph: 24.9 }), stop({ windMph: 25 }), stop({ gustMph: 31.9 }), stop({ gustMph: 32 })]).toEqual([false, true, false, true]);
  });
  it('heat index 102.9/103/103.1 (injected)', () => {
    const stop = (hi) => scoreHour(calm({ heatIndexF: hi })).hardStops.includes('dangerous_heat');
    expect([stop(102.9), stop(103), stop(103.1)]).toEqual([false, true, true]);
  });
  it('heat index is computed from air temperature + humidity, not apparent temperature', () => {
    expect(scoreHour(calm({ tempF: 96, humidity: 60, feelsF: 85 })).hardStops).toContain('dangerous_heat');
    expect(scoreHour(calm({ tempF: 85, humidity: 50, feelsF: 110 })).hardStops).not.toContain('dangerous_heat');
  });
  it('heatIndexF: simple formula below 80 F, Rothfusz above (NWS chart values UNVERIFIED)', () => {
    expect(heatIndexF(75, 40)).toBeLessThan(80);
    expect(Math.abs(heatIndexF(90, 50) - 95)).toBeLessThanOrEqual(1);
    expect(heatIndexF(96, 60)).toBeGreaterThan(103);
  });
  it('thunder wait: the hour after thunder is also 0', () => {
    const r = scoreHour(calm(), { priorThunder: true });
    expect([r.score, r.hardStops]).toEqual([0, ['thunder_wait']]);
    expect(scoreHour(calm({ weatherCode: 95 }), { priorThunder: true }).hardStops).toEqual(['thunderstorms']);
  });
});

describe('rain family and other stacking', () => {
  it('chance + max(amount, code), capped at 60', () => {
    expect(pts(calm({ rainChance: 70, rainIn: 0.5, weatherCode: 65 }))).toBe(60); // 40 + min(25, 60-40)
    expect(pts(calm({ rainChance: 30, rainIn: 0.5, weatherCode: 80 }))).toBe(25); // amount 15 == showers 15, counted once
    expect(pts(calm({ rainChance: 0, weatherCode: 63 }))).toBe(25);
    expect(pts(calm({ rainChance: 0, weatherCode: 62 }))).toBe(0); // 62 is not a published code
    expect(pts(calm({ rainChance: 0, weatherCode: 64 }))).toBe(0);
  });
  it('rain amount is strictly greater than 0.02 in (D8)', () => {
    expect([0.02, 0.021].map((v) => pts(calm({ rainIn: v })))).toEqual([0, 15]);
  });
  it('drizzle -10, showers -15, rain -25, fog 0, unusual -25 (all 10 unusual codes)', () => {
    expect([51, 53, 55].map((c) => pts(calm({ weatherCode: c })))).toEqual([10, 10, 10]);
    expect([80, 81, 82].map((c) => pts(calm({ weatherCode: c })))).toEqual([15, 15, 15]);
    expect([61, 63, 65].map((c) => pts(calm({ weatherCode: c })))).toEqual([25, 25, 25]);
    expect([45, 48].map((c) => pts(calm({ weatherCode: c })))).toEqual([0, 0]);
    expect([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].map((c) => pts(calm({ weatherCode: c })))).toEqual(Array(10).fill(25));
    expect(scoreHour(calm({ weatherCode: 71 })).penalties[0].factor).toBe('unusual_weather');
  });
  it('an unknown code is never "clear": no penalty, and not read as a clear-sky reason', () => {
    const r = scoreHour(calm({ weatherCode: 94 }));
    expect(r.penalties).toEqual([]);
    expect(r.usable).toBe(true);
  });
  it('storm risk: cape 1499/1500 x rain chance 39/40', () => {
    const p = (cape, rainChance) => scoreHour(calm({ cape, rainChance })).penalties.some((x) => x.factor === 'storm_risk');
    expect([p(1499, 40), p(1500, 40), p(1500, 39)]).toEqual([false, true, false]);
  });
  it('independent factors add without another cap', () => {
    // 40 (rain 61) + 25 (rain code 65 capped to 20) + 15 (clouds) + 40 (feels 64) + 25 (wind 19) + 35 (waves 5) + 25 (sea 69) = 200 -> floor 0
    const h = calm({ rainChance: 61, weatherCode: 65, cloudPct: 80, feelsF: 64, windMph: 19, waveFt: 5, seaTempF: 69, heatIndexF: 70 });
    expect(scoreHour(h).score).toBe(0);
  });
});

describe('missing data', () => {
  it('missing marine: factors skipped, score unchanged, hour still usable', () => {
    const r = scoreHour(calm({ waveFt: null, seaTempF: null }));
    expect([r.score, r.usable, r.skipped]).toEqual([100, true, ['waveFt', 'seaTempF']]);
  });
  it.each(['feelsF', 'windMph', 'weatherCode', 'rainChance'])('core field %s null: hour unusable, never scored as fine', (k) => {
    const r = scoreHour(calm({ [k]: null }));
    expect([r.score, r.usable]).toEqual([null, false]);
  });
  it('NaN and undefined count as missing', () => {
    expect(scoreHour(calm({ windMph: NaN })).usable).toBe(false);
    expect(scoreHour(calm({ feelsF: undefined })).usable).toBe(false);
  });
});

describe('day verdict', () => {
  it('the score is the ROUNDED window average and the verdict uses that integer', () => {
    const hours = [21, 0, 0].map((rc, i) => calm({ time: T(9 + i), rainChance: rc })); // (90+100+100)/3 = 96.67
    const d = scoreDay({ hours });
    expect([d.score, d.verdict]).toEqual([97, 'great']);
  });

  it('rounding happens before banding: 78.33 -> 78 Good, 81.67 -> 82 Great', () => {
    const pen = { 0: {}, 15: { rainChance: 21, cloudPct: 41 }, 20: { waveFt: 3 }, 25: { rainChance: 41 } };
    const day = (ps) => scoreDay({ hours: ps.map((p, i) => calm({ time: T(9 + i), ...pen[p] })) });
    const a = day([20, 20, 25]); // scores 80, 80, 75 -> 78.33
    const b = day([15, 20, 20]); // scores 85, 80, 80 -> 81.67
    expect([a.score, a.verdict, b.score, b.verdict]).toEqual([78, 'good', 82, 'great']);
  });

  it('exact cut points 80/75, 65/60, 45/40 at day level', () => {
    const compose = (p) => {
      const o = {};
      let left = p;
      const take = (n, k, v) => { if (left >= n) { Object.assign(o, { [k]: v }); left -= n; } };
      take(25, 'rainChance', 41); take(20, 'waveFt', 3); take(10, 'windMph', 13); take(10, 'feelsF', 91); take(5, 'cloudPct', 41);
      expect(left).toBe(0);
      return o;
    };
    const verdict = (p) => scoreDay({ hours: dayOf(compose(p)) }).verdict;
    // penalties 20, 25, 35, 40, 55, 60 -> scores 80, 75, 65, 60, 45, 40
    expect([20, 25, 35, 40, 55, 60].map(verdict)).toEqual(['great', 'good', 'good', 'fair', 'fair', 'skip']);
    expect([20, 25, 35, 40, 55, 60].map((p) => scoreDay({ hours: dayOf(compose(p)) }).score)).toEqual([80, 75, 65, 60, 45, 40]);
  });

  it('best 3-hour window: earliest wins ties; a hard-stop hour makes a window ineligible; storm outside gets its own reason', () => {
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16].map((h) => calm({ time: T(h), weatherCode: h === 14 ? 95 : 1, rainChance: h >= 13 ? 30 : 0 }));
    const d = scoreDay({ hours });
    expect(d.bestWindow).toEqual({ start: T(8), end: T(11), hours: 3 }); // ties with 9-12 and 10-13: earliest
    expect(d.verdict).toBe('great');
    expect(d.reasons[0]).toMatchObject({ code: 'storm_outside_window', copyId: 'reason.storm.outside', params: { time: '2 pm' } });
    expect(d.advice.map((a) => a.code)).toContain('lightning');
  });

  it('a better window later in the day beats an earlier worse one', () => {
    const hours = [8, 9, 10, 11, 12, 13].map((h) => calm({ time: T(h), rainChance: h < 11 ? 45 : 0 }));
    expect(scoreDay({ hours }).bestWindow).toEqual({ start: T(11), end: T(14), hours: 3 });
  });

  it('thunder in the hour BEFORE the window blocks the first window hour', () => {
    const d = scoreDay({ hours: dayOf({}, 4), priorHour: calm({ time: T(8), weatherCode: 95 }) });
    expect(d.bestWindow.start).toBe(T(10)); // 09:00 blocked, first eligible run is 10-12
    expect(d.bestWindow.hours).toBe(3);
  });

  it('thunder wait: the hour after a storm hour is not in the window', () => {
    const hours = [8, 9, 10, 11, 12, 13, 14].map((h) => calm({ time: T(h), weatherCode: h === 9 ? 95 : 1 }));
    const d = scoreDay({ hours });
    expect(d.bestWindow.start).toBe(T(11)); // 9 storm, 10 wait, 11-13 first run of 3
    expect(d.reasons[0].code).toBe('storm_outside_window');
  });

  it('all hours stormy: Skip it, no best window, the stop is the reason', () => {
    const d = scoreDay({ hours: dayOf({ weatherCode: 95 }) });
    expect([d.verdict, d.bestWindow, d.reasons[0].code, d.score]).toEqual(['skip', null, 'thunderstorms', 0]);
    expect(d.advice.map((a) => a.code)).toContain('lightning');
  });

  it('no eligible hour (stops and unscorable only): Skip it with the stop reasons, score 0', () => {
    const hours = [calm({ time: T(9), windMph: 26 }), calm({ time: T(10), windMph: 26 }), calm({ time: T(11), windMph: null })];
    const d = scoreDay({ hours });
    expect([d.verdict, d.score, d.bestWindow, d.reasons.map((r) => r.code)]).toEqual(['skip', 0, null, ['too_windy']]);
  });
  it('stop reasons come in a fixed order: thunderstorms, thunder_wait, too_windy, dangerous_heat', () => {
    const hours = [calm({ time: T(9), weatherCode: 95 }), calm({ time: T(10), windMph: 30 }), calm({ time: T(11), heatIndexF: 110, windMph: 30 })];
    expect(scoreDay({ hours }).reasons.map((r) => r.code)).toEqual(['thunderstorms', 'thunder_wait', 'too_windy', 'dangerous_heat']);
  });

  it('short windows: 2 hours -> capped at Good with the number capped too; confidence drops', () => {
    const d = scoreDay({ hours: dayOf({}, 2) });
    expect(d.verdict).toBe('good');
    expect(d.score).toBe(79);
    expect(d.rawScore).toBe(100);
    expect(d.confidence).toBe('medium');
    expect(d.bestWindow.hours).toBe(2);
    expect(d.reasons[0]).toMatchObject({ code: 'short_window', copyId: 'reason.short', params: { hours: 2 } });
  });
  it('short window that scores below Good keeps its own verdict', () => {
    const d = scoreDay({ hours: dayOf({ rainChance: 65, cloudPct: 50 }, 1) });
    expect([d.verdict, d.score, d.bestWindow.hours]).toEqual(['fair', 55, 1]);
  });
  it('short window made by hard stops (runs of 2) uses the longest run', () => {
    const hours = [8, 9, 10, 11, 12].map((h) => calm({ time: T(h), weatherCode: h === 10 ? 95 : 1 }));
    const d = scoreDay({ hours });
    expect(d.bestWindow).toEqual({ start: T(8), end: T(10), hours: 2 }); // 8-9 and 12 (wait on 11): earliest 2-run
    expect(d.reasons.map((r) => r.code).slice(0, 2)).toEqual(['storm_outside_window', 'short_window']);
  });
  it('0 hours -> no verdict, reason no_beach_window; all hours unscorable -> data_unavailable', () => {
    const none = scoreDay({ hours: [] });
    expect([none.verdict, none.reasons[0].code, none.reasons[0].copyId]).toEqual([null, 'no_beach_window', 'status.after.hours']);
    const bad = scoreDay({ hours: dayOf({ weatherCode: null }) });
    expect([bad.verdict, bad.reasons[0].code, bad.reasons[0].copyId]).toEqual([null, 'data_unavailable', 'status.no.verdict']);
  });
  it('an unscorable hour inside the day lowers confidence but the rest still scores', () => {
    const hours = [calm({ time: T(8) }), calm({ time: T(9) }), calm({ time: T(10) }), calm({ time: T(11), weatherCode: null })];
    const d = scoreDay({ hours });
    expect([d.verdict, d.confidence]).toEqual(['great', 'medium']);
  });
});

describe('confidence and marine', () => {
  it('high by default; day index 2 stays high; day index 3 is outlook', () => {
    expect(scoreDay({ hours: dayOf({}) }).confidence).toBe('high');
    expect(scoreDay({ hours: dayOf({}), dayIndex: 2 }).confidence).toBe('high');
    expect(scoreDay({ hours: dayOf({}), dayIndex: 3 }).confidence).toBe('outlook');
  });
  it('marine all missing -> medium + marine_missing; some missing -> marine_partial; numbers null', () => {
    const m = scoreDay({ hours: dayOf({ waveFt: null, seaTempF: null }) });
    expect([m.confidence, m.advice.map((a) => a.code).filter((c) => c.startsWith('marine')), m.seaTempMeanF, m.wavesMaxFt, m.marineAvailable])
      .toEqual(['medium', ['marine_missing'], null, null, false]);
    const hours = dayOf({}); hours[1].waveFt = null;
    const p = scoreDay({ hours });
    expect([p.confidence, p.advice.map((a) => a.code)]).toEqual(['medium', ['marine_partial', 'uv_moderate']]);
  });
  it('marine missing AND short window: confidence low', () => {
    expect(scoreDay({ hours: dayOf({ waveFt: null, seaTempF: null }, 2) }).confidence).toBe('low');
  });
  it('day water temp is the mean over the BEST window; waves are the max inside it', () => {
    const hs = dayOf({}).map((h, i) => ({ ...h, seaTempF: 78 + i, waveFt: 1 + i * 0.25 }));
    const d = scoreDay({ hours: hs });
    expect([d.seaTempMeanF, d.wavesMaxFt]).toEqual([79, 1.5]);
  });
  it('waves outside the best window do not leak into the day number', () => {
    const hours = [8, 9, 10, 11, 12].map((h) => calm({ time: T(h), waveFt: h === 12 ? 6 : 1, }));
    expect(scoreDay({ hours }).wavesMaxFt).toBe(1); // best window is 8-11; the rough hour at 12 is outside it
  });
});

describe('UV advice only', () => {
  const adv = (uv) => scoreDay({ hours: dayOf({ uv }) });
  it('2.9 none, 3 moderate, 5.9 moderate, 6.0 high, 7.9 high, 8.0 very high, 10.9 very high, 11.0 extreme', () => {
    expect([2.9, 3, 5.9, 6, 7.9, 8, 10.9, 11].map((uv) => adv(uv).advice.find((a) => a.code.startsWith('uv_'))?.code ?? 'none'))
      .toEqual(['none', 'uv_moderate', 'uv_moderate', 'uv_high', 'uv_high', 'uv_very_high', 'uv_very_high', 'uv_extreme']);
  });
  it('never changes the score; the highest UV in the best window is used', () => {
    expect(adv(12).score).toBe(100);
    const hs = dayOf({}).map((h, i) => ({ ...h, uv: [2, 9, 4][i] }));
    expect(scoreDay({ hours: hs }).advice.find((a) => a.code.startsWith('uv_')).code).toBe('uv_very_high');
  });
  it('moderate UV is the last, low-priority advice line; strong UV comes before marine notes', () => {
    const hs = dayOf({ waveFt: null, seaTempF: null });
    expect(scoreDay({ hours: hs.map((h) => ({ ...h, uv: 4 })) }).advice.map((a) => a.code)).toEqual(['marine_missing', 'uv_moderate']);
    expect(scoreDay({ hours: hs.map((h) => ({ ...h, uv: 9 })) }).advice.map((a) => a.code)).toEqual(['uv_very_high', 'marine_missing']);
  });
  it('fog 45/48: advice only, no penalty', () => {
    const d = scoreDay({ hours: dayOf({ weatherCode: 45 }) });
    expect(d.score).toBe(100);
    expect(d.advice.map((a) => a.code)).toContain('fog');
  });
});

describe('reasons: codes, copy ids, placeholders, order, limit', () => {
  it('rain chance picks its text by band: [21,61) "chance of rain", [61,100] "Rain likely"', () => {
    const r = (pct) => scoreDay({ hours: dayOf({ rainChance: pct }) }).reasons[0];
    expect([r(21), r(60), r(61)].map((x) => x.copyId)).toEqual(['reason.rain.chance', 'reason.rain.chance', 'reason.rain']);
    expect(r(60).params).toEqual({ pct: 60 });
  });
  it('clouds: [41,71) partly, [71,100] mostly', () => {
    const r = (c) => scoreDay({ hours: dayOf({ cloudPct: c }) }).reasons[0].copyId;
    expect([r(41), r(70), r(71)]).toEqual(['reason.cloudy.part', 'reason.cloudy.part', 'reason.cloudy']);
  });
  it('rain code picks rain / showers / drizzle copy', () => {
    const r = (code) => scoreDay({ hours: dayOf({ weatherCode: code }) }).reasons[0].copyId;
    expect([r(61), r(80), r(51)]).toEqual(['reason.rain.code', 'reason.showers', 'reason.drizzle']);
  });
  it('rain amount reason when the amount is the larger of amount and code', () => {
    const d = scoreDay({ hours: dayOf({ rainIn: 0.5 }) });
    expect(d.reasons[0]).toMatchObject({ code: 'rain_amount', copyId: 'reason.rain.amount', params: { in: 1.5 } }); // total over 3 hours
  });
  it('waves: choppy [2,5), rough from 5 ft, with {ft} = max', () => {
    const r = (ft) => scoreDay({ hours: dayOf({ waveFt: ft }) }).reasons[0];
    expect([r(2).copyId, r(4.9).copyId, r(5).copyId]).toEqual(['reason.waves.choppy', 'reason.waves.choppy', 'reason.waves.rough']);
    expect(r(5.5).params).toEqual({ ft: 5.5 });
  });
  it('feels like: hot from 91, cool below 72, neutral otherwise; wind breezy; water cool/neutral', () => {
    const first = (o) => scoreDay({ hours: dayOf(o) }).reasons[0];
    expect(first({ feelsF: 92, heatIndexF: 80 }).copyId).toBe('reason.hot');
    expect(first({ feelsF: 70, heatIndexF: 80 }).copyId).toBe('reason.cool');
    expect(first({ feelsF: 75, heatIndexF: 80 }).copyId).toBe('reason.feels');
    expect(first({ windMph: 14 })).toMatchObject({ code: 'wind', copyId: 'reason.wind.breezy', params: { mph: 14 } });
    expect(first({ seaTempF: 72 })).toMatchObject({ code: 'water_temp', copyId: 'reason.water.cool', params: { temp: 72 } });
    expect(first({ seaTempF: 76 }).copyId).toBe('reason.water');
  });
  it('storm risk: "after {time}" when the first risky hour is not the first window hour', () => {
    const hs = [calm({ time: T(9) }), calm({ time: T(10) }), calm({ time: T(11), cape: 2000, rainChance: 45 })];
    const r = scoreDay({ hours: hs, formatTime: (t) => `at ${t.slice(11, 13)}` }).reasons.find((x) => x.code === 'storm_risk');
    expect(r).toMatchObject({ copyId: 'reason.storms.possible', params: { time: 'at 11' } });
  });
  it('largest mean penalty first; at most 4 reasons; the best window drives them', () => {
    const d = scoreDay({ hours: dayOf({ rainChance: 61, cloudPct: 80, feelsF: 96, windMph: 19, waveFt: 5, seaTempF: 69, heatIndexF: 80 }) });
    expect(d.reasons).toHaveLength(4);
    const pts = d.reasons.map((r) => r.avgPoints);
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
  });
  it('the safety line is never a reason code', () => {
    const d = scoreDay({ hours: dayOf({ rainChance: 61, cloudPct: 80 }) });
    for (const r of d.reasons) expect(r.code).not.toMatch(/rip|nws|safety|flag/i);
  });
  it('numbers over the best window for the key-numbers grid', () => {
    const d = scoreDay({ hours: dayOf({ windMph: 8, gustMph: 14, rainIn: 0.01, uv: 4 }) });
    expect(d.numbers).toMatchObject({ feelsF: 82, tempF: 80, windMph: 8, gustMph: 14, rainChancePct: 0, rainIn: 0.03, uv: 4, waveFt: 1, seaTempF: 80 });
  });
});

describe('D3: positive reasons on good days (SCORE_CONFIG.reasons.positiveOnGoodDays)', () => {
  it('default (false): a perfect day lists no reasons', () => {
    expect(scoreDay({ hours: dayOf({}) }).reasons).toEqual([]);
  });
  it('when true: a Great day lists what is going well, using codes that have strings in the deck', async () => {
    // The config is frozen on purpose, so load a second copy of score.js bound to a modified config.
    const cfgUrl = new URL('../../public/js/score-config.js', import.meta.url).href;
    const src = (await import('node:fs')).readFileSync(new URL('../../public/js/score.js', import.meta.url), 'utf8');
    const patched = src.replace("'./score-config.js'", JSON.stringify(cfgUrl + '?d3on'));
    const cfgSrc = (await import('node:fs')).readFileSync(new URL('../../public/js/score-config.js', import.meta.url), 'utf8')
      .replace('positiveOnGoodDays: false', 'positiveOnGoodDays: true');
    const toData = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
    const cfgData = toData(cfgSrc);
    const mod = await import(toData(patched.replace(JSON.stringify(cfgUrl + '?d3on'), JSON.stringify(cfgData))));
    const d = mod.scoreDay({ hours: dayOf({}) });
    expect(d.reasons.map((r) => r.code)).toEqual(['sunny_comfortable', 'light_wind', 'calm_waves', 'warm_water']);
    expect(d.reasons.map((r) => r.copyId)).toEqual(['reason.sunny', 'reason.wind.light', 'reason.waves.calm', 'reason.water.warm']);
    expect(d.reasons[0].params).toEqual({ temp: 82 });
    // a Skip day never gets positive reasons
    expect(mod.scoreDay({ hours: dayOf({ weatherCode: 95 }) }).reasons.map((r) => r.code)).toEqual(['thunderstorms']);
    // and the default module is unchanged
    expect(C.reasons.positiveOnGoodDays).toBe(false);
  });
});

describe('purity', () => {
  it('scoreDay does not mutate its input and is deterministic', () => {
    const hours = dayOf({ rainChance: 45 });
    const copy = structuredClone(hours);
    const a = scoreDay({ hours, dayIndex: 1 });
    const b = scoreDay({ hours, dayIndex: 1 });
    expect(hours).toEqual(copy);
    expect(a).toEqual(b);
  });
});
