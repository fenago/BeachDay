// Open-Meteo client for Beach Day: URL builders, fetch with timeout, response validation and
// normalization into one per-hour model. Browser-safe ES module (fetch, URL, AbortController only).
// The browser calls Open-Meteo directly (ADR-0001/0006); no key, no proxy, no auth code.
// Docs: https://open-meteo.com/en/docs and https://open-meteo.com/en/docs/marine-weather-api
// Attribution (CC BY 4.0) is shown by the UI: <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>

import { apiLocalToInstant } from '../data/beach-window.js';

export const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const MARINE_ENDPOINT = 'https://marine-api.open-meteo.com/v1/marine';

// 13 hourly + 5 daily = 18 variables (about 1.8 calls). Marine 7 hourly + 1 daily = 8 (1 call).
export const FORECAST_HOURLY = Object.freeze([
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'precipitation_probability', 'precipitation', 'weather_code', 'cloud_cover',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'uv_index', 'cape', 'is_day',
]);
export const FORECAST_DAILY = Object.freeze([
  'sunrise', 'sunset', 'uv_index_max', 'precipitation_probability_max', 'weather_code',
]);
export const MARINE_HOURLY = Object.freeze([
  'wave_height', 'wave_period', 'wave_direction',
  'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'sea_surface_temperature',
]);
export const MARINE_DAILY = Object.freeze(['wave_height_max']);

export const DEFAULT_TIMEOUT_MS = 5000; // weather calls: 3-5 s (web-platform-vanilla skill)
export const MAX_MARINE_SNAP_KM = 5;
const TZ = 'America/New_York';

/** Coordinates go in with at most 4 decimals (~11 m); more precision adds nothing. */
const coord = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(`bad coordinate: ${n}`);
  return String(Math.round(n * 1e4) / 1e4);
};

/** Forecast URL for one point. forecast_days 1..16. */
export function buildForecastUrl({ lat, lon }, { days = 7, endpoint = FORECAST_ENDPOINT } = {}) {
  if (!(days >= 1 && days <= 16)) throw new RangeError('forecast_days must be 1..16');
  const u = new URL(endpoint);
  u.searchParams.set('latitude', coord(lat));
  u.searchParams.set('longitude', coord(lon));
  u.searchParams.set('hourly', FORECAST_HOURLY.join(','));
  u.searchParams.set('daily', FORECAST_DAILY.join(','));
  u.searchParams.set('timezone', TZ); // required whenever daily= is used
  u.searchParams.set('forecast_days', String(days));
  u.searchParams.set('temperature_unit', 'fahrenheit');
  u.searchParams.set('wind_speed_unit', 'mph');
  u.searchParams.set('precipitation_unit', 'inch');
  return u.toString();
}

/** Marine URL for one point. forecast_days 1..8, always explicit (the docs disagree on the default). */
export function buildMarineUrl({ lat, lon }, { days = 7, endpoint = MARINE_ENDPOINT } = {}) {
  if (!(days >= 1 && days <= 8)) throw new RangeError('marine forecast_days must be 1..8');
  const u = new URL(endpoint);
  u.searchParams.set('latitude', coord(lat));
  u.searchParams.set('longitude', coord(lon));
  u.searchParams.set('hourly', MARINE_HOURLY.join(','));
  u.searchParams.set('daily', MARINE_DAILY.join(','));
  u.searchParams.set('timezone', TZ);
  u.searchParams.set('forecast_days', String(days));
  u.searchParams.set('length_unit', 'imperial'); // wave heights in ft; SST stays in degrees C
  return u.toString();
}

