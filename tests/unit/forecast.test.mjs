// Whole data seam against the derived fixtures (edited copies of the real 2026-11-23 captures) and the real ones.
// Date-sensitive: also run under TZ=UTC and TZ=Pacific/Auckland. No network: fetch is injected.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { CACHE_KEY_PREFIX, buildDays, getCached, loadForecast } from '../../public/js/forecast.js';
import { OpenMeteoError, normalize } from '../../public/js/api/openmeteo.js';
import { getBeach } from '../../public/js/data/beaches.js';

const DIR = new URL('../fixtures/openmeteo/', import.meta.url);
const read = (n) => JSON.parse(readFileSync(new URL(n, DIR), 'utf8'));
const derived = (name) => read(`${name}-derived.json`);
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => m.delete(k), _m: m };
};
/** fetch that serves a derived fixture; counts calls per host. */
const serve = (fx) => {
  const calls = [];
  const fetchImpl = async (url) => {
    const host = new URL(url).host;
    calls.push(host);
    if (host === 'marine-api.open-meteo.com') return fx.marine ? json(200, fx.marine) : json(fx.marineStatus, { message: 'down' });
    return json(200, fx.forecast);
  };
  return { fetchImpl, calls };
};
const load = (name, over = {}) => {
  const fx = derived(name);
  return loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: Date.parse(fx.now), storage: memStorage(), online: true, ...over });
};

describe('derived fixtures are labelled and well formed', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('-derived.json'));
  it('13 derived files, each says so in _comment and has forecast + marine blocks', () => {
    expect(files).toHaveLength(13);
    for (const f of files) {
      const fx = read(f);
      expect(fx._comment, f).toMatch(/^DERIVED fixture, not a live capture/);
      expect(fx.forecast.hourly.time, f).toHaveLength(168);
      expect(fx.marine === null || fx.marine.hourly.time.length === 168, f).toBe(true);
      expect(Number.isFinite(Date.parse(fx.now)), f).toBe(true);
    }
  });
  it('the real captures are unmodified copies (no _comment, original layout)', () => {
    for (const f of ['forecast-miami-beach.json', 'marine-miami-beach.json', 'error-400.json', 'multi-location.json']) {
      expect(JSON.stringify(read(f))).not.toContain('DERIVED');
    }
    expect(read('forecast-miami-beach.json').hourly.time).toHaveLength(48);
  });
});

// Reason snapshots: day 0 of every scenario. Expectations were worked out by hand from the scoring table
// (docs/01 5.2), not copied from the output: good = 100-25(rain 45%)-5(cloud 50%) = 70, and so on.
const SNAP = {
  great: { verdict: 'great', score: 100, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: [], advice: ['uv_moderate'], confidence: 'high' },
  good: { verdict: 'good', score: 70, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: ['rain_chance', 'clouds'], advice: ['uv_moderate'], confidence: 'high' },
  fair: { verdict: 'fair', score: 55, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: ['rain_chance', 'clouds'], advice: ['uv_moderate'], confidence: 'high' },
  skip: { verdict: 'skip', score: 0, bestWindow: null, reasons: ['thunderstorms'], advice: ['lightning', 'uv_moderate'], confidence: 'high' },
  'short-window': { verdict: 'good', score: 79, bestWindow: { start: '15:00', end: '17:00', hours: 2 }, reasons: ['short_window'], advice: [], confidence: 'medium' },
  'window-over': { verdict: null, score: null, bestWindow: null, reasons: ['no_beach_window'], advice: [], confidence: 'low' },
  'no-verdict': { verdict: null, score: null, bestWindow: null, reasons: ['data_unavailable'], advice: [], confidence: 'low' },
  'marine-missing': { verdict: 'great', score: 100, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: [], advice: ['marine_missing', 'uv_moderate'], confidence: 'medium' },
  'thunder-afternoon': { verdict: 'great', score: 100, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: ['storm_outside_window'], advice: ['lightning', 'uv_moderate'], confidence: 'high' },
  outlook: { verdict: 'great', score: 100, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: [], advice: ['uv_moderate'], confidence: 'high' },
  'windy-front': { verdict: 'fair', score: 50, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: ['wind', 'rain_chance', 'feels_like', 'clouds'], advice: ['uv_moderate'], confidence: 'high' },
  'high-uv': { verdict: 'great', score: 100, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: [], advice: ['uv_very_high'], confidence: 'high' },
  'rough-seas': { verdict: 'fair', score: 55, bestWindow: { start: '08:00', end: '11:00', hours: 3 }, reasons: ['waves', 'rain_chance'], advice: ['uv_moderate'], confidence: 'high' },
};

