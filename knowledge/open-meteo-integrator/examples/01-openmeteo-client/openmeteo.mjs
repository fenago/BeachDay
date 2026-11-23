// Open-Meteo client for Beach Day: URL builders, fetch with timeout,
// response validation and normalization into one per-hour model.
// Browser-compatible ES module (uses only fetch, URL, AbortSignal).
// Docs: https://open-meteo.com/en/docs  and  https://open-meteo.com/en/docs/marine-weather-api

export const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const MARINE_ENDPOINT = 'https://marine-api.open-meteo.com/v1/marine';

export const FORECAST_HOURLY = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'precipitation_probability', 'precipitation', 'weather_code', 'cloud_cover',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'uv_index', 'cape', 'is_day',
];
export const FORECAST_DAILY = [
  'sunrise', 'sunset', 'uv_index_max', 'precipitation_probability_max', 'weather_code',
];
export const MARINE_HOURLY = [
  'wave_height', 'wave_period', 'wave_direction',
  'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'sea_surface_temperature',
];
export const MARINE_DAILY = ['wave_height_max'];

const TZ = 'America/New_York';

/** Coordinates go in with at most 4 decimals (~11 m); more precision adds nothing. */
const coord = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(`bad coordinate: ${n}`);
  return String(Math.round(n * 1e4) / 1e4);
};

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

export function buildMarineUrl({ lat, lon }, { days = 7, endpoint = MARINE_ENDPOINT } = {}) {
  if (!(days >= 1 && days <= 8)) throw new RangeError('marine forecast_days must be 1..8');
  const u = new URL(endpoint);
  u.searchParams.set('latitude', coord(lat));
  u.searchParams.set('longitude', coord(lon));
  u.searchParams.set('hourly', MARINE_HOURLY.join(','));
  u.searchParams.set('daily', MARINE_DAILY.join(','));
  u.searchParams.set('timezone', TZ);
  u.searchParams.set('forecast_days', String(days)); // always explicit: docs disagree on the default
  u.searchParams.set('length_unit', 'imperial');     // wave heights in ft; SST stays in °C
  return u.toString();
}

export class OpenMeteoError extends Error {
  /** kind: 'timeout' | 'network' | 'http' | 'api' | 'shape' */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'OpenMeteoError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * GET JSON with a hard timeout. Open-Meteo errors arrive as HTTP 400 with
 * {"error": true, "reason": "..."}; surface the reason.
 */
export async function fetchJson(url, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new OpenMeteoError('timeout', `Open-Meteo did not answer within ${timeoutMs} ms`);
    }
    throw new OpenMeteoError('network', `Network error: ${err?.message ?? err}`);
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (body && body.error === true) {
    throw new OpenMeteoError('api', body.reason ?? 'Open-Meteo error', { status: res.status });
  }
  if (!res.ok) throw new OpenMeteoError('http', `HTTP ${res.status}`, { status: res.status });
  if (body === null) throw new OpenMeteoError('shape', 'Response was not JSON');
  return body;
}

/** Check the shape we rely on. Returns the object or throws OpenMeteoError('shape'). */
export function validateResponse(json, { hourly = [], daily = [] } = {}) {
  const fail = (m) => { throw new OpenMeteoError('shape', m); };
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('expected a single-location object');
  for (const k of ['latitude', 'longitude', 'utc_offset_seconds']) {
    if (typeof json[k] !== 'number') fail(`missing numeric ${k}`);
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

export const cToF = (c) => (c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10);

/** Great-circle distance in km (used to check marine grid snapping). */
export function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Merge forecast + (optional) marine into one per-hour model.
 * Marine failure is soft: hours keep wave fields as null and marine.available=false.
 */
export function normalize(forecast, marine, { marinePoint, maxSnapKm = 5 } = {}) {
  validateResponse(forecast, { hourly: FORECAST_HOURLY, daily: FORECAST_DAILY });
  let marineOk = false, marineNote = 'Waves unavailable';
  const marineByTime = new Map();
  if (marine) {
    try {
      validateResponse(marine, { hourly: MARINE_HOURLY });
      if (marine.hourly_units?.wave_height !== 'ft') throw new OpenMeteoError('shape', 'expected length_unit=imperial (ft)');
      marine.hourly.time.forEach((t, i) => marineByTime.set(t, i));
      marineOk = true;
      marineNote = 'Offshore waves';
    } catch (e) {
      marineNote = `Waves unavailable (${e.message})`;
    }
  }
  const snapKm = marineOk && marinePoint
    ? Math.round(distanceKm(marinePoint, { lat: marine.latitude, lon: marine.longitude }) * 10) / 10
    : null;
  if (snapKm != null && snapKm > maxSnapKm) {
    marineOk = false;
    marineNote = `Waves unavailable (marine grid cell ${snapKm} km from marine point)`;
  }

  const h = forecast.hourly;
  const hours = h.time.map((time, i) => {
    const j = marineOk ? marineByTime.get(time) : undefined;
    const m = (k) => (j === undefined ? null : marine.hourly[k][j]);
    return {
      time, // local wall-clock time at utc_offset_seconds (fixed offset, see docs/03)
      tempF: h.temperature_2m[i],
      feelsF: h.apparent_temperature[i],
      humidity: h.relative_humidity_2m[i],
      rainChance: h.precipitation_probability[i],
      rainIn: h.precipitation[i],
      weatherCode: h.weather_code[i],
      cloudPct: h.cloud_cover[i],
      windMph: h.wind_speed_10m[i],
      gustMph: h.wind_gusts_10m[i],
      windDir: h.wind_direction_10m[i],
      uv: h.uv_index[i],
      cape: h.cape[i],
      isDay: h.is_day[i] === 1,
      waveFt: m('wave_height'),
      wavePeriodS: m('wave_period'),
      waveDir: m('wave_direction'),
      swellFt: m('swell_wave_height'),
      swellPeriodS: m('swell_wave_period'),
      swellDir: m('swell_wave_direction'),
      seaTempF: cToF(m('sea_surface_temperature')),
    };
  });
  const d = forecast.daily;
  const days = d.time.map((date, i) => ({
    date,
    sunrise: d.sunrise[i],
    sunset: d.sunset[i],
    uvMax: d.uv_index_max[i],
    rainChanceMax: d.precipitation_probability_max[i],
    weatherCode: d.weather_code[i],
  }));
  return {
    timezone: forecast.timezone,
    utcOffsetSeconds: forecast.utc_offset_seconds,
    grid: { lat: forecast.latitude, lon: forecast.longitude },
    marine: { available: marineOk, label: marineNote, snapKm },
    hours,
    days,
  };
}

/** Fetch both APIs in parallel; marine failure never breaks the forecast. */
export async function loadBeach(beach, opts = {}) {
  const { fetchImpl, timeoutMs, forecastEndpoint, marineEndpoint, days } = opts;
  const [f, m] = await Promise.allSettled([
    fetchJson(buildForecastUrl(beach.land, { days, endpoint: forecastEndpoint }), { fetchImpl, timeoutMs }),
    fetchJson(buildMarineUrl(beach.marine, { days, endpoint: marineEndpoint }), { fetchImpl, timeoutMs }),
  ]);
  if (f.status === 'rejected') throw f.reason;
  return normalize(f.value, m.status === 'fulfilled' ? m.value : null, { marinePoint: beach.marine });
}
