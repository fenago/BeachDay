// Real fixtures: tests/fixtures/openmeteo/{forecast,marine}-miami-beach.json, error-400.json, multi-location.json
// were captured 2026-11-23 and are unmodified. Nothing here touches the network.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FORECAST_DAILY, FORECAST_HOURLY, MARINE_HOURLY, OpenMeteoError, buildForecastUrl, buildMarineUrl, cToF, distanceKm,
  fetchJson, loadBeach, normalize, splitLocations, validateResponse,
} from '../../public/js/api/openmeteo.js';
import { getBeach } from '../../public/js/data/beaches.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`../fixtures/openmeteo/${n}`, import.meta.url), 'utf8'));
const forecast = fx('forecast-miami-beach.json');
const marine = fx('marine-miami-beach.json');
const BEACH = getBeach('miami-beach');

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('request URLs', () => {
  it('forecast: exact variables, units, timezone, explicit days', () => {
    const u = new URL(buildForecastUrl(BEACH.land, { days: 7 }));
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('hourly')).toBe('temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,cape,is_day');
    expect(u.searchParams.get('daily')).toBe('sunrise,sunset,uv_index_max,precipitation_probability_max,weather_code');
    expect(u.searchParams.get('timezone')).toBe('America/New_York');
    expect(u.searchParams.get('forecast_days')).toBe('7');
    expect(u.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(u.searchParams.get('wind_speed_unit')).toBe('mph');
    expect(u.searchParams.get('precipitation_unit')).toBe('inch');
    expect(u.searchParams.get('latitude')).toBe('25.781');
    expect(u.searchParams.get('longitude')).toBe('-80.13');
    expect(u.searchParams.has('models')).toBe(false); // best_match: never set models
    expect(u.searchParams.has('apikey')).toBe(false);
    expect(FORECAST_HOURLY.length + FORECAST_DAILY.length).toBe(18);
  });
  it('forecast_days range 1..16', () => {
    expect(() => buildForecastUrl(BEACH.land, { days: 0 })).toThrow(RangeError);
    expect(() => buildForecastUrl(BEACH.land, { days: 17 })).toThrow(RangeError);
    expect(new URL(buildForecastUrl(BEACH.land, { days: 16 })).searchParams.get('forecast_days')).toBe('16');
  });
  it('marine: imperial, explicit forecast_days, max 8, marine point, 8 variables', () => {
    const u = new URL(buildMarineUrl(BEACH.marine, { days: 7 }));
    expect(u.host).toBe('marine-api.open-meteo.com');
    expect(u.pathname).toBe('/v1/marine');
    expect(u.searchParams.get('length_unit')).toBe('imperial');
    expect(u.searchParams.get('forecast_days')).toBe('7');
    expect(u.searchParams.get('hourly')).toBe(MARINE_HOURLY.join(','));
    expect(u.searchParams.get('daily')).toBe('wave_height_max');
    expect(u.searchParams.get('latitude')).toBe('25.781');
    expect(u.searchParams.get('longitude')).toBe('-80.11');
    expect(MARINE_HOURLY.length + 1).toBeLessThanOrEqual(10); // stays one call
    expect(() => buildMarineUrl(BEACH.marine, { days: 9 })).toThrow(RangeError);
    expect(() => buildMarineUrl(BEACH.marine, { days: 0 })).toThrow(RangeError);
  });
  it('bad coordinates throw', () => {
    expect(() => buildForecastUrl({ lat: NaN, lon: 1 })).toThrow(TypeError);
    expect(() => buildForecastUrl({ lat: '25', lon: 1 })).toThrow(TypeError);
  });
});

