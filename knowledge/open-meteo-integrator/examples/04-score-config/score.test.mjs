import test from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_CONFIG as C, pick } from './score-config.mjs';
import { scoreHour, scoreDay, heatIndexF } from './score.mjs';

// A calm, sunny, comfortable hour: scores 100.
const calm = (over = {}) => ({
  time: '2026-11-23T10:00', tempF: 80, feelsF: 82, humidity: 50, rainChance: 0, rainIn: 0, weatherCode: 1,
  cloudPct: 10, windMph: 6, gustMph: 9, uv: 5, cape: 0, waveFt: 1, seaTempF: 80, ...over,
});
const pts = (h, ctx) => 100 - scoreHour(h, ctx).score;

test('every band list is gapless: starts at -Infinity, strictly ascending', () => {
  for (const [name, bands] of Object.entries({ ...C.bands, uvAdvice: C.uvAdvice })) {
    assert.equal(bands[0].from, -Infinity, name);
    for (let i = 1; i < bands.length; i++) assert.ok(bands[i].from > bands[i - 1].from, `${name} ascending`);
  }
  assert.equal(C.verdict[0].from, -Infinity);
});

// Hand-written boundary table: [factor field, value, expected penalty]. Independent of the config on purpose.
const BOUNDARIES = [
  ['rainChance', 20, 0], ['rainChance', 21, 10], ['rainChance', 40, 10], ['rainChance', 41, 25], ['rainChance', 60, 25], ['rainChance', 61, 40],
  ['cloudPct', 40, 0], ['cloudPct', 41, 5], ['cloudPct', 70, 5], ['cloudPct', 71, 15],
  ['feelsF', 64.9, 40], ['feelsF', 65, 25], ['feelsF', 71.9, 25], ['feelsF', 72, 10], ['feelsF', 77.9, 10], ['feelsF', 77.99, 10], ['feelsF', 78, 0],
  ['feelsF', 90, 0], ['feelsF', 90.9, 0], ['feelsF', 91, 10], ['feelsF', 95.9, 10], ['feelsF', 96, 25], ['feelsF', 102.9, 25], ['feelsF', 103, 40],
  ['windMph', 12, 0], ['windMph', 12.9, 0], ['windMph', 13, 10], ['windMph', 18.9, 10], ['windMph', 19, 25], ['windMph', 24.9, 25],
  ['waveFt', 1.9, 0], ['waveFt', 2, 10], ['waveFt', 2.9, 10], ['waveFt', 3, 20], ['waveFt', 4.9, 20], ['waveFt', 5, 35], ['waveFt', 5.1, 35],
  ['seaTempF', 69.9, 25], ['seaTempF', 70, 15], ['seaTempF', 73.9, 15], ['seaTempF', 74, 5], ['seaTempF', 77.9, 5], ['seaTempF', 78, 0],
];
for (const [field, value, expected] of BOUNDARIES) {
  test(`boundary ${field}=${value} -> -${expected}`, () => {
    // Use a base hour that has no other penalty, so the whole 100 - score is this factor.
    const h = calm({ [field]: value });
    // keep the dependent heat index out of the way for feelsF tests
    h.heatIndexF = 80;
    assert.equal(pts(h), expected);
  });
}