describe('reason snapshots: day 0 of each derived fixture', () => {
  it.each(Object.keys(SNAP))('%s', async (name) => {
    const f = await load(name);
    const d = f.days[0];
    const want = SNAP[name];
    expect({
      verdict: d.verdict, score: d.score, bestWindow: d.bestWindow, reasons: d.reasons.map((r) => r.code),
      advice: d.advice.map((a) => a.code), confidence: d.confidence,
    }).toEqual(want);
  });
});

describe('Forecast shape (build_plan section 5 seam)', () => {
  it('returns { beach, days, fetchedAt, source, partial } for 7 days from today', async () => {
    const fx = derived('great');
    const now = Date.parse(fx.now);
    const f = await load('great');
    expect(f.beach.id).toBe('miami-beach');
    expect(f.source).toBe('network');
    expect(f.fetchedAt).toBe(now);
    expect(f.partial).toEqual({ marine: false });
    expect(f.days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(f.days.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(f.days[0].isToday).toBe(true);
    expect(f.tooOld).toBe(false);
  });
  it('days 4+ are outlook; day index 2 is not', async () => {
    const f = await load('outlook');
    expect(f.days.map((d) => d.confidence)).toEqual(['high', 'high', 'high', 'outlook', 'outlook', 'outlook', 'outlook']);
  });
  it('outlook fixture: fair on days 4-5, skip (wind stop) on days 6-7, with the stop reason', async () => {
    const f = await load('outlook');
    expect(f.days.slice(3).map((d) => d.verdict)).toEqual(['fair', 'fair', 'skip', 'skip']);
    expect(f.days[5].reasons.map((r) => r.code)).toEqual(['too_windy']);
  });
  it('times are real beach wall clock; the beach window and sunrise/sunset are included', async () => {
    const d = (await load('great')).days[0];
    expect(d.beachWindow).toEqual({ start: '08:00', end: '16:59' });
    expect([d.sunrise, d.sunset]).toEqual(['06:44', '17:29']);
  });
  it('a DayVerdict carries codes, copy ids and params; the UI maps codes to Wren\'s deck', async () => {
    const d = (await load('rough-seas')).days[0];
    expect(d.reasons[0]).toMatchObject({ code: 'waves', copyId: 'reason.waves.rough', params: { ft: 5.5 } });
    expect(d.wavesMaxFt).toBe(5.5);
    expect(d.seaTempMeanF).toBe(80.1);
    expect(d.marineAvailable).toBe(true);
  });
  it('storm outside the best window: "Thunderstorms around 2 pm" (time in beach wall clock)', async () => {
    const d = (await load('thunder-afternoon')).days[0];
    expect(d.reasons[0]).toEqual({ code: 'storm_outside_window', copyId: 'reason.storm.outside', params: { time: '2 pm' } });
  });
  it('rain 65% gives "Rain likely, {pct}%" (band [61,100]); 45% gives "{pct}% chance of rain"', async () => {
    expect((await load('fair')).days[0].reasons[0].copyId).toBe('reason.rain');
    expect((await load('good')).days[0].reasons[0].copyId).toBe('reason.rain.chance');
  });
  it('high-UV days: very high on day 1, extreme on day 2; the score is unchanged', async () => {
    const f = await load('high-uv');
    expect(f.days.slice(0, 2).map((d) => [d.score, d.advice[0].code])).toEqual([[100, 'uv_very_high'], [100, 'uv_extreme']]);
  });
});

describe('today: only slots that have not ended', () => {
  it('"now" 3:30 pm: the 3 pm slot (current hour) and 4 pm remain -> short window; tomorrow is a full day', async () => {
    const f = await load('short-window');
    expect(f.days[0].bestWindow).toEqual({ start: '15:00', end: '17:00', hours: 2 });
    expect(f.days[1].bestWindow.hours).toBe(3);
  });
  it('"now" 5:30 pm: nothing left -> no verdict + no_beach_window; tomorrow still scored', async () => {
    const f = await load('window-over');
    expect(f.days[0]).toMatchObject({ verdict: null, score: null });
    expect(f.days[0].reasons[0]).toMatchObject({ code: 'no_beach_window', copyId: 'status.after.hours' });
    expect(f.days[1].verdict).toBe('great');
  });
  it('slot boundary: at 3:59 pm the 3 pm slot counts, at 4:00 pm it does not', async () => {
    const at = (iso) => load('great', { now: Date.parse(iso) }).then((f) => f.days[0].bestWindow);
    expect(await at('2026-11-23T20:59:00Z')).toEqual({ start: '15:00', end: '17:00', hours: 2 });
    expect(await at('2026-11-23T21:00:00Z')).toEqual({ start: '16:00', end: '17:00', hours: 1 });
  });
  it('late the night before: after midnight the day index restarts at the new date', async () => {
    const f = await load('great', { now: Date.parse('2026-11-24T05:30:00Z') }); // 12:30 am EST on the 24th
    expect(f.days[0].date).toBe('2026-11-24');
    expect(f.days[0].dayIndex).toBe(0);
  });
  it('thunder in the hour before the first remaining slot blocks it (thunder wait)', async () => {
    const fx = derived('great');
    fx.forecast.hourly.weather_code[14] = 95; // 2 pm storm
    const now = Date.parse('2026-11-23T20:30:00Z'); // 3:30 pm: the 3 pm slot is the first remaining one
    const f = await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now, storage: memStorage(), online: true });
    expect(f.days[0].bestWindow).toEqual({ start: '16:00', end: '17:00', hours: 1 });
  });
});