describe('validation', () => {
  it('real fixtures validate; broken shapes are rejected', () => {
    validateResponse(forecast, { hourly: FORECAST_HOURLY, daily: FORECAST_DAILY });
    validateResponse(marine, { hourly: MARINE_HOURLY });
    const broken = structuredClone(forecast);
    broken.hourly.uv_index.pop();
    expect(() => validateResponse(broken, { hourly: ['uv_index'] })).toThrow(/length 47 != time length 48/);
    expect(() => validateResponse(fx('multi-location.json'))).toThrow(/single-location/);
    expect(() => validateResponse(null)).toThrow(OpenMeteoError);
    expect(() => validateResponse({ ...forecast, utc_offset_seconds: 'x' })).toThrow(/utc_offset_seconds/);
  });
  it('wrong units are refused (km/h would be read as mph)', () => {
    const f = structuredClone(forecast);
    f.hourly_units.wind_speed_10m = 'km/h';
    expect(() => normalize(f, null)).toThrow(/unit for wind_speed_10m/);
    const f2 = structuredClone(forecast);
    f2.hourly_units.temperature_2m = '°C';
    expect(() => normalize(f2, null)).toThrow(/unit for temperature_2m/);
  });
  it('the real unit strings pass: "mp/h" (observed) and "mph"', () => {
    expect(forecast.hourly_units.wind_speed_10m).toBe('mp/h');
    normalize(forecast, null);
    const f = structuredClone(forecast);
    f.hourly_units.wind_speed_10m = 'mph'; f.hourly_units.wind_gusts_10m = 'mph';
    normalize(f, null);
  });
  it('a forecast that fails validation throws kind=shape and never yields a model', () => {
    const f = structuredClone(forecast);
    delete f.hourly.cape;
    try { normalize(f, null); expect.unreachable(); } catch (e) { expect(e).toBeInstanceOf(OpenMeteoError); expect(e.kind).toBe('shape'); }
  });
});

describe('normalize (real fixtures)', () => {
  const n = normalize(forecast, marine, { marinePoint: BEACH.marine });
  it('one row per hour, merged with marine by time, SST in degF', () => {
    expect(n.hours).toHaveLength(48);
    expect(n.utcOffsetSeconds).toBe(-18000);
    const noon = n.hours.find((h) => h.time === '2026-11-23T12:00');
    expect(noon).toMatchObject({ tempF: 73.7, windMph: 5.4, waveFt: 0.919, seaTempF: cToF(25.5), isDay: true, weatherCode: 1 });
    expect(cToF(25.5)).toBe(77.9);
    expect(cToF(null)).toBeNull();
  });
  it('marine is labelled as offshore waves and the snap is within 5 km', () => {
    expect(n.marine).toMatchObject({ available: true, label: 'Offshore waves', reason: null });
    expect(n.marine.snapKm).toBeLessThan(5);
  });
  it('daily rows keep sunrise/sunset as API local strings', () => {
    expect(n.days[0]).toEqual({ date: '2026-11-23', sunrise: '2026-11-23T06:44', sunset: '2026-11-23T17:29', uvMax: 5.15, rainChanceMax: 2, weatherCode: 3 });
  });
  it('PRECEDING-HOUR SHIFT: slot T reads precipitation, probability, gusts and uv from row T+1h; instants stay on row T', () => {
    const idx = (t) => forecast.hourly.time.indexOf(t);
    for (const t of ['2026-11-23T10:00', '2026-11-23T13:00', '2026-11-24T10:00', '2026-11-24T11:00']) {
      const i = idx(t);
      const row = n.hours[i];
      expect(row.rainIn, t).toBe(forecast.hourly.precipitation[i + 1]);
      expect(row.rainChance, t).toBe(forecast.hourly.precipitation_probability[i + 1]);
      expect(row.gustMph, t).toBe(forecast.hourly.wind_gusts_10m[i + 1]);
      expect(row.uv, t).toBe(forecast.hourly.uv_index[i + 1]);
      expect(row.windMph, t).toBe(forecast.hourly.wind_speed_10m[i]);
      expect(row.weatherCode, t).toBe(forecast.hourly.weather_code[i]);
      expect(row.cloudPct, t).toBe(forecast.hourly.cloud_cover[i]);
      expect(row.feelsF, t).toBe(forecast.hourly.apparent_temperature[i]);
      expect(row.cape, t).toBe(forecast.hourly.cape[i]);
    }
    // The real data has 0.016 in at row 2026-11-24T10:00 (it describes 09:00-10:00), so it belongs to the 09:00 slot.
    expect(forecast.hourly.precipitation[34]).toBe(0.016);
    expect([n.hours[33].rainIn, n.hours[34].rainIn]).toEqual([0.016, 0]);
  });
  it('the last row has no T+1h row: its preceding-hour fields are null, never guessed', () => {
    const last = n.hours[47];
    expect([last.rainIn, last.rainChance, last.gustMph, last.uv]).toEqual([null, null, null, null]);
    expect(last.windMph).not.toBeNull();
  });
});