test('hard stops: thunder 94/95/96/97/98/99', () => {
  const stop = (c) => scoreHour(calm({ weatherCode: c })).hardStops.includes('thunderstorms');
  assert.deepEqual([94, 95, 96, 97, 98, 99].map(stop), [false, true, true, true, false, true]);
  assert.equal(scoreHour(calm({ weatherCode: 95 })).score, 0);
});
test('hard stops: wind 24.9/25 and gust 31.9/32', () => {
  const stop = (o) => scoreHour(calm(o)).hardStops.includes('too_windy');
  assert.deepEqual([stop({ windMph: 24.9 }), stop({ windMph: 25 }), stop({ gustMph: 31.9 }), stop({ gustMph: 32 })], [false, true, false, true]);
});
test('hard stops: heat index 102.9/103/103.1 (injected)', () => {
  const stop = (hi) => scoreHour(calm({ heatIndexF: hi })).hardStops.includes('dangerous_heat');
  assert.deepEqual([stop(102.9), stop(103), stop(103.1)], [false, true, true]);
});
test('heat index: below 80 degF stays simple; 90F/50% ~ 95 (NWS chart value UNVERIFIED this session)', () => {
  assert.ok(heatIndexF(75, 40) < 80);
  assert.ok(Math.abs(heatIndexF(90, 50) - 95) <= 1, String(heatIndexF(90, 50)));
  assert.ok(heatIndexF(96, 60) > 103); // hot and humid trips the stop when computed from temp+RH
});
test('thunder wait: the hour after thunder is also 0', () => {
  const r = scoreHour(calm(), { priorThunder: true });
  assert.deepEqual([r.score, r.hardStops], [0, ['thunder_wait']]);
});
test('rain family: chance + max(amount, code), capped at 60', () => {
  assert.equal(pts(calm({ rainChance: 70, rainIn: 0.5, weatherCode: 65 })), 40 + 20); // 40 + min(25, 60-40)
  assert.equal(pts(calm({ rainChance: 30, rainIn: 0.5, weatherCode: 80 })), 10 + 15); // amount 15 == showers 15, counted once
  assert.equal(pts(calm({ rainChance: 0, weatherCode: 63 })), 25);
  assert.equal(pts(calm({ rainChance: 0, weatherCode: 62 })), 0); // 62 is not a published code: no rain penalty
});
test('rain amount is strictly greater than 0.02 in', () => {
  assert.deepEqual([0.02, 0.021].map((v) => pts(calm({ rainIn: v }))), [0, 15]);
});
test('drizzle 51/53/55 -10, fog 45/48 no penalty, unusual 71 -25', () => {
  assert.deepEqual([51, 53, 55, 45, 48, 71].map((c) => pts(calm({ weatherCode: c }))), [10, 10, 10, 0, 0, 25]);
});
test('storm risk: cape 1499/1500 x rain chance 39/40', () => {
  const p = (cape, rainChance) => scoreHour(calm({ cape, rainChance })).penalties.some((x) => x.factor === 'storm_risk');
  assert.deepEqual([p(1499, 40), p(1500, 40), p(1500, 39)], [false, true, false]);
});
test('missing marine: factor skipped, score unchanged, hour still usable', () => {
  const r = scoreHour(calm({ waveFt: null, seaTempF: null }));
  assert.deepEqual([r.score, r.usable, r.skipped], [100, true, ['waveFt', 'seaTempF']]);
});
test('missing core field: hour is unusable, never scored as fine', () => {
  const r = scoreHour(calm({ weatherCode: null }));
  assert.deepEqual([r.score, r.usable], [null, false]);
});

// Verdict bands (day level), via 3 identical hours so the average equals the hour score.
const dayOf = (over, n = 3) => Array.from({ length: n }, (_, i) => calm({ time: `2026-11-23T${String(9 + i).padStart(2, '0')}:00`, ...over }));
test('day score is the ROUNDED window average, and the verdict uses that integer', () => {
  const mk = (rc) => rc.map((r, i) => calm({ time: `2026-11-23T${String(9 + i).padStart(2, '0')}:00`, rainChance: r })); // 21% -> 90, 0% -> 100
  const d = scoreDay({ hours: mk([21, 0, 0]) }); // (90+100+100)/3 = 96.67
  assert.deepEqual([d.score, d.verdict], [97, 'great']);
});

test('bands at day level: exact cut points', () => {
  // Three identical hours, so the window average equals the hour score. Penalties come in multiples of 5,
  // so the exact cut points 80 / 65 / 45 are tested from both sides as 80|75, 65|60, 45|40.
  const hour = (p) => {
    // greedy composition of p from {rain 41%:25, waves 3 ft:20, wind 13:10, feels 91:10, cloud 41%:5}
    const o = {};
    let left = p;
    const take = (n, k, v) => { if (left >= n) { Object.assign(o, { [k]: v }); left -= n; } };
    take(25, 'rainChance', 41); take(20, 'waveFt', 3); take(10, 'windMph', 13); take(10, 'feelsF', 91); take(5, 'cloudPct', 41);
    assert.equal(left, 0, `cannot compose ${p}`);
    return calm({ time: '2026-11-23T10:00', ...o });
  };
  const v = (p) => scoreDay({ hours: [hour(p), { ...hour(p), time: '2026-11-23T11:00' }, { ...hour(p), time: '2026-11-23T12:00' }] }).verdict;
  assert.deepEqual([v(20), v(25), v(35), v(40), v(55), v(60)], ['great', 'good', 'good', 'fair', 'fair', 'skip']);
  // penalties 20,25,35,40,55,60 -> scores 80,75,65,60,45,40
});