describe('hourScores', () => {
  it('carry a verdict (null when unscored) so the UI never re-derives bands, and wall-clock HH:MM times', async () => {
    const f = await load('thunder-afternoon');
    const hs = f.days[0].hourScores;
    expect(hs[0]).toEqual({ time: '08:00', score: 100, verdict: 'great', hardStops: [] });
    expect(hs.find((h) => h.time === '14:00')).toEqual({ time: '14:00', score: 0, verdict: 'skip', hardStops: ['thunderstorms'] });
    expect(hs.find((h) => h.time === '15:00').hardStops).toEqual(['thunder_wait']);
    const nv = (await load('no-verdict')).days[0].hourScores;
    expect(nv.every((h) => h.score === null && h.verdict === null)).toBe(true);
  });
  it('DST 2027-03-14: rows labelled with the stale -05:00 offset start at 09:00 local', () => {
    const rows = Array.from({ length: 24 }, (_, h) => ({
      time: `2027-03-14T${String(h).padStart(2, '0')}:00`, tempF: 80, feelsF: 82, humidity: 50, rainChance: 0, rainIn: 0,
      weatherCode: 1, cloudPct: 10, windMph: 6, gustMph: 9, uv: 3, cape: 0, waveFt: 1, seaTempF: 80,
    }));
    const model = {
      timezone: 'America/New_York', utcOffsetSeconds: -18000, marine: { available: true, label: 'Offshore waves', snapKm: 1 },
      hours: rows, days: [{ date: '2027-03-14', sunrise: '2027-03-14T06:25', sunset: '2027-03-14T18:30' }],
    };
    const d = buildDays(model, Date.parse('2027-03-13T17:00:00Z'))[0];
    expect(d.hourScores[0].time).toBe('09:00');
    expect(d.hourScores.at(-1).time).toBe('18:00');
    expect(d.bestWindow.start).toBe('09:00');
    expect(d.beachWindow).toEqual({ start: '08:25', end: '19:00' });
  });
});