describe('marine fails soft', () => {
  it('no marine response', () => {
    const m = normalize(forecast, null);
    expect(m.marine).toMatchObject({ available: false, label: 'Waves unavailable' });
    expect(m.hours[12].waveFt).toBeNull();
    expect(m.hours[12].seaTempF).toBeNull();
    expect(m.hours).toHaveLength(48);
  });
  it('grid cell too far from the marine point (Gulf Stream snap): refused with a log-only reason', () => {
    const far = normalize(forecast, marine, { marinePoint: { lat: 26.9, lon: -80.0 } });
    expect(far.marine.available).toBe(false);
    expect(far.marine.label).toBe('Waves unavailable');
    expect(far.marine.reason).toMatch(/km from marine point/);
    expect(far.hours.every((h) => h.waveFt === null && h.seaTempF === null)).toBe(true);
  });
  it('exactly at the limit is accepted, just over is refused', () => {
    const cell = { lat: marine.latitude, lon: marine.longitude };
    const at = (km) => ({ lat: cell.lat + km / 111.19, lon: cell.lon });
    expect(normalize(forecast, marine, { marinePoint: at(4.9) }).marine.available).toBe(true);
    expect(normalize(forecast, marine, { marinePoint: at(5.2) }).marine.available).toBe(false);
  });
  it('marine in metres (wrong length_unit) is refused rather than shown as feet', () => {
    const m = structuredClone(marine);
    m.hourly_units.wave_height = 'm';
    expect(normalize(forecast, m, { marinePoint: BEACH.marine }).marine.available).toBe(false);
  });
  it('null marine values stay null; SST in degC converts, degF passes through', () => {
    const m = structuredClone(marine);
    m.hourly.wave_height[12] = null; m.hourly.sea_surface_temperature[12] = null;
    const n = normalize(forecast, m, { marinePoint: BEACH.marine });
    expect([n.hours[12].waveFt, n.hours[12].seaTempF]).toEqual([null, null]);
    expect(n.hours[13].seaTempF).toBe(cToF(m.hourly.sea_surface_temperature[13]));
    const f = structuredClone(marine);
    f.hourly_units.sea_surface_temperature = '°F';
    f.hourly.sea_surface_temperature = f.hourly.sea_surface_temperature.map(() => 79.5);
    expect(normalize(forecast, f, { marinePoint: BEACH.marine }).hours[5].seaTempF).toBe(79.5);
  });
  it('marine joins by instant, so a different utc offset cannot misalign hours', () => {
    const m = structuredClone(marine);
    m.utc_offset_seconds = -14400; // same labels now mean 1 h earlier: row 12:00 matches forecast 11:00
    const n = normalize(forecast, m, { marinePoint: BEACH.marine });
    expect(n.hours.find((h) => h.time === '2026-11-23T12:00').waveFt).toBe(marine.hourly.wave_height[13]);
  });
  it('non-numeric junk becomes null, not a number', () => {
    const f = structuredClone(forecast);
    f.hourly.apparent_temperature[12] = 'hot'; f.hourly.weather_code[12] = 2.5;
    const n = normalize(f, null);
    expect([n.hours[12].feelsF, n.hours[12].weatherCode]).toEqual([null, null]);
  });
});

describe('multi-location', () => {
  it('splitLocations keeps request order; the first element has no location_id', () => {
    const multi = fx('multi-location.json');
    const parts = splitLocations(multi, 2);
    expect(parts[0].location_id).toBeUndefined();
    expect(parts[1].location_id).toBe(1);
    expect(parts[1].latitude).toBeCloseTo(26.71615, 4);
    expect(() => splitLocations(multi, 3)).toThrow(/expected 3 locations/);
    expect(splitLocations(forecast, 1)).toEqual([forecast]);
  });
});

