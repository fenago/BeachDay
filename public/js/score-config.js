// Beach Day score config: every threshold is DATA. score.js only looks values up.
// Spec: docs/01-use-case-and-scoring.md section 5.2 and 5.5.
//
// Band rule: every list is half-open and lower-bound inclusive. A value belongs to the LAST band whose
// `from` is <= value. The first band starts at -Infinity, so nothing falls in a gap, and lists are
// strictly ascending, so nothing sits in two bands (tests/unit/score-structure.test.mjs checks both).
// Units live in the key names: F = degrees Fahrenheit, Mph, Inch, Ft, Pct, Jkg.
//
// Editing rules (docs/01 5.5): a change needs a cited source or stated rationale, a boundary test on both
// sides of each changed edge, review by open-meteo-integrator + Wren (wording), and a `version` bump.

const band = (...pairs) => Object.freeze(pairs.map(([from, penalty]) => Object.freeze({ from, penalty })));
const NEG = -Infinity;
const list = (...xs) => Object.freeze(xs);

export const SCORE_CONFIG = Object.freeze({
  version: 1,
  window: Object.freeze({ afterSunriseMin: 60, beforeSunsetMin: 30, earliest: list(8, 0), latest: list(19, 0), bestWindowHours: 3 }),
  hardStops: Object.freeze({
    thunderCodes: list(95, 96, 97, 99), // NWS: "When thunder roars, go indoors"; wait 30 min
    gustMph: 32, // gust >= 32 mph (Beaufort 7)
    windMph: 25, // sustained >= 25 mph (Beaufort 6)
    heatIndexF: 103, // NWS "Danger" band starts at 103 (edge UNVERIFIED, NWS pages blocked 2026-11-23)
  }),
  bands: Object.freeze({
    rainChance: band([NEG, 0], [21, 10], [41, 25], [61, 40]), // %, integer data
    cloudPct: band([NEG, 0], [41, 5], [71, 15]), // %
    feelsF: band([NEG, 40], [65, 25], [72, 10], [78, 0], [91, 10], [96, 25], [103, 40]),
    windMph: band([NEG, 0], [13, 10], [19, 25]), // >= 25 is a hard stop, handled before bands
    waveFt: band([NEG, 0], [2, 10], [3, 20], [5, 35]), // offshore waves
    seaTempF: band([NEG, 25], [70, 15], [74, 5], [78, 0]),
  }),
  rain: Object.freeze({
    amountInchOver: 0.02, // D8: strictly greater. The one deliberate ">" (docs/01 5.2)
    amountPenalty: 15,
    codePenalty: Object.freeze({ drizzle: 10, showers: 15, rain: 25, unusual: 25 }),
    codes: Object.freeze({
      drizzle: list(51, 53, 55),
      showers: list(80, 81, 82),
      rain: list(61, 63, 65), // the WMO table has no 62 or 64
      unusual: list(56, 57, 66, 67, 71, 73, 75, 77, 85, 86), // should never appear in South Florida
    }),
    familyCap: 60, // rain chance + max(amount, code) never exceeds this
  }),
  stormRisk: Object.freeze({ capeJkg: 1500, rainChance: 40, penalty: 15 }), // both inclusive (>=)
  uvAdvice: band([NEG, 0], [3, 1], [6, 2], [8, 3], [11, 4]), // level: 0 none, 1 moderate, 2 high, 3 very high, 4 extreme
  fogCodes: list(45, 48),
  verdict: Object.freeze([
    Object.freeze({ from: NEG, id: 'skip' }),
    Object.freeze({ from: 45, id: 'fair' }),
    Object.freeze({ from: 65, id: 'good' }),
    Object.freeze({ from: 80, id: 'great' }),
  ]),
  shortWindowVerdictCap: 'good', // fewer than bestWindowHours hours can never be "great"
  outlookFromDayIndex: 3, // 0-based: day 4 and later
  reasons: Object.freeze({
    maxShown: 4,
    // D3 (Dr. Lee, pending): when true, good days also list what is going well (codes dry, sunny_sky,
    // comfortable, light_wind, calm_waves, warm_water; copy ids reason.pos.* in Wren's deck). Default off = current spec.
    positiveOnGoodDays: false,
  }),
});

/** Pick the band for x: the last band whose `from` <= x. */
export function pick(bands, x) {
  let hit = bands[0];
  for (const b of bands) if (x >= b.from) hit = b;
  return hit;
}

/** Verdict id for an (already rounded) score. */
export function verdictFor(score, config = SCORE_CONFIG) {
  let id = config.verdict[0].id;
  for (const v of config.verdict) if (score >= v.from) id = v.id;
  return id;
}
