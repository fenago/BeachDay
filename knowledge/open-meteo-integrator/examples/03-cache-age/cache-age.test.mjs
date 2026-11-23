// Run: node --test cache-age.test.mjs   (Node 22, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheAge, shouldRefetch, freshnessLabel, STALE_AFTER_MS } from './cache-age.mjs';

const fetchedAt = Date.parse('2026-11-23T13:15:00Z'); // 8:15 am EST
const min = 60_000;

test('boundary: 29:59 fresh, 30:00 stale', () => {
  assert.equal(STALE_AFTER_MS, 30 * min);
  assert.equal(cacheAge(fetchedAt, fetchedAt + 30 * min - 1000).stale, false);
  assert.equal(cacheAge(fetchedAt, fetchedAt + 30 * min).stale, true);
  assert.equal(cacheAge(fetchedAt, fetchedAt + 30 * min).reason, 'expired');
});

test('missing timestamp and clock skew are stale', () => {
  assert.equal(cacheAge(undefined).reason, 'no-timestamp');
  assert.equal(cacheAge(fetchedAt, fetchedAt - 5 * min).reason, 'clock-skew');
  assert.equal(cacheAge(fetchedAt, fetchedAt - 30_000).stale, false); // small skew tolerated
});

test('shouldRefetch: offline never, fresh no, stale yes, forced at most once a minute', () => {
  const e = { fetchedAt };
  assert.equal(shouldRefetch(null), true);
  assert.equal(shouldRefetch(e, { now: fetchedAt + 45 * min, online: false }), false);
  assert.equal(shouldRefetch(e, { now: fetchedAt + 10 * min }), false);
  assert.equal(shouldRefetch(e, { now: fetchedAt + 31 * min }), true);
  assert.equal(shouldRefetch(e, { now: fetchedAt + 30_000, userForced: true }), false);
  assert.equal(shouldRefetch(e, { now: fetchedAt + 2 * min, userForced: true }), true);
});

test('labels in beach local time', () => {
  const e = { fetchedAt };
  assert.equal(freshnessLabel(e, { now: fetchedAt + 5 * min }), 'Updated 8:15 am');
  assert.equal(freshnessLabel(e, { now: fetchedAt + 40 * min }), 'Updating… last data from 8:15 am');
  assert.equal(freshnessLabel(e, { now: fetchedAt + 40 * min, online: false }), 'Offline — showing data from 8:15 am');
  assert.equal(freshnessLabel(null, { online: false }), 'Offline — no saved forecast yet');
});
