import { describe, expect, it } from 'vitest';
import {
  STALE_AFTER_MS, STALE_BANNER_MS, TOO_OLD_MS, ageTier, cacheAge, fetchedAtLabel, freshnessLabel, shouldRefetch,
} from '../../public/js/data/cache-age.js';

const fetchedAt = Date.parse('2026-11-23T13:15:00Z'); // 8:15 am EST
const min = 60_000;

describe('cacheAge', () => {
  it('boundary: 29:59 fresh, 30:00 stale', () => {
    expect(STALE_AFTER_MS).toBe(30 * min);
    expect(cacheAge(fetchedAt, fetchedAt + 30 * min - 1000).stale).toBe(false);
    expect(cacheAge(fetchedAt, fetchedAt + 30 * min).stale).toBe(true);
    expect(cacheAge(fetchedAt, fetchedAt + 30 * min).reason).toBe('expired');
  });
  it('missing timestamp and clock skew are stale; small skew is tolerated', () => {
    expect(cacheAge(undefined).reason).toBe('no-timestamp');
    expect(cacheAge(NaN).reason).toBe('no-timestamp');
    expect(cacheAge(fetchedAt, fetchedAt - 5 * min).reason).toBe('clock-skew');
    expect(cacheAge(fetchedAt, fetchedAt - 30_000).stale).toBe(false);
  });
});

describe('ageTier: 30 min stale, 3 h banner, 24 h too old (Wren state matrix)', () => {
  const tier = (ms) => ageTier(fetchedAt, fetchedAt + ms);
  it('both sides of every edge', () => {
    expect(STALE_BANNER_MS).toBe(3 * 60 * min);
    expect(TOO_OLD_MS).toBe(24 * 60 * min);
    expect([tier(30 * min - 1), tier(30 * min), tier(3 * 60 * min - 1), tier(3 * 60 * min), tier(24 * 60 * min - 1), tier(24 * 60 * min)])
      .toEqual(['fresh', 'stale', 'stale', 'banner', 'banner', 'too-old']);
  });
  it('untrusted timestamps are too old', () => {
    expect(ageTier(undefined, fetchedAt)).toBe('too-old');
    expect(ageTier(fetchedAt, fetchedAt - 5 * min)).toBe('too-old');
  });
});

describe('shouldRefetch (user-driven events only, never a timer)', () => {
  const e = { fetchedAt };
  it('offline never; no entry yes; fresh no; stale yes; forced at most once a minute', () => {
    expect(shouldRefetch(null)).toBe(true);
    expect(shouldRefetch(null, { online: false })).toBe(false);
    expect(shouldRefetch(e, { now: fetchedAt + 45 * min, online: false })).toBe(false);
    expect(shouldRefetch(e, { now: fetchedAt + 10 * min })).toBe(false);
    expect(shouldRefetch(e, { now: fetchedAt + 31 * min })).toBe(true);
    expect(shouldRefetch(e, { now: fetchedAt + 59_999, userForced: true })).toBe(false);
    expect(shouldRefetch(e, { now: fetchedAt + 60_000, userForced: true })).toBe(true);
    expect(shouldRefetch(e, { now: fetchedAt + 2 * min, userForced: true })).toBe(true);
  });
});

describe('labels in beach-local time', () => {
  const e = { fetchedAt };
  it('plain words, not colour', () => {
    expect(freshnessLabel(e, { now: fetchedAt + 5 * min })).toBe('Updated 8:15 am');
    expect(freshnessLabel(e, { now: fetchedAt + 40 * min })).toBe('Updating… last data from 8:15 am');
    expect(freshnessLabel(e, { now: fetchedAt + 40 * min, online: false })).toBe('Offline — showing data from 8:15 am');
    expect(freshnessLabel(null, { online: false })).toBe('Offline — no saved forecast yet');
    expect(freshnessLabel(null)).toBe('Loading forecast…');
    expect(fetchedAtLabel(Date.parse('2026-11-23T20:05:00Z'))).toBe('3:05 pm');
    expect(fetchedAtLabel(Date.parse('2026-07-04T16:00:00Z'))).toBe('12:00 pm'); // EDT
  });
});
