#!/usr/bin/env node
// Validates Beach Day interface contracts with Ajv (JSON Schema 2020-12):
//  1. every schema compiles in strict mode;
//  2. every sample in samples/*.samples.json is valid/invalid as its "expect" says;
//  3. a REAL Open-Meteo Forecast response (fixtures/, fetched 2026-11-23) normalizes into 24 valid ForecastHours;
//  4. a serialized SSE stream round-trips through the client parser from docs/04-sse-and-streams.md
//     and every event validates against the SSE union.
// Usage: node validate.mjs   (needs ajv@8 and ajv-formats@3)
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const load = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));

// add every schema first so cross-file $refs (api-error → approvals, proposal-view → proposal) resolve
const files = readdirSync(join(here, 'schemas')).sort();
for (const f of files) ajv.addSchema(load(`schemas/${f}`));
const validators = {};
for (const f of files) {
  const name = f.replace('.schema.json', '');
  validators[name] = ajv.getSchema(load(`schemas/${f}`).$id);
  console.log(`compiled  ${f}`);
}

let failures = 0;
const fmt = (errs) => (errs || []).slice(0, 2).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');

// 2. samples
for (const f of readdirSync(join(here, 'samples')).sort()) {
  const name = f.replace('.samples.json', '');
  for (const [i, s] of load(`samples/${f}`).entries()) {
    const ok = validators[name](s.data);
    const pass = (s.expect === 'valid') === ok;
    if (!pass) failures++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}#${i} expect=${s.expect} got=${ok ? 'valid' : 'invalid'} — ${s.why}${ok ? '' : ` [${fmt(validators[name].errors)}]`}`);
  }
}

// 3. real fixture → normalized hours (reference normalizer; marine fixture absent → nulls)
export function normalizeForecast(fc, marine = null) {
  const h = fc.hourly;
  return h.time.map((time, i) => {
    const m = marine?.hourly; const j = m ? m.time.indexOf(time) : -1;
    const val = (arr) => (j >= 0 && arr && arr[j] != null ? arr[j] : null);
    const sstC = val(m?.sea_surface_temperature);
    return {
      time, isDay: h.is_day[i] === 1, tempF: h.temperature_2m[i], feelsLikeF: h.apparent_temperature[i],
      humidityPct: h.relative_humidity_2m[i], precipProbPct: h.precipitation_probability[i], precipIn: h.precipitation[i],
      weatherCode: h.weather_code[i], cloudPct: h.cloud_cover[i], windMph: h.wind_speed_10m[i], gustMph: h.wind_gusts_10m[i],
      windDirDeg: h.wind_direction_10m[i], uvIndex: h.uv_index[i], capeJkg: h.cape[i],
      waveHeightFt: val(m?.wave_height), wavePeriodS: val(m?.wave_period),
      waterTempF: sstC == null ? null : Math.round((sstC * 9 / 5 + 32) * 10) / 10,
    };
  });
}
const fixture = load('fixtures/forecast-miami-beach-2026-11-23.json');
const units = fixture.hourly_units;
const unitsOk = units.temperature_2m === '°F' && units.wind_speed_10m === 'mp/h' && units.precipitation === 'inch';
const hours = normalizeForecast(fixture);
const bad = hours.filter((h) => !validators['forecast-hour'](h));
if (!unitsOk || bad.length || hours.length !== 24) failures++;
console.log(`${!unitsOk || bad.length || hours.length !== 24 ? 'FAIL' : 'PASS'}  real fixture: units ${unitsOk ? 'ok' : 'WRONG'}, ${hours.length} hours normalized, ${hours.length - bad.length} valid ForecastHour (marine null: no marine fixture)`);

// 4. SSE round trip
const events = [
  { type: 'tool', name: 'read_file', phase: 'start', summary: 'Read public/js/score.js' },
  { type: 'text', delta: 'Line one\nline two: with a colon' },
  { type: 'proposal', proposalId: 'p_01JDQ8Z5K3M7N2P4R6S8T0V9WX', summary: 'Treat null wave_height as missing.', files: [{ path: 'public/js/score.js', bytes: 5120 }] },
  { type: 'done', stopReason: 'end_turn' },
];
const wire = ': ping\n\n' + events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
function parseSse(text) {
  const out = []; let buf = text; let k;
  while ((k = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, k); buf = buf.slice(k + 2);
    let event = 'message'; const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const [f, ...r] = line.split(':'); const v = r.join(':').replace(/^ /, '');
      if (f === 'event') event = v; else if (f === 'data') data.push(v);
    }
    if (data.length) out.push({ event, payload: JSON.parse(data.join('\n')) });
  }
  return out;
}
const parsed = parseSse(wire);
const sseOk = parsed.length === events.length &&
  parsed.every((p, i) => p.event === p.payload.type && validators['sse-event'](p.payload) &&
    JSON.stringify(p.payload) === JSON.stringify(events[i])) &&
  ['done', 'error'].includes(parsed.at(-1).payload.type);
if (!sseOk) failures++;
console.log(`${sseOk ? 'PASS' : 'FAIL'}  SSE round trip: ${wire.length} bytes on the wire → ${parsed.length} events, all valid, ends with ${parsed.at(-1)?.payload.type}`);

console.log(`\n${failures === 0 ? 'ALL CONTRACT CHECKS PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
