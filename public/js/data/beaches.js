// The 13 v1 beaches (docs/01 section 6). Browser-safe data only.
//
// land   = the beach itself. Used for the Forecast request.
// marine = a hand-picked sample point about 2 km east (out to sea) of the beach, used for the Marine request.
//          Open-Meteo snaps to a ~8 km grid and Palm Beach / Jupiter snapped ~15 km out into the Gulf Stream
//          in an earlier test, so openmeteo.js REJECTS marine data whose returned grid cell is more than
//          5 km from this point and shows "Waves unavailable" instead (fail soft).
// marineCheck:
//   'captured'   a real response for this exact point was recorded (tests/fixtures/openmeteo/marine-miami-beach.json)
//                and its grid cell was within 5 km.
//   'unverified' the point is hand-picked from the beach coordinates and was NOT run against the live Marine
//                API (marine-api.open-meteo.com was blocked from the build sandbox on 2026-11-23). The runtime
//                snap check protects users. To verify: open buildMarineUrl(beach.marine) in a browser and
//                confirm the returned latitude/longitude is within 5 km of the point.
// Beach coordinates are the approximate ones from docs/01 section 6 (general knowledge, not surveyed).

const NWS_MIAMI = 'https://www.weather.gov/beach/mfl';
const NWS_MIAMI_SURF = 'https://forecast.weather.gov/product.php?site=mfl&product=srf&issuedby=mfl';
const NWS_KEY = 'https://www.weather.gov/key/';
const NWS_KEY_SURF = 'https://forecast.weather.gov/product.php?site=key&product=srf&issuedby=key';

const mia = (zone) => ({ office: 'MFL', zone, url: NWS_MIAMI, surfUrl: NWS_MIAMI_SURF });
const key = () => ({ office: 'KEY', zone: 'NWS Key West', url: NWS_KEY, surfUrl: NWS_KEY_SURF });

const beach = (id, name, area, land, marine, nws, marineCheck = 'unverified') =>
  Object.freeze({
    id, name, area,
    land: Object.freeze({ lat: land[0], lon: land[1] }),
    marine: Object.freeze({ lat: marine[0], lon: marine[1] }),
    marineCheck,
    nws: Object.freeze(nws),
  });

export const BEACHES = Object.freeze([
  beach('miami-beach', 'South Beach', 'Miami Beach', [25.781, -80.130], [25.781, -80.110], mia('MFL Miami Beach Area'), 'captured'),
  beach('key-biscayne', 'Crandon Park', 'Key Biscayne', [25.717, -80.154], [25.717, -80.134], mia('MFL Miami Beach Area')),
  beach('cape-florida', 'Bill Baggs Cape Florida', 'Key Biscayne', [25.667, -80.157], [25.667, -80.137], mia('MFL Miami Beach Area')),
  beach('haulover', 'Haulover Beach', 'Miami-Dade', [25.903, -80.120], [25.903, -80.100], mia('MFL Miami Beach Area')),
  beach('hollywood', 'Hollywood Beach', 'Hollywood', [26.011, -80.117], [26.011, -80.097], mia('MFL Fort Lauderdale Area')),
  beach('fort-lauderdale', 'Fort Lauderdale Beach', 'Fort Lauderdale', [26.119, -80.104], [26.119, -80.084], mia('MFL Fort Lauderdale Area')),
  beach('deerfield', 'Deerfield Beach', 'Deerfield Beach', [26.317, -80.074], [26.317, -80.054], mia('MFL Fort Lauderdale Area (near boundary)')),
  beach('boca-raton', 'Spanish River Park', 'Boca Raton', [26.382, -80.068], [26.382, -80.048], mia('MFL Palm Beach Area')),
  beach('delray', 'Delray Beach', 'Delray Beach', [26.461, -80.059], [26.461, -80.039], mia('MFL Palm Beach Area')),
  beach('palm-beach', 'Palm Beach Midtown', 'Palm Beach', [26.705, -80.034], [26.705, -80.014], mia('MFL Palm Beach Area')),
  beach('jupiter', 'Jupiter Beach Park', 'Jupiter', [26.943, -80.070], [26.943, -80.050], mia('MFL Palm Beach Area')),
  // Key West faces south on the Atlantic side; the marine point is 2 km south of the beach.
  beach('key-west', 'Smathers Beach', 'Key West', [24.551, -81.771], [24.533, -81.771], key()),
  beach('bahia-honda', 'Bahia Honda State Park', 'Lower Keys', [24.656, -81.280], [24.638, -81.280], key()),
]);

const BY_ID = new Map(BEACHES.map((b) => [b.id, b]));

/** Beach by id, or null. */
export function getBeach(id) {
  return BY_ID.get(id) ?? null;
}

/** Default beach when nothing is saved (Miami Beach: the only one with a captured marine point). */
export const DEFAULT_BEACH_ID = 'miami-beach';