export class OpenMeteoError extends Error {
  /** kind: 'timeout' | 'network' | 'http' | 'api' | 'shape' | 'offline' */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'OpenMeteoError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * GET JSON with a hard timeout. Open-Meteo errors arrive as HTTP 400 {"error": true, "reason": "..."}.
 * Match on `error === true`, never on the reason text, and never show the reason to people (log it).
 */
export async function fetchJson(url, opts = {}) {
  return (await fetchJsonStamped(url, opts)).body;
}

/** Epoch ms the service worker saved this response (x-bd-source: cache + x-bd-fetched-at), else null (fresh). */
export function swStamp(res) {
  try {
    if (res.headers?.get?.('x-bd-source') !== 'cache') return null;
    const t = Number(res.headers.get('x-bd-fetched-at'));
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

/** Like fetchJson, but also returns the service-worker cache stamp: { body, cachedAt:number|null }. */
export async function fetchJsonStamped(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? ((u, o) => globalThis.fetch(u, o));
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  let res;
  let body = null;
  try {
    try {
      res = await doFetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    } catch (err) {
      if (timedOut || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw new OpenMeteoError('timeout', `Open-Meteo did not answer within ${timeoutMs} ms`);
      }
      throw new OpenMeteoError('network', `Network error: ${err?.message ?? err}`);
    }
    try {
      body = await res.json();
    } catch {
      if (timedOut) throw new OpenMeteoError('timeout', `Open-Meteo did not finish within ${timeoutMs} ms`);
      /* non-JSON body */
    }
  } finally {
    clearTimeout(timer);
  }
  if (body && typeof body === 'object' && !Array.isArray(body) && body.error === true) {
    throw new OpenMeteoError('api', typeof body.reason === 'string' ? body.reason : 'Open-Meteo error', { status: res.status });
  }
  if (!res.ok) throw new OpenMeteoError('http', `HTTP ${res.status}`, { status: res.status });
  if (body === null) throw new OpenMeteoError('shape', 'Response was not JSON');
  return { body, cachedAt: swStamp(res) };
}

const fail = (m) => { throw new OpenMeteoError('shape', m); };

/** Check the shape we rely on. Returns the object or throws OpenMeteoError('shape'). */
export function validateResponse(json, { hourly = [], daily = [] } = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('expected a single-location object');
  for (const k of ['latitude', 'longitude', 'utc_offset_seconds']) {
    if (typeof json[k] !== 'number' || !Number.isFinite(json[k])) fail(`missing numeric ${k}`);
  }
  if (typeof json.timezone !== 'string') fail('missing timezone');
  const checkBlock = (name, vars) => {
    if (!vars.length) return;
    const block = json[name];
    if (!block || !Array.isArray(block.time) || block.time.length === 0) fail(`${name}.time missing`);
    for (const v of vars) {
      if (!Array.isArray(block[v])) fail(`${name}.${v} missing`);
      if (block[v].length !== block.time.length) fail(`${name}.${v} length ${block[v].length} != time length ${block.time.length}`);
    }
  };
  checkBlock('hourly', hourly);
  checkBlock('daily', daily);
  return json;
}

/** Units must be what we asked for, or numbers would be read wrongly (for example km/h as mph). */
export function validateUnits(json, expected) {
  const units = json?.hourly_units;
  if (!units || typeof units !== 'object') fail('hourly_units missing');
  for (const [variable, allowed] of Object.entries(expected)) {
    if (!allowed.includes(units[variable])) fail(`unexpected unit for ${variable}: ${JSON.stringify(units[variable])}`);
  }
}

const FORECAST_UNITS = Object.freeze({
  temperature_2m: ['°F'], apparent_temperature: ['°F'],
  precipitation: ['inch'],
  wind_speed_10m: ['mp/h', 'mph'], wind_gusts_10m: ['mp/h', 'mph'],
});
const MARINE_UNITS = Object.freeze({ wave_height: ['ft'], sea_surface_temperature: ['°C', '°F'] });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isInteger(v) ? v : null);

export const cToF = (c) => (c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10);

/** Great-circle distance in km (used to check marine grid snapping). */
export function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A multi-location response is a JSON array in request order (the first element has no location_id).
 * Returns one element per requested location, or throws a shape error. Use the index, not location_id.
 */
export function splitLocations(json, expected) {
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== expected) fail(`expected ${expected} locations, got ${arr.length}`);
  return arr;
}

/**
 * Merge forecast + (optional) marine into one per-hour model.
 * - Row T of the model describes the slot starting at T. Four fields describe the PRECEDING hour in the API
 *   (precipitation, precipitation_probability, wind_gusts_10m, uv_index), so they are read from row T+1h
 *   (docs/01 5.2). The last row has no T+1h row: those fields are null there.
 * - Marine failure is soft: hours keep wave fields as null and marine.available=false, label "Waves unavailable".
 * - Sea-surface temperature is converted from degC to degF.
 */
export function normalize(forecast, marine, { marinePoint, maxSnapKm = MAX_MARINE_SNAP_KM } = {}) {
  validateResponse(forecast, { hourly: FORECAST_HOURLY, daily: FORECAST_DAILY });
  validateUnits(forecast, FORECAST_UNITS);

  let marineOk = false;
  let marineReason = marine ? null : 'no marine response';
  let sstIsC = true;
  const marineByInstant = new Map();
  if (marine) {
    try {
      validateResponse(marine, { hourly: MARINE_HOURLY });
      validateUnits(marine, MARINE_UNITS);
      sstIsC = marine.hourly_units.sea_surface_temperature === '°C';
      marine.hourly.time.forEach((t, i) => marineByInstant.set(apiLocalToInstant(t, marine.utc_offset_seconds), i));
      marineOk = true;
    } catch (e) {
      marineReason = e.message;
    }
  }
  const snapKm = marineOk && marinePoint
    ? Math.round(distanceKm(marinePoint, { lat: marine.latitude, lon: marine.longitude }) * 10) / 10
    : null;
  if (snapKm != null && snapKm > maxSnapKm) {
    marineOk = false;
    marineReason = `marine grid cell ${snapKm} km from marine point (limit ${maxSnapKm} km)`;
  }

  const h = forecast.hourly;
  const off = forecast.utc_offset_seconds;
  const next = (arr, i) => (i + 1 < arr.length ? num(arr[i + 1]) : null);
  const hours = h.time.map((time, i) => {
    const j = marineOk ? marineByInstant.get(apiLocalToInstant(time, off)) : undefined;
    const m = (k) => (j === undefined ? null : num(marine.hourly[k][j]));
    const sst = m('sea_surface_temperature');
    return {
      time, // local wall-clock label at utc_offset_seconds (fixed offset, docs/03)
      tempF: num(h.temperature_2m[i]),
      feelsF: num(h.apparent_temperature[i]),
      humidity: num(h.relative_humidity_2m[i]),
      weatherCode: int(h.weather_code[i]),
      cloudPct: num(h.cloud_cover[i]),
      windMph: num(h.wind_speed_10m[i]),
      windDir: num(h.wind_direction_10m[i]),
      cape: num(h.cape[i]),
      isDay: h.is_day[i] === 1,
      // preceding-hour fields, shifted to the slot they describe:
      rainChance: next(h.precipitation_probability, i),
      rainIn: next(h.precipitation, i),
      gustMph: next(h.wind_gusts_10m, i),
      uv: next(h.uv_index, i),
      // marine:
      waveFt: m('wave_height'),
      wavePeriodS: m('wave_period'),
      waveDir: m('wave_direction'),
      swellFt: m('swell_wave_height'),
      swellPeriodS: m('swell_wave_period'),
      swellDir: m('swell_wave_direction'),
      seaTempF: sstIsC ? cToF(sst) : sst,
    };
  });
  const d = forecast.daily;
  const days = d.time.map((date, i) => ({
    date,
    sunrise: typeof d.sunrise[i] === 'string' ? d.sunrise[i] : null,
    sunset: typeof d.sunset[i] === 'string' ? d.sunset[i] : null,
    uvMax: num(d.uv_index_max[i]),
    rainChanceMax: num(d.precipitation_probability_max[i]),
    weatherCode: int(d.weather_code[i]),
  }));
  return {
    timezone: forecast.timezone,
    utcOffsetSeconds: off,
    grid: { lat: forecast.latitude, lon: forecast.longitude },
    // `label` is for people; `reason` is for logs only (never show it).
    marine: {
      available: marineOk,
      label: marineOk ? 'Offshore waves' : 'Waves unavailable',
      snapKm,
      reason: marineOk ? null : marineReason,
    },
    hours,
    days,
  };
}

/**
 * Fetch both APIs in parallel; marine failure never breaks the forecast.
 * model.fetchedAt is the OLDEST service-worker cache stamp of the two responses, or null when both are fresh
 * from the network. A cached copy must not be shown as "Updated just now".
 */
export async function loadBeach(beach, opts = {}) {
  const { fetchImpl, timeoutMs, forecastEndpoint, marineEndpoint, days } = opts;
  const [f, m] = await Promise.allSettled([
    fetchJsonStamped(buildForecastUrl(beach.land, { days, endpoint: forecastEndpoint }), { fetchImpl, timeoutMs }),
    fetchJsonStamped(buildMarineUrl(beach.marine, { days, endpoint: marineEndpoint }), { fetchImpl, timeoutMs }),
  ]);
  if (f.status === 'rejected') throw f.reason;
  const model = normalize(f.value.body, m.status === 'fulfilled' ? m.value.body : null, { marinePoint: beach.marine });
  const stamps = [f.value.cachedAt, m.status === 'fulfilled' ? m.value.cachedAt : null].filter((t) => t !== null);
  model.fetchedAt = stamps.length ? Math.min(...stamps) : null;
  return model;
}
