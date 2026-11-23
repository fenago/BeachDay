// Date-sensitive: run under several TZ values (UTC, Pacific/Auckland). Nothing here may depend on the
// machine's zone: every conversion names America/New_York or uses the response's fixed offset.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  apiLocalToInstant, beachDate, beachWindow, daysBetween, formatClock, hoursInWindow, instantToWallClock,
  wallClockToInstant, zoneOffsetSeconds,
} from '../../public/js/data/beach-window.js';

const forecast = JSON.parse(readFileSync(new URL('../fixtures/openmeteo/forecast-miami-beach.json', import.meta.url), 'utf8'));
const ctx = { utcOffsetSeconds: forecast.utc_offset_seconds, timezone: forecast.timezone };
const TZ = 'America/New_York';
const iso = (ms) => new Date(ms).toISOString();

describe('string <-> instant', () => {
  it('API local string + fixed offset -> instant (never the device zone)', () => {
    expect(iso(apiLocalToInstant('2026-11-23T06:44', -18000))).toBe('2026-11-23T11:44:00.000Z');
    expect(() => apiLocalToInstant('2026-11-23T06:44:00Z', -18000)).toThrow(TypeError);
    expect(() => apiLocalToInstant(undefined, -18000)).toThrow(TypeError);
  });
  it('zone offsets: EST in November, EDT in July; switch instants on both DST days', () => {
    expect(zoneOffsetSeconds(Date.parse('2026-11-23T17:00Z'), TZ)).toBe(-18000);
    expect(zoneOffsetSeconds(Date.parse('2026-07-04T17:00Z'), TZ)).toBe(-14400);
    // 2027-03-14: 02:00 EST = 07:00Z springs forward
    expect(zoneOffsetSeconds(Date.parse('2027-03-14T06:59:59Z'), TZ)).toBe(-18000);
    expect(zoneOffsetSeconds(Date.parse('2027-03-14T07:00:00Z'), TZ)).toBe(-14400);
    // 2026-11-01: 02:00 EDT = 06:00Z falls back
    expect(zoneOffsetSeconds(Date.parse('2026-11-01T05:59:59Z'), TZ)).toBe(-14400);
    expect(zoneOffsetSeconds(Date.parse('2026-11-01T06:00:00Z'), TZ)).toBe(-18000);
  });
  it('wall clock <-> instant is DST-correct on both sides of both switches', () => {
    expect(iso(wallClockToInstant('2027-03-13', 8, 0, TZ))).toBe('2027-03-13T13:00:00.000Z');
    expect(iso(wallClockToInstant('2027-03-15', 8, 0, TZ))).toBe('2027-03-15T12:00:00.000Z');
    expect(iso(wallClockToInstant('2026-10-31', 8, 0, TZ))).toBe('2026-10-31T12:00:00.000Z');
    expect(iso(wallClockToInstant('2026-11-02', 8, 0, TZ))).toBe('2026-11-02T13:00:00.000Z');
    expect(instantToWallClock(Date.parse('2027-03-14T07:00:00Z'), TZ)).toBe('2027-03-14T03:00');
    expect(instantToWallClock(Date.parse('2026-11-01T06:00:00Z'), TZ)).toBe('2026-11-01T01:00');
  });
  it('beachDate is the beach calendar date, whatever the device zone', () => {
    expect(beachDate(Date.parse('2026-11-24T04:30:00Z'))).toBe('2026-11-23'); // 11:30 pm EST
    expect(beachDate(Date.parse('2026-11-24T05:00:00Z'))).toBe('2026-11-24'); // midnight EST
    expect(beachDate(Date.parse('2026-07-04T03:59:00Z'))).toBe('2026-07-03'); // 11:59 pm EDT
  });
  it('daysBetween counts calendar days across month ends and DST days', () => {
    expect(daysBetween('2026-11-23', '2026-11-23')).toBe(0);
    expect(daysBetween('2026-11-30', '2026-12-02')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(daysBetween('2027-03-13', '2027-03-15')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('formatClock', () => {
  it('"3 pm", "3:30 pm", noon and midnight', () => {
    expect(['15:00', '2026-11-23T15:00', '08:00', '15:30', '12:00', '00:00', '00:15', '23:00'].map(formatClock))
      .toEqual(['3 pm', '3 pm', '8 am', '3:30 pm', '12 pm', '12 am', '12:15 am', '11 pm']);
    expect(formatClock('nonsense')).toBe('');
  });
});

describe('beach window rule: max(sunrise + 1 h, 8 am) .. min(sunset - 0.5 h, 7 pm)', () => {
  it('2026-11-23 Miami Beach (real fixture): 08:00 .. 16:59, hours 08:00..16:00', () => {
    const day = { date: forecast.daily.time[0], sunrise: forecast.daily.sunrise[0], sunset: forecast.daily.sunset[0] };
    const w = beachWindow(day, ctx);
    expect([w.startLocal, w.endLocal]).toEqual(['2026-11-23T08:00', '2026-11-23T16:59']); // sunrise 06:44+1h clamps to 08:00
    const rows = forecast.hourly.time.map((time) => ({ time }));
    expect(hoursInWindow(rows, w, ctx.utcOffsetSeconds).map((h) => h.time.slice(11)))
      .toEqual(['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  });
  it('edges: sunrise + 1 h wins when later than 8 am; sunset - 30 min wins when earlier than 7 pm; 7 pm caps', () => {
    const w = (sunrise, sunset) => beachWindow({ date: '2026-07-04', sunrise, sunset }, { utcOffsetSeconds: -14400, timezone: TZ });
    expect([w('2026-07-04T06:59', '2026-07-04T20:15').startLocal, w('2026-07-04T07:00', '2026-07-04T20:15').startLocal]).toEqual(['2026-07-04T08:00', '2026-07-04T08:00']);
    expect(w('2026-07-04T07:01', '2026-07-04T20:15').startLocal).toBe('2026-07-04T08:01');
    expect(w('2026-07-04T06:35', '2026-07-04T19:29').endLocal).toBe('2026-07-04T18:59');
    expect(w('2026-07-04T06:35', '2026-07-04T19:30').endLocal).toBe('2026-07-04T19:00');
    expect(w('2026-07-04T06:35', '2026-07-04T20:15').endLocal).toBe('2026-07-04T19:00');
  });
  it('no window when the sunset is too early, or sunrise/sunset are missing', () => {
    expect(beachWindow({ date: '2026-11-23', sunrise: '2026-11-23T06:44', sunset: '2026-11-23T08:20' }, ctx)).toBeNull();
    expect(beachWindow({ date: '2026-11-23', sunrise: null, sunset: '2026-11-23T17:00' }, ctx)).toBeNull();
    expect(beachWindow(null, ctx)).toBeNull();
  });
  it('hoursInWindow with no window is empty; slot start decides membership', () => {
    expect(hoursInWindow([{ time: '2026-11-23T10:00' }], null, -18000)).toEqual([]);
    const w = { start: apiLocalToInstant('2026-11-23T10:00', -18000), end: apiLocalToInstant('2026-11-23T11:00', -18000) };
    expect(hoursInWindow([{ time: '2026-11-23T09:00' }, { time: '2026-11-23T10:00' }, { time: '2026-11-23T11:00' }], w, -18000).map((h) => h.time)).toEqual(['2026-11-23T10:00']);
  });
});

describe('DST days (the API ignores DST inside a response, docs/03)', () => {
  it('2027-03-14 (spring forward): a response requested on 2027-03-12 keeps -18000; window and hours are still right', () => {
    // Synthetic values in the API format: sunrise 07:25 EDT, sunset 19:30 EDT, written with the stale -05:00 offset.
    const day = { date: '2027-03-14', sunrise: '2027-03-14T06:25', sunset: '2027-03-14T18:30' };
    const w = beachWindow(day, { utcOffsetSeconds: -18000, timezone: TZ });
    expect([w.startLocal, w.endLocal]).toEqual(['2027-03-14T08:25', '2027-03-14T19:00']);
    const rows = Array.from({ length: 24 }, (_, h) => ({ time: `2027-03-14T${String(h).padStart(2, '0')}:00` }));
    const inside = hoursInWindow(rows, w, -18000).map((h) => h.time.slice(11));
    expect(inside).toEqual(['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
    // label 08:00 at the stale offset is 13:00Z = 09:00 EDT on the beach
    expect(instantToWallClock(apiLocalToInstant('2027-03-14T08:00', -18000), TZ)).toBe('2027-03-14T09:00');
    expect(instantToWallClock(apiLocalToInstant('2027-03-15T12:00', -18000), TZ)).toBe('2027-03-15T13:00');
    // and before the switch the label and the wall clock agree
    expect(instantToWallClock(apiLocalToInstant('2027-03-13T12:00', -18000), TZ)).toBe('2027-03-13T12:00');
  });
  it('2026-11-01 (fall back): a response requested on 2026-10-30 has -14400; the 8 am slot is labelled 09:00', () => {
    // Synthetic: sunrise 06:30 EST, sunset 17:35 EST, written with the stale -04:00 offset (labels one hour late).
    const day = { date: '2026-11-01', sunrise: '2026-11-01T07:30', sunset: '2026-11-01T18:35' };
    const w = beachWindow(day, { utcOffsetSeconds: -14400, timezone: TZ });
    expect([w.startLocal, w.endLocal]).toEqual(['2026-11-01T08:00', '2026-11-01T17:05']);
    const rows = Array.from({ length: 24 }, (_, h) => ({ time: `2026-11-01T${String(h).padStart(2, '0')}:00` }));
    const inside = hoursInWindow(rows, w, -14400).map((h) => h.time.slice(11));
    expect(inside[0]).toBe('09:00'); // label 09:00 = 13:00Z = 8 am EST
    // window ends 17:05 EST = 22:05Z; label 18:00 = 22:00Z starts inside it (the 5 pm EST slot), label 19:00 does not
    expect(inside.at(-1)).toBe('18:00');
    expect(instantToWallClock(apiLocalToInstant('2026-11-01T18:00', -14400), TZ)).toBe('2026-11-01T17:00');
  });
});
