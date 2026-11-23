// Lint the Beach Day copy deck: length limits, banned words (HIG Writing: no
// "we", no "oops", say "tap" not "click"), capitalization per element type,
// exact safety line, Flesch Reading Ease, and that every status string quoted
// in the flow spec's state matrix exists in the deck. No dependencies. Node 22+.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const deck = JSON.parse(readFileSync(resolve(here, 'copy-deck.json'), 'utf8'));
const R = deck.rules;
const SAFETY = 'Beach Day is not a safety service — check NWS rip-current risk and posted beach flags.';
const problems = [];
const rows = [];

// --- readability -------------------------------------------------------------
// Heuristic English syllable count (vowel groups, silent final e, min 1).
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}
// Flesch Reading Ease = 206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)
function flesch(text) {
  const plain = text.replace(/\{[^}]+\}/g, ''); // drop placeholders
  const words = plain.split(/\s+/).filter((t) => /[a-z]/i.test(t)); // drop numbers/symbols
  const sentences = Math.max(1, (plain.match(/[.!?…]+(\s|$)/g) ?? []).length);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  if (!words.length) return { score: null, words: 0 };
  return { score: 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / words.length), words: words.length };
}

// --- per-string checks ---------------------------------------------------------
const isTitleCase = (s) => s.split(/\s+/).every((w, i) =>
  /^[A-Z0-9]/.test(w) || (i > 0 && ['and', 'or', 'with', 'to', 'of', 'the', 'a', 'in', 'on'].includes(w)));
// Sentence case: after the first word, a capital is allowed only after sentence
// punctuation or a dash, for proper nouns, acronyms (UV, NWS) and placeholders.
const PROPER = new Set(['Beach', 'Day', 'Console', 'Open-Meteo', 'NWS', 'Hollywood', 'Fahrenheit']);
const isSentenceCase = (s) => {
  const t = s.split(/\s+/);
  if (!/^[A-Z0-9{]/.test(t[0])) return false;
  return t.slice(1).every((w, i) => !/^[A-Z]/.test(w) || /[.!?…—:]$/.test(t[i]) || t[i] === '—' ||
    PROPER.has(w.replace(/[^A-Za-z-]/g, '')) || /^[A-Z0-9]{2,}\b/.test(w));
};

function lint(kind, id, text, limit, { caseRule = R.textCase, readability = true } = {}) {
  const issues = [];
  if (text.length > limit) issues.push(`length ${text.length} > ${limit}`);
  const words = text.toLowerCase().match(/[a-z'’-]+/g) ?? [];
  for (const b of R.bannedWords) if (words.includes(b)) issues.push(`banned word "${b}"`);
  if (caseRule === 'title') {
    if (!isTitleCase(text)) issues.push('button not Title Case');
    if (/[.!?:]$/.test(text)) issues.push('button ends with punctuation');
    if (text.split(/\s+/).length > 4) issues.push('button over 4 words');
  } else if (caseRule === 'sentence' && !isSentenceCase(text)) issues.push('not sentence case');
  const f = readability ? flesch(text) : { score: null, words: 0 };
  if (f.score !== null && f.words >= R.minWordsForFlesch && f.score < R.minFlesch) issues.push(`Flesch ${f.score.toFixed(0)} < ${R.minFlesch}`);
  rows.push({ kind, id, len: text.length, limit, flesch: f.score === null ? '—' : f.score.toFixed(0), ok: issues.length ? 'FAIL' : 'ok', text });
  for (const i of issues) problems.push(`${id}: ${i}`);
}

// Safety line must be exact (CLAUDE.md / ADR-0002)
if (deck.safety.text !== SAFETY) problems.push('safety.line: text differs from the required wording');
if (!deck.safety.text.includes(deck.safety.linkText)) problems.push('safety.line: link text not inside the line');
lint('safety', deck.safety.id, deck.safety.text, R.limits.safety);

for (const v of deck.verdicts) {
  lint('verdict', v.id, v.label, R.limits.verdict, { readability: false });
  lint('verdict', `${v.id}.short`, v.short, R.limits.verdictShort, { readability: false });
}
for (const r of deck.reasons) lint('reason', r.id, r.text, R.limits.reason);
for (const a of deck.advice) lint('advice', a.id, a.text, R.limits.advice);
for (const s of deck.status) lint('status', s.id, s.text, R.limits.status);
for (const e of [...deck.errors, ...deck.empty]) lint('error', e.id, e.text, R.limits.error);
for (const b of deck.buttons) lint('button', b.id, b.text, R.limits.button, { caseRule: 'title', readability: false });
for (const c of deck.console) lint('console', c.id, c.text, R.limits.console);

// Unique ids
const ids = [deck.safety.id, ...['verdicts', 'reasons', 'advice', 'status', 'errors', 'empty', 'buttons', 'console'].flatMap((k) => deck[k].map((x) => x.id))];
for (const d of ids.filter((x, i) => ids.indexOf(x) !== i)) problems.push(`duplicate id ${d}`);

// --- cross-check with the flow spec -------------------------------------------
const spec = resolve(here, '../01-flow-beach-verdict/flow-spec.md');
let specChecked = 0;
if (existsSync(spec)) {
  const md = readFileSync(spec, 'utf8');
  const matrix = md.slice(md.indexOf('## 3. State matrix'), md.indexOf('## 4.'));
  const templates = [...deck.status, ...deck.errors].map((x) =>
    new RegExp('^' + x.text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '.+') + '$'));
  // Only the "Status text" column (5th cell) of each table row; skip role="…" values.
  for (const line of matrix.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| State') && !l.startsWith('|---'))) {
    const cell = (line.split('|')[4] ?? '').replace(/role="[^"]*"/g, '');
    for (const m of cell.matchAll(/"([^"]+)"/g)) {
      specChecked++;
      if (!templates.some((t) => t.test(m[1]))) problems.push(`flow-spec status not in deck: "${m[1]}"`);
    }
  }
}

// --- report -------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('kind', 8), pad('id', 28), pad('len/max', 8), pad('flesch', 7), pad('ok', 5), 'text');
for (const r of rows) console.log(pad(r.kind, 8), pad(r.id, 28), pad(`${r.len}/${r.limit}`, 8), pad(r.flesch, 7), pad(r.ok, 5), r.text);
const scored = rows.filter((r) => r.flesch !== '—').map((r) => +r.flesch);
console.log(`\n${rows.length} strings, ${specChecked} flow-spec status strings cross-checked`);
console.log(`Flesch (strings with words): min ${Math.min(...scored)}, mean ${(scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(0)}`);
console.log(problems.length ? `FAIL (${problems.length})\n- ${problems.join('\n- ')}` : 'PASS');
process.exit(problems.length ? 1 : 0);