describe('marine fails soft', () => {
  it('marine 503: forecast still scores, partial.marine is true, advice says so, labelled "Waves unavailable"', async () => {
    const f = await load('marine-missing');
    expect(f.partial).toEqual({ marine: true });
    expect(f.marine).toMatchObject({ available: false, label: 'Waves unavailable' });
    expect(f.days[0]).toMatchObject({ verdict: 'great', seaTempMeanF: null, wavesMaxFt: null, marineAvailable: false });
  });
  it('the snap check: a marine cell 15 km off the point is refused (Gulf Stream), forecast unaffected', async () => {
    const fx = derived('great');
    fx.marine.latitude = 25.9; fx.marine.longitude = -79.97;
    const f = await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: Date.parse(fx.now), storage: memStorage(), online: true });
    expect(f.partial.marine).toBe(true);
    expect(f.days[0].wavesMaxFt).toBeNull();
  });
});

describe('errors', () => {
  it('forecast API 400 with nothing saved: throws kind=api (never invents a verdict)', async () => {
    const fetchImpl = async () => json(400, read('error-400.json'));
    const err = await loadForecast('miami-beach', { fetchImpl, now: 1_800_000_000_000, storage: memStorage(), online: true }).catch((e) => e);
    expect(err).toBeInstanceOf(OpenMeteoError);
    expect(err.kind).toBe('api');
  });
  it('offline with nothing saved: kind=offline, no fetch attempted', async () => {
    let calls = 0;
    const err = await loadForecast('miami-beach', { fetchImpl: async () => { calls++; }, now: 1_800_000_000_000, storage: memStorage(), online: false }).catch((e) => e);
    expect([err.kind, calls]).toEqual(['offline', 0]);
  });
  it('unknown beach id is a RangeError', async () => {
    await expect(loadForecast('atlantis', { storage: memStorage() })).rejects.toThrow(RangeError);
  });
  it('a response with the wrong shape never becomes a verdict', async () => {
    const fx = derived('great');
    delete fx.forecast.hourly.apparent_temperature;
    const err = await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: Date.parse(fx.now), storage: memStorage(), online: true }).catch((e) => e);
    expect(err.kind).toBe('shape');
  });
});

