// Beach Day score config: thresholds as DATA (reference shape for public/js/score-config.js).
// Every band list is half-open and lower-bound inclusive: a value belongs to the LAST band whose
// `from` is <= value. The first band always starts at -Infinity, so no value can fall in a gap
// and no value can sit in two bands. Units: degF, mph, inch, ft, %, J/kg, UV index.
// Sources: see docs/01-use-case-and-scoring.md section 5.1 (UNVERIFIED items are flagged there).

const b = (...pairs) => Object.freeze(pairs.map(([from, penalty]) => Object.freeze({ from, penalty })));
const NEG = -Infinity;

export const SCORE_CONFIG = Object.freeze({
  version: 1,
  window: Object.freeze({ afterSunriseMin: 60, beforeSunsetMin: 30, earliest: [8, 0], latest: [19, 0], bestWindowHours: 3 }),
  hardStops: Object.freeze({
    thunderCodes: Object.freeze([95, 96, 97, 99]),
    gustMph: 32, // gust >= 32 (Beaufort 7)
    windMph: 25, // sustained >= 25 (Beaufort 6)
    heatIndexF: 103, // NWS "Danger" band starts at 103
  }),
  bands: Object.freeze({
    rainChance: b([NEG, 0], [21, 10], [41, 25], [61, 40]), // %, integer data
    cloudPct: b([NEG, 0], [41, 5], [71, 15]), // %, integer data
    feelsF: b([NEG, 40], [65, 25], [72, 10], [78, 0], [91, 10], [96, 25], [103, 40]),
    windMph: b([NEG, 0], [13, 10], [19, 25]), // >= 25 is a hard stop
    waveFt: b([NEG, 0], [2, 10], [3, 20], [5, 35]),
    seaTempF: b([NEG, 25], [70, 15], [74, 5], [78, 0]),
  }),
  rain: Object.freeze({
    amountInchOver: 0.02, // strictly greater: the one deliberate ">" (see docs/01 5.2)
    amountPenalty: 15,
    codePenalty: Object.freeze({ drizzle: 10, showers: 15, rain: 25, unusual: 25 }),
    codes: Object.freeze({
      drizzle: Object.freeze([51, 53, 55]),
      showers: Object.freeze([80, 81, 82]),
      rain: Object.freeze([61, 63, 65]),
      unusual: Object.freeze([56, 57, 66, 67, 71, 73, 75, 77, 85, 86]),
    }),
    familyCap: 60, // rain chance + max(amount, code) never exceeds this
  }),
  stormRisk: Object.freeze({ capeJkg: 1500, rainChance: 40, penalty: 15 }), // both inclusive (>=)
  uvAdvice: b([NEG, 0], [3, 1], [6, 2], [8, 3], [11, 4]), // 0 none, 1 moderate, 2 high, 3 very high, 4 extreme
  fogCodes: Object.freeze([45, 48]),
  verdict: Object.freeze([
    Object.freeze({ from: NEG, id: 'skip' }),
    Object.freeze({ from: 45, id: 'fair' }),
    Object.freeze({ from: 65, id: 'good' }),
    Object.freeze({ from: 80, id: 'great' }),
  ]),
  shortWindowVerdictCap: 'good', // fewer than bestWindowHours usable hours can never be "great"
  outlookFromDayIndex: 3, // 0-based: day 4 and later
});

/** Pick the band value for x: last band whose `from` <= x. */
export function pick(bands, x) {
  let hit = bands[0];
  for (const band of bands) if (x >= band.from) hit = band;
  return hit;
}
