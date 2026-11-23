// WCAG 2.2 contrast check for Beach Day tokens, including text on glass.
// Reads ../01-glass-tokens-demo/tokens.css (or a path given as argv[2]),
// composites each glass layer over the worst backgrounds, and prints pass/fail.
// Exit code 1 if any check fails. No dependencies. Node 22+.
//
// Formulas: WCAG 2.2 "relative luminance" and "contrast ratio" definitions
// https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
// https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
// Thresholds are NOT rounded (4.499 fails 4.5), per Understanding 1.4.3.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? resolve(here, '../01-glass-tokens-demo/tokens.css');
const css = readFileSync(file, 'utf8');

// --- parse -----------------------------------------------------------------
function parseBlock(text) {
  const out = {};
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
if (darkStart < 0) throw new Error('no dark block found');
const light = parseBlock(css.slice(0, darkStart));
const dark = { ...light, ...parseBlock(css.slice(darkStart)) };

function color(v, name) {
  if (!v) throw new Error(`missing token ${name}`);
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
  m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`token ${name} must be #rrggbb or rgb(r g b / a), got "${v}"`);
}

// --- WCAG math ---------------------------------------------------------------
const lin = (c8) => { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
// Source-over compositing of a translucent layer onto an opaque backdrop (sRGB, as browsers paint).
const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});
const hex = ({ r, g, b }) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

// --- checks ------------------------------------------------------------------
const BG_TOKENS = [
  '--bg-sunny-top', '--bg-sunny-bottom', '--bg-overcast-top', '--bg-overcast-bottom',
  '--bg-stormy-top', '--bg-stormy-bottom', '--bg-scroll-worst-light', '--bg-scroll-worst-dark',
];
const VERDICTS = ['great', 'good', 'fair', 'skip'];

let failures = 0;
const rows = [];
function check(scheme, what, fg, bg, min) {
  const r = ratio(fg, bg);
  const ok = r >= min; // no rounding
  if (!ok) failures++;
  rows.push({ scheme, what, fg: hex(fg), bg: hex(bg), ratio: r.toFixed(2), min, result: ok ? 'PASS' : 'FAIL' });
  return r;
}

for (const [scheme, t] of [['light', light], ['dark', dark]]) {
  const c = (n) => color(t[n], n);
  const glass = c('--glass-bg');
  const strong = c('--glass-bg-strong');
  const highlight = c('--glass-highlight-top');
  // Every glass composite the text could sit on: glass over each background,
  // with and without the top highlight (the highlight fades to 0 by 40%).
  const composites = [];
  for (const bgName of BG_TOKENS) {
    const base = over(glass, c(bgName));
    composites.push({ name: `glass/${bgName}`, col: base });
    composites.push({ name: `glass+hl/${bgName}`, col: over(highlight, base) });
    composites.push({ name: `strong/${bgName}`, col: over(strong, c(bgName)) });
  }
  const worstFor = (fg) => composites.reduce((w, x) => (ratio(fg, x.col) < ratio(fg, w.col) ? x : w));

  // 1.4.3 text on glass (worst composite) and on the solid fallback surface
  for (const tok of ['--text', '--text-2', '--link']) {
    const w = worstFor(c(tok));
    check(scheme, `${tok} on glass (worst: ${w.name})`, c(tok), w.col, 4.5);
    check(scheme, `${tok} on --surface-solid`, c(tok), c('--surface-solid'), 4.5);
  }
  // 1.4.3 verdict chip label (17px semibold = normal text, so 4.5)
  for (const v of VERDICTS) check(scheme, `--on-verdict-${v} on --verdict-${v}`, c(`--on-verdict-${v}`), c(`--verdict-${v}`), 4.5);
  // 1.4.3 primary button label
  check(scheme, '--on-accent on --accent', c('--on-accent'), c('--accent'), 4.5);
  // 1.4.11 non-text: button fill vs adjacent glass, unlabeled control border, focus ring
  for (const tok of ['--accent', '--control-border', '--focus']) {
    const w = worstFor(c(tok));
    check(scheme, `${tok} vs glass (worst: ${w.name}) [1.4.11]`, c(tok), w.col, 3);
    check(scheme, `${tok} vs --surface-solid [1.4.11]`, c(tok), c('--surface-solid'), 3);
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`tokens: ${file}`);
console.log(pad('scheme', 7), pad('check', 62), pad('fg', 8), pad('bg', 8), pad('ratio', 6), pad('min', 4), 'result');
for (const r of rows) console.log(pad(r.scheme, 7), pad(r.what, 62), pad(r.fg, 8), pad(r.bg, 8), pad(r.ratio, 6), pad(r.min, 4), r.result);
console.log(`\n${rows.length - failures}/${rows.length} checks pass`);
process.exit(failures ? 1 : 0);