test('window selection: best 3h, earliest wins ties, hard-stop hours make a window ineligible', () => {
  const t = (h) => `2026-11-23T${String(h).padStart(2, '0')}:00`;
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16].map((h) => calm({ time: t(h), weatherCode: h === 14 ? 95 : 1, rainChance: h >= 13 ? 30 : 0 }));
  const d = scoreDay({ hours });
  assert.deepEqual(d.bestWindow, { start: t(8), end: t(11), hours: 3 }); // tie with 9-12, 10-13: earliest
  assert.equal(d.verdict, 'great');
  assert.deepEqual(d.reasons[0], { code: 'storm_outside_window', at: t(14) }); // storm outside window gets its own reason
});
test('thunder in the hour BEFORE the window blocks the first window hour', () => {
  const hours = dayOf({});
  const d = scoreDay({ hours: [...hours, { ...calm(), time: '2026-11-23T12:00' }], priorHour: calm({ time: '2026-11-23T07:00', weatherCode: 95 }) });
  assert.equal(d.bestWindow.start, '2026-11-23T10:00'); // 09:00 blocked, so the first eligible 3h run starts at 10:00
});
test('all hours stormy: skip it, no best window, reason lists the stop', () => {
  const d = scoreDay({ hours: dayOf({ weatherCode: 95 }) });
  assert.deepEqual([d.verdict, d.bestWindow, d.reasons[0].code], ['skip', null, 'thunderstorms']);
});
test('short windows: 2 hours -> capped at good, reason + lower confidence; 0 hours -> no verdict', () => {
  const d = scoreDay({ hours: dayOf({}, 2) });
  assert.deepEqual([d.verdict, d.confidence, d.bestWindow.hours, d.reasons[0].code], ['good', 'medium', 2, 'short_window']);
  assert.equal(scoreDay({ hours: [] }).verdict, null);
});
test('confidence: marine missing -> medium; outlook days -> outlook; marine day count honest', () => {
  assert.equal(scoreDay({ hours: dayOf({}) }).confidence, 'high');
  const m = scoreDay({ hours: dayOf({ waveFt: null, seaTempF: null }) });
  assert.deepEqual([m.confidence, m.advice.map((a) => a.code).filter((c) => c.startsWith('marine')), m.seaTempMeanF], ['medium', ['marine_missing'], null]);
  assert.equal(scoreDay({ hours: dayOf({}), dayIndex: 2 }).confidence, 'high');
  assert.equal(scoreDay({ hours: dayOf({}), dayIndex: 3 }).confidence, 'outlook');
});
test('UV advice only: 5.9 moderate, 6.0 high, 7.9 high, 8.0 very high, 10.9 very high, 11.0 extreme; score unchanged', () => {
  const adv = (uv) => scoreDay({ hours: dayOf({ uv }) });
  assert.deepEqual([2.9, 3, 5.9, 6, 7.9, 8, 10.9, 11].map((uv) => adv(uv).advice[0]?.code ?? 'none'),
    ['none', 'uv_moderate', 'uv_moderate', 'uv_high', 'uv_high', 'uv_very_high', 'uv_very_high', 'uv_extreme']);
  assert.equal(adv(12).score, 100);
});
test('SST day value is the mean over the best window', () => {
  const hs = dayOf({}).map((h, i) => ({ ...h, seaTempF: 78 + i }));
  assert.equal(scoreDay({ hours: hs }).seaTempMeanF, 79);
});
test('pick(): lower bound inclusive, upper exclusive', () => {
  const bands = C.bands.windMph;
  assert.deepEqual([12.99, 13, 18.99, 19].map((x) => pick(bands, x).penalty), [0, 10, 10, 25]);
});