describe('cache: 30 min stale, never polls, falls back to what is saved', () => {
  const t0 = Date.parse('2026-11-23T12:00:00Z');
  it('second call within 30 min is served from the saved copy with zero requests', async () => {
    const fx = derived('great'); const s = serve(fx); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: s.fetchImpl, now: t0, storage, online: true });
    expect(s.calls.sort()).toEqual(['api.open-meteo.com', 'marine-api.open-meteo.com']);
    const again = await loadForecast('miami-beach', { fetchImpl: s.fetchImpl, now: t0 + 29 * 60_000, storage, online: true });
    expect([again.source, again.stale, s.calls.length]).toEqual(['cache', false, 2]);
  });
  it('at 30 min it refetches (stale boundary)', async () => {
    const fx = derived('great'); const s = serve(fx); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: s.fetchImpl, now: t0, storage, online: true });
    const again = await loadForecast('miami-beach', { fetchImpl: s.fetchImpl, now: t0 + 30 * 60_000, storage, online: true });
    expect([again.source, s.calls.length]).toEqual(['network', 4]);
    expect(again.fetchedAt).toBe(t0 + 30 * 60_000);
  });
  it('pull-to-refresh bypasses a fresh copy, but not more than once a minute', async () => {
    const fx = derived('great'); const s = serve(fx); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: s.fetchImpl, now: t0, storage, online: true });
    const early = await loadForecast('miami-beach', { fetchImpl: s.fetchImpl, now: t0 + 30_000, storage, online: true, userForced: true });
    expect([early.source, s.calls.length]).toEqual(['cache', 2]);
    const ok = await loadForecast('miami-beach', { fetchImpl: s.fetchImpl, now: t0 + 61_000, storage, online: true, userForced: true });
    expect([ok.source, s.calls.length]).toEqual(['network', 4]);
  });
  it('a failed refresh returns the saved copy with the error kind; stale and banner flags follow the age', async () => {
    const fx = derived('great'); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: t0, storage, online: true });
    const down = async () => { throw new TypeError('Failed to fetch'); };
    const f = await loadForecast('miami-beach', { fetchImpl: down, now: t0 + 4 * 3_600_000, storage, online: true });
    expect([f.source, f.error, f.stale, f.staleBanner, f.tooOld]).toEqual(['cache', 'network', true, true, false]);
    expect(f.days.length).toBeGreaterThan(0);
  });
  it('offline with a saved copy: served from cache, error=offline, no request', async () => {
    const fx = derived('great'); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: t0, storage, online: true });
    let calls = 0;
    const f = await loadForecast('miami-beach', { fetchImpl: async () => { calls++; }, now: t0 + 5 * 3_600_000, storage, online: false });
    expect([f.source, f.error, calls]).toEqual(['cache', 'offline', 0]);
  });
  it('older than 24 h: no verdicts at all (never show yesterday\'s answer as today\'s)', async () => {
    const fx = derived('great'); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: t0, storage, online: true });
    const f = await loadForecast('miami-beach', { fetchImpl: async () => { throw new TypeError('offline'); }, now: t0 + 24 * 3_600_000, storage, online: false });
    expect([f.tooOld, f.days, f.source]).toEqual([true, [], 'cache']);
    const justUnder = await loadForecast('miami-beach', { fetchImpl: async () => { throw new TypeError('offline'); }, now: t0 + 24 * 3_600_000 - 1, storage, online: false });
    expect(justUnder.tooOld).toBe(false);
  });
  it('a saved copy from yesterday drops yesterday and re-indexes today as day 0', async () => {
    const fx = derived('great'); const storage = memStorage();
    const t3pm = Date.parse('2026-11-23T20:00:00Z'); // 3 pm EST
    await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: t3pm, storage, online: true });
    const f = getCached('miami-beach', storage, { now: Date.parse('2026-11-24T14:00:00Z') }); // 18 h later, 9 am next day
    expect(f.days[0].date).toBe('2026-11-24');
    expect(f.days[0].dayIndex).toBe(0);
    expect(f.days).toHaveLength(6);
  });
  it('corrupt, foreign or wrong-version saved values are ignored (storage is disposable)', async () => {
    for (const bad of ['{not json', '{}', JSON.stringify({ v: 2, beachId: 'miami-beach', fetchedAt: 1, model: {} }), JSON.stringify({ v: 1, beachId: 'jupiter', fetchedAt: 1, model: {} }), 'null']) {
      const storage = memStorage();
      storage.setItem(CACHE_KEY_PREFIX + 'miami-beach', bad);
      expect(getCached('miami-beach', storage), bad).toBeNull();
    }
  });
  it('storage that throws never breaks loading', async () => {
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
    const fx = derived('great');
    const f = await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: Date.parse(fx.now), storage: boom, online: true });
    expect(f.days[0].verdict).toBe('great');
    expect(getCached('miami-beach', boom)).toBeNull();
    expect(getCached('atlantis', memStorage())).toBeNull();
  });
  it('concurrent loads for one beach share one request pair', async () => {
    const fx = derived('great'); const s = serve(fx);
    const opts = { fetchImpl: s.fetchImpl, now: Date.parse(fx.now), online: true };
    await Promise.all([loadForecast('miami-beach', { ...opts, storage: memStorage() }), loadForecast('miami-beach', { ...opts, storage: memStorage() })]);
    expect(s.calls).toHaveLength(2);
  });
  it('saves only the normalized model (no keys, no tokens) under a versioned key', async () => {
    const fx = derived('great'); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: t0, storage, online: true });
    expect([...storage._m.keys()]).toEqual(['beachday:forecast:v1:miami-beach']);
    expect(JSON.parse(storage._m.get('beachday:forecast:v1:miami-beach'))).toMatchObject({ v: 1, beachId: 'miami-beach', fetchedAt: t0 });
  });
});

