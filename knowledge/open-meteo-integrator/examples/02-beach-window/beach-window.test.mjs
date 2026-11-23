// Run: node --test beach-window.test.mjs   (Node 22, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  apiLocalToInstant, zoneOffsetSeconds, instantToWallClock, wallClockToInstant,
  beachWindow, hoursInWindow,
} from './beach-window.mjs';

// Real response captured 2026-11-23 (shared with example 01).
const forecast = JSON.parse(readFileSync(
  new URL('../01-openmeteo-client/fixtures/forecast-miami-beach.json', import.meta.url), 'utf8'));
const ctx = { utcOffsetSeconds: forecast.utc_offset_seconds, timezone: forecast.timezone };
const TZ = 'America/New_York';

test('API local string + fixed offset -> instant', () => {
  assert.equal(new Date(apiLocalToInstant('2026-11-23T06:44', -18000)).toISOString(), '2026-11-23T11:44:00.000Z');
  assert.throws(() => apiLocalToInstant('2026-11-23T06:44:00Z', -18000), TypeError);
});

test('zone offsets: EST in November, EDT in July', () => {
  assert.equal(zoneOffsetSeconds(Date.parse('2026-11-23T17:00Z'), TZ), -18000);
  assert.equal(zoneOffsetSeconds(Date.parse('2026-07-04T17:00Z'), TZ), -14400);
});

test('window for 2026-11-23 Miami Beach (real fixture): 08:00 .. 16:59', () => {
  const day = { date: forecast.daily.time[0], sunrise: forecast.daily.sunrise[0], sunset: forecast.daily.sunset[0] };
  const w = beachWindow(day, ctx);
  // sunrise 06:44 + 1 h = 07:44 -> clamped to 08:00; sunset 17:29 - 0.5 h = 16:59 (< 19:00)
  assert.equal(w.startLocal, '2026-11-23T08:00');
  assert.equal(w.endLocal, '2026-11-23T16:59');
  const hrs = forecast.hourly.time.map((time) => ({ time }));
  const inside = hoursInWindow(hrs, w, ctx.utcOffsetSeconds).map((h) => h.time.slice(11));
  assert.deepEqual(inside, ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('summer day: late sunset is capped at 19:00, early sunrise +1h wins only if after 08:00', () => {
  // Synthetic July values in the API format with EDT offset (-14400).
  const w = beachWindow({ date: '2026-07-04', sunrise: '2026-07-04T06:35', sunset: '2026-07-04T20:15' },
    { utcOffsetSeconds: -14400, timezone: TZ });
  assert.equal(w.startLocal, '2026-07-04T08:00');
  assert.equal(w.endLocal, '2026-07-04T19:00');
});

test('DST caveat: response requested before 2027-03-14 keeps the EST offset for every hour', () => {
  // A request made on 2027-03-12 returns utc_offset_seconds=-18000 for the whole range (docs: DST ignored).
  // Hour labelled "2027-03-15T12:00" therefore is 17:00Z, which is 13:00 EDT on the beach.
  const t = apiLocalToInstant('2027-03-15T12:00', -18000);
  assert.equal(new Date(t).toISOString(), '2027-03-15T17:00:00.000Z');
  assert.equal(instantToWallClock(t, TZ), '2027-03-15T13:00');
  // Before the switch the label and the wall clock agree.
  assert.equal(instantToWallClock(apiLocalToInstant('2027-03-13T12:00', -18000), TZ), '2027-03-13T12:00');
});

test('wallClockToInstant is DST-correct on both sides of the switch', () => {
  assert.equal(new Date(wallClockToInstant('2027-03-13', 8, 0, TZ)).toISOString(), '2027-03-13T13:00:00.000Z');
  assert.equal(new Date(wallClockToInstant('2027-03-15', 8, 0, TZ)).toISOString(), '2027-03-15T12:00:00.000Z');
});

test('no window when sunset is too early (degenerate config)', () => {
  assert.equal(beachWindow({ date: '2026-11-23', sunrise: '2026-11-23T06:44', sunset: '2026-11-23T08:20' }, ctx), null);
});
