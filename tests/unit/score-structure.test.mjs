import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SCORE_CONFIG as C, pick, verdictFor } from '../../public/js/score-config.js';

const bandLists = { ...C.bands, uvAdvice: C.uvAdvice };

describe('score config structure (docs/01 5.5)', () => {
  it.each(Object.keys(bandLists))('%s starts at -Infinity and is strictly ascending (no gaps, no overlaps)', (name) => {
    const bands = bandLists[name];
    expect(bands[0].from).toBe(-Infinity);
    for (let i = 1; i < bands.length; i++) expect(bands[i].from).toBeGreaterThan(bands[i - 1].from);
  });

  it('verdict list starts at -Infinity and ascends', () => {
    expect(C.verdict[0].from).toBe(-Infinity);
    for (let i = 1; i < C.verdict.length; i++) expect(C.verdict[i].from).toBeGreaterThan(C.verdict[i - 1].from);
  });

  it('the config is deeply frozen', () => {
    const walk = (o, path) => {
      if (o && typeof o === 'object') {
        expect(Object.isFrozen(o), path).toBe(true);
        for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
      }
    };
    walk(C, 'SCORE_CONFIG');
  });

  it('pick(): lower bound inclusive, upper bound exclusive, for every list', () => {
    for (const [name, bands] of Object.entries(bandLists)) {
      for (let i = 1; i < bands.length; i++) {
        const edge = bands[i].from;
        expect(pick(bands, edge).penalty, `${name} at ${edge}`).toBe(bands[i].penalty);
        expect(pick(bands, edge - 0.001).penalty, `${name} just below ${edge}`).toBe(bands[i - 1].penalty);
      }
    }
  });

  it('pinned decisions: D3 on, D8 0.02 in (strict), version 1, outlook from day index 3', () => {
    expect(C.reasons.positiveOnGoodDays).toBe(true); // D3
    expect(C.rain.amountInchOver).toBe(0.02); // D8
    expect(C.version).toBe(1);
    expect(C.outlookFromDayIndex).toBe(3);
    expect(C.window).toMatchObject({ afterSunriseMin: 60, beforeSunsetMin: 30, earliest: [8, 0], latest: [19, 0], bestWindowHours: 3 });
    expect(C.hardStops).toMatchObject({ thunderCodes: [95, 96, 97, 99], gustMph: 32, windMph: 25, heatIndexF: 103 });
    expect(C.rain.familyCap).toBe(60);
    expect(C.stormRisk).toEqual({ capeJkg: 1500, rainChance: 40, penalty: 15 });
  });

  it('verdict edges: 44|45, 64|65, 79|80', () => {
    expect([0, 44, 45, 64, 65, 79, 80, 100].map((s) => verdictFor(s))).toEqual(['skip', 'skip', 'fair', 'fair', 'good', 'good', 'great', 'great']);
  });
});

describe('browser-safe data layer (no auth, no Node, no Supabase)', () => {
  const root = new URL('../../public/js/', import.meta.url);
  const files = [
    'api/openmeteo.js', 'score.js', 'score-config.js', 'forecast.js',
    'data/beaches.js', 'data/beach-window.js', 'data/cache-age.js',
  ];
  it.each(files)('%s imports only same-folder-tree modules and uses no Node or auth APIs', (f) => {
    const src = readFileSync(new URL(f, root), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const spec of imports) expect(spec, `${f} imports ${spec}`).toMatch(/^\.\.?\//);
    expect(src).not.toMatch(/\b(vendor|generated|supabase|auth-js|console)\b.*from\s|from\s.*\b(vendor|generated|supabase)\b/i);
    expect(src).not.toMatch(/\bprocess\.|\brequire\(|node:|\bBuffer\b|innerHTML|document\.|eval\(|new Function/);
    expect(src).not.toMatch(/apikey|api_key|Authorization/i);
  });

  it('no file in the data layer is missing from this list', () => {
    const listed = new Set(files);
    const found = [];
    const walk = (dir, prefix = '') => {
      for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
        if (e.isDirectory()) { if (['api', 'data'].includes(e.name)) walk(`${e.name}/`, e.name + '/'); }
        else if (prefix && e.name.endsWith('.js')) found.push(prefix + e.name);
      }
    };
    walk('./');
    for (const f of found) expect(listed.has(f), `${f} not covered`).toBe(true);
  });
});