describe('service-worker cache stamp (x-bd-source: cache, x-bd-fetched-at)', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const stampedFetch = (fx, stamps) => async (url) => {
    const marineHost = new URL(url).host.startsWith('marine');
    const at = marineHost ? stamps.marine : stamps.forecast;
    const body = marineHost ? fx.marine : fx.forecast;
    const h = new Map(at ? [['x-bd-source', 'cache'], ['x-bd-fetched-at', String(at)]] : []);
    return { ok: true, status: 200, headers: { get: (k) => h.get(k) ?? null }, json: async () => body };
  };
  it('a copy the service worker saved 25 h ago is too old: no verdicts, never "Updated just now"', async () => {
    const fx = derived('great'); const old = now - 25 * 3_600_000;
    const f = await loadForecast('miami-beach', { fetchImpl: stampedFetch(fx, { forecast: old, marine: old }), now, storage: memStorage(), online: true });
    expect([f.fetchedAt, f.source, f.tooOld, f.days]).toEqual([old, 'cache', true, []]);
  });
  it('the OLDEST stamp of forecast and marine wins; a 4 h stamp shows the stale banner', async () => {
    const fx = derived('great');
    const f = await loadForecast('miami-beach', { fetchImpl: stampedFetch(fx, { forecast: now - 4 * 3_600_000, marine: now - 3_600_000 }), now, storage: memStorage(), online: true });
    expect([f.fetchedAt, f.source, f.stale, f.staleBanner, f.tooOld]).toEqual([now - 4 * 3_600_000, 'cache', true, true, false]);
    expect(f.days.length).toBeGreaterThan(0);
  });
  it('responses without the headers are fresh from the network (fetchedAt = now)', async () => {
    const fx = derived('great');
    const f = await loadForecast('miami-beach', { fetchImpl: stampedFetch(fx, {}), now, storage: memStorage(), online: true });
    expect([f.fetchedAt, f.source]).toEqual([now, 'network']);
  });
  it('a saved localStorage entry that is newer than the SW stamp is returned instead', async () => {
    const fx = derived('great'); const storage = memStorage();
    await loadForecast('miami-beach', { fetchImpl: serve(fx).fetchImpl, now: now - 2 * 3_600_000, storage, online: true }); // saved 2 h ago
    const f = await loadForecast('miami-beach', { fetchImpl: stampedFetch(fx, { forecast: now - 5 * 3_600_000, marine: now - 5 * 3_600_000 }), now, storage, online: true });
    expect([f.fetchedAt, f.source]).toEqual([now - 2 * 3_600_000, 'cache']);
  });
  it('bad stamps (non-numeric, zero) count as fresh', async () => {
    const fx = derived('great');
    const f = await loadForecast('miami-beach', { fetchImpl: stampedFetch(fx, { forecast: 0, marine: 0 }), now, storage: memStorage(), online: true });
    expect(f.source).toBe('network');
  });
});

describe('real captured data end to end (2026-11-23, 2 days)', () => {
  it('scores the real Miami Beach day: drizzle code 53 on day 2 costs points; day 1 is Great', async () => {
    const forecast = read('forecast-miami-beach.json'); const marine = read('marine-miami-beach.json');
    const fetchImpl = async (url) => (new URL(url).host.startsWith('marine') ? json(200, marine) : json(200, forecast));
    const now = Date.parse('2026-11-23T12:00:00Z');
    const f = await loadForecast('miami-beach', { fetchImpl, now, storage: memStorage(), online: true, days: 2 });
    expect(f.days).toHaveLength(2);
    expect(f.days[0].verdict).toBe('great');
    expect(f.days[0].bestWindow.hours).toBe(3);
    expect(f.days[0].seaTempMeanF).toBeGreaterThan(77);
    expect(f.days[0].wavesMaxFt).toBeLessThan(2);
    // direct call: same model, DST-aware helper, same answer
    const model = normalize(forecast, marine, { marinePoint: getBeach('miami-beach').marine });
    expect(buildDays(model, now)[0].verdict).toBe('great');
  });
});
