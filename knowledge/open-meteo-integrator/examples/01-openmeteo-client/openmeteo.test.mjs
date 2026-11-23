// Run: node --test openmeteo.test.mjs   (Node 22, no dependencies)
// Fixtures are real Open-Meteo responses captured 2026-11-23 (see README).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  buildForecastUrl, buildMarineUrl, fetchJson, validateResponse, normalize, loadBeach,
  OpenMeteoError, cToF, FORECAST_HOURLY, MARINE_HOURLY,
} from './openmeteo.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const forecast = fx('forecast-miami-beach.json');
const marine = fx('marine-miami-beach.json');
const BEACH = { id: 'miami-beach', land: { lat: 25.781, lon: -80.13 }, marine: { lat: 25.781, lon: -80.13 } };

test('forecast URL has exact variables, units and timezone', () => {
  const u = new URL(buildForecastUrl(BEACH.land, { days: 7 }));
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(u.searchParams.get('hourly'), FORECAST_HOURLY.join(','));
  assert.equal(u.searchParams.get('timezone'), 'America/New_York');
  assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(u.searchParams.get('precipitation_unit'), 'inch');
  assert.equal(u.searchParams.get('latitude'), '25.781');
  assert.throws(() => buildForecastUrl(BEACH.land, { days: 17 }), RangeError);
});

test('marine URL is imperial, explicit forecast_days, max 8 days', () => {
  const u = new URL(buildMarineUrl(BEACH.marine, { days: 7 }));
  assert.equal(u.host, 'marine-api.open-meteo.com');
  assert.equal(u.searchParams.get('length_unit'), 'imperial');
  assert.equal(u.searchParams.get('forecast_days'), '7');
  assert.equal(u.searchParams.get('hourly'), MARINE_HOURLY.join(','));
  assert.throws(() => buildMarineUrl(BEACH.marine, { days: 9 }), RangeError);
});

test('real fixtures validate; broken shapes are rejected', () => {
  validateResponse(forecast, { hourly: FORECAST_HOURLY, daily: ['sunrise', 'sunset'] });
  validateResponse(marine, { hourly: MARINE_HOURLY });
  const broken = structuredClone(forecast);
  broken.hourly.uv_index.pop();
  assert.throws(() => validateResponse(broken, { hourly: ['uv_index'] }), /length 47 != time length 48/);
  assert.throws(() => validateResponse(fx('multi-location.json')), /single-location/);
});

test('normalize merges forecast + marine by local time and converts SST to °F', () => {
  const n = normalize(forecast, marine, { marinePoint: BEACH.marine });
  assert.equal(n.hours.length, 48);
  assert.equal(n.utcOffsetSeconds, -18000);
  const noon = n.hours.find((h) => h.time === '2026-11-23T12:00');
  assert.deepEqual(
    { tempF: noon.tempF, uv: noon.uv, windMph: noon.windMph, waveFt: noon.waveFt, seaTempF: noon.seaTempF, isDay: noon.isDay },
    { tempF: 73.7, uv: 5.05, windMph: 5.4, waveFt: 0.919, seaTempF: cToF(25.5), isDay: true },
  );
  assert.equal(cToF(25.5), 77.9);
  assert.equal(n.marine.available, true);
  assert.equal(n.marine.label, 'Offshore waves');
  assert.ok(n.marine.snapKm < 5, `marine cell ${n.marine.snapKm} km away`);
  assert.deepEqual(n.days[0], {
    date: '2026-11-23', sunrise: '2026-11-23T06:44', sunset: '2026-11-23T17:29',
    uvMax: 5.15, rainChanceMax: 2, weatherCode: 3,
  });
});

test('marine missing or far away fails soft', () => {
  const none = normalize(forecast, null);
  assert.equal(none.marine.available, false);
  assert.equal(none.hours[12].waveFt, null);
  const far = normalize(forecast, marine, { marinePoint: { lat: 26.9, lon: -80.0 } });
  assert.equal(far.marine.available, false);
  assert.match(far.marine.label, /km from marine point/);
});

// --- fetch behaviour against a local mock server (the real API is not reachable from the sandbox) ---
function startMock() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/v1/forecast' && url.searchParams.get('hourly')?.includes('tempeture')) return send(400, fx('error-400.json'));
    if (url.pathname === '/v1/forecast') return send(200, forecast);
    if (url.pathname === '/v1/marine') return send(200, marine);
    if (url.pathname === '/slow') return setTimeout(() => send(200, {}), 2000);
    if (url.pathname === '/marine-down/v1/marine') return send(503, { message: 'down' });
    send(404, {});
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

test('fetchJson: 400 error body becomes OpenMeteoError(api) with reason', async (t) => {
  const s = await startMock(); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  await assert.rejects(fetchJson(`${base}/v1/forecast?hourly=tempeture_2m`), (e) =>
    e instanceof OpenMeteoError && e.kind === 'api' && e.status === 400 && /tempeture_2m/.test(e.message));
});

test('fetchJson: timeout aborts', async (t) => {
  const s = await startMock(); t.after(() => s.closeAllConnections() || s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  await assert.rejects(fetchJson(`${base}/slow`, { timeoutMs: 200 }), (e) => e.kind === 'timeout');
});

test('loadBeach end-to-end; marine outage still returns forecast', async (t) => {
  const s = await startMock(); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  const ok = await loadBeach(BEACH, { forecastEndpoint: `${base}/v1/forecast`, marineEndpoint: `${base}/v1/marine`, days: 2 });
  assert.equal(ok.marine.available, true);
  const soft = await loadBeach(BEACH, { forecastEndpoint: `${base}/v1/forecast`, marineEndpoint: `${base}/marine-down/v1/marine`, days: 2 });
  assert.equal(soft.marine.available, false);
  assert.equal(soft.hours.length, 48);
});
