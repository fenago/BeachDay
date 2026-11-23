import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BEACHES, DEFAULT_BEACH_ID, getBeach } from '../../public/js/data/beaches.js';
import { distanceKm } from '../../public/js/api/openmeteo.js';

const marineFixture = JSON.parse(readFileSync(new URL('../fixtures/openmeteo/marine-miami-beach.json', import.meta.url), 'utf8'));

// docs/01 section 6: the approximate land coordinates, written out independently of the data file.
const DOC_LAND = {
  'miami-beach': [25.781, -80.130], 'key-biscayne': [25.717, -80.154], 'cape-florida': [25.667, -80.157],
  haulover: [25.903, -80.120], hollywood: [26.011, -80.117], 'fort-lauderdale': [26.119, -80.104],
  deerfield: [26.317, -80.074], 'boca-raton': [26.382, -80.068], delray: [26.461, -80.059],
  'palm-beach': [26.705, -80.034], jupiter: [26.943, -80.070], 'key-west': [24.551, -81.771], 'bahia-honda': [24.656, -81.280],
};

describe('beach list (docs/01 section 6)', () => {
  it('has all 13 beaches with unique ids, in a stable order', () => {
    expect(BEACHES).toHaveLength(13);
    expect(new Set(BEACHES.map((b) => b.id)).size).toBe(13);
    expect(BEACHES.map((b) => b.id).sort()).toEqual(Object.keys(DOC_LAND).sort());
    expect(getBeach(DEFAULT_BEACH_ID)).not.toBeNull();
    expect(getBeach('nowhere')).toBeNull();
  });
  it.each(BEACHES.map((b) => [b.id, b]))('%s: land point matches docs/01, marine point is 1-3 km away, NWS link present', (id, b) => {
    expect([b.land.lat, b.land.lon]).toEqual(DOC_LAND[id]);
    expect(b.name).toBeTruthy();
    expect(b.area).toBeTruthy();
    const km = distanceKm(b.land, b.marine);
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(3);
    expect(b.nws.url).toMatch(/^https:\/\/www\.weather\.gov\/(beach\/mfl|key\/)$/);
    expect(b.nws.surfUrl).toMatch(/^https:\/\/forecast\.weather\.gov\/product\.php\?site=(mfl|key)&product=srf&issuedby=(mfl|key)$/);
    expect(b.nws.zone).toMatch(/^(MFL|NWS Key West)/);
    expect(['captured', 'unverified']).toContain(b.marineCheck);
  });
  it('Atlantic-coast beaches put the marine point EAST of the shore (further out to sea); Keys beaches south', () => {
    for (const b of BEACHES.filter((x) => x.nws.office === 'MFL')) expect(b.marine.lon, b.id).toBeGreaterThan(b.land.lon);
    for (const b of BEACHES.filter((x) => x.nws.office === 'KEY')) expect(b.marine.lat, b.id).toBeLessThan(b.land.lat);
  });
  it('all points are in South Florida and the Keys (sanity box), longitudes negative', () => {
    for (const b of BEACHES) for (const p of [b.land, b.marine]) {
      expect(p.lat).toBeGreaterThan(24.4); expect(p.lat).toBeLessThan(27.1);
      expect(p.lon).toBeGreaterThan(-82); expect(p.lon).toBeLessThan(-79.9);
    }
  });
  it('NWS office link matches the area: Miami-area -> /beach/mfl, Key West -> /key/', () => {
    expect(getBeach('key-west').nws.url).toBe('https://www.weather.gov/key/');
    expect(getBeach('bahia-honda').nws.url).toBe('https://www.weather.gov/key/');
    expect(getBeach('jupiter').nws.url).toBe('https://www.weather.gov/beach/mfl');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(BEACHES)).toBe(true);
    expect(Object.isFrozen(BEACHES[0])).toBe(true);
    expect(Object.isFrozen(BEACHES[0].marine)).toBe(true);
  });
});

describe('marine point verification status (honest record)', () => {
  it('only Miami Beach has a captured Marine response; its returned grid cell is within 5 km of the point', () => {
    const captured = BEACHES.filter((b) => b.marineCheck === 'captured').map((b) => b.id);
    expect(captured).toEqual(['miami-beach']);
    const snap = distanceKm(getBeach('miami-beach').marine, { lat: marineFixture.latitude, lon: marineFixture.longitude });
    expect(snap).toBeLessThan(5);
  });
  it('the other 12 are UNVERIFIED against the live API (blocked in the build sandbox); runtime snap check guards them', () => {
    expect(BEACHES.filter((b) => b.marineCheck === 'unverified')).toHaveLength(12);
  });
});