describe('fetchJson (injected fetch, no network)', () => {
  it('HTTP 400 {"error":true} becomes kind=api; the reason is kept for logs only', async () => {
    const err = await fetchJson('https://x/y', { fetchImpl: async () => res(400, fx('error-400.json')) }).catch((e) => e);
    expect(err).toBeInstanceOf(OpenMeteoError);
    expect([err.kind, err.status]).toEqual(['api', 400]);
    expect(err.message).toMatch(/tempeture_2m/);
  });
  it('matches on error===true, not on the reason text', async () => {
    const err = await fetchJson('https://x/y', { fetchImpl: async () => res(400, { error: true, reason: 'anything at all' }) }).catch((e) => e);
    expect(err.kind).toBe('api');
  });
  it('other non-2xx is kind=http (429 kept in status); non-JSON is shape; a rejected fetch is network', async () => {
    expect((await fetchJson('u', { fetchImpl: async () => res(429, { message: 'slow down' }) }).catch((e) => e))).toMatchObject({ kind: 'http', status: 429 });
    expect((await fetchJson('u', { fetchImpl: async () => res(503, null) }).catch((e) => e)).kind).toBe('http');
    const notJson = { ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } };
    expect((await fetchJson('u', { fetchImpl: async () => notJson }).catch((e) => e)).kind).toBe('shape');
    expect((await fetchJson('u', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }).catch((e) => e)).kind).toBe('network');
  });
  it('a hung request is aborted and reported as kind=timeout', async () => {
    let signal;
    const hang = (u, o) => new Promise((_, reject) => {
      signal = o.signal;
      o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const err = await fetchJson('u', { fetchImpl: hang, timeoutMs: 25 }).catch((e) => e);
    expect(err.kind).toBe('timeout');
    expect(signal.aborted).toBe(true);
  });
  it('sends only a JSON accept header: no cookies, no auth, no key', async () => {
    let init;
    await fetchJson('u', { fetchImpl: async (u, o) => { init = o; return res(200, {}); } });
    expect(Object.keys(init.headers)).toEqual(['accept']);
    expect(init.credentials).toBeUndefined();
  });
});

describe('loadBeach', () => {
  const route = (over = {}) => async (url) => {
    const u = new URL(url);
    if (u.host === 'marine-api.open-meteo.com') return over.marine ? over.marine() : res(200, marine);
    return over.forecast ? over.forecast() : res(200, forecast);
  };
  it('end to end with real fixtures: two requests in parallel, one per API', async () => {
    const seen = [];
    const fetchImpl = async (url, o) => { seen.push(new URL(url).host); return route()(url, o); };
    const n = await loadBeach(BEACH, { fetchImpl, days: 2 });
    expect(seen.sort()).toEqual(['api.open-meteo.com', 'marine-api.open-meteo.com']);
    expect(n.marine.available).toBe(true);
  });
  it('a marine outage (503, network, bad shape) still returns the forecast', async () => {
    for (const marineFn of [() => res(503, { message: 'down' }), () => { throw new TypeError('offline'); }, () => res(200, { latitude: 1 })]) {
      const n = await loadBeach(BEACH, { fetchImpl: route({ marine: marineFn }), days: 2 });
      expect(n.marine.available).toBe(false);
      expect(n.hours).toHaveLength(48);
    }
  });
  it('a forecast failure is thrown (there is nothing to score)', async () => {
    const err = await loadBeach(BEACH, { fetchImpl: route({ forecast: () => res(400, fx('error-400.json')) }), days: 2 }).catch((e) => e);
    expect(err.kind).toBe('api');
  });
});

describe('distanceKm', () => {
  it('about 111 km per degree of latitude', () => {
    expect(distanceKm({ lat: 25, lon: -80 }, { lat: 26, lon: -80 })).toBeCloseTo(111.2, 0);
    expect(distanceKm({ lat: 25.781, lon: -80.11 }, { lat: marine.latitude, lon: marine.longitude })).toBeLessThan(5);
  });
});
