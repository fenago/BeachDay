#!/usr/bin/env node
// Checks an ADR against the docs/adr/README.md template and the architecture-decision-records skill.
// Usage: node check-adr.mjs <adr.md> [--index docs/adr/README.md] [--draft]
// ERROR = breaks the template; WARN = style advice from Nygard. --draft also requires Status: Proposed.
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ix = process.argv.indexOf('--index');
const index = ix > 0 ? process.argv[ix + 1] : null;
const text = readFileSync(file, 'utf8');
const lines = text.split('\n');
const errors = [];
const warns = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };
const advise = (cond, msg) => { if (!cond) warns.push(msg); };
const draft = process.argv.includes('--draft');

const m = basename(file).match(/^(\d{4})-([a-z0-9-]+)\.md$/);
check(m, 'filename must be NNNN-short-title.md (4 digits, lowercase-hyphen)');
const title = lines[0].match(/^# (\d{4}) — (.+)$/);
check(title, 'line 1 must be "# NNNN — Title" (em dash)');
if (m && title) check(m[1] === title[1], `number in filename (${m?.[1]}) != title (${title?.[1]})`);
const status = lines[1]?.match(/^- Status: (Proposed|Accepted|Superseded by \d{4})$/);
check(status, 'line 2 must be "- Status: Proposed | Accepted | Superseded by NNNN"');
check(/^- Date: \d{4}-\d{2}-\d{2}$/.test(lines[2] || ''), 'line 3 must be "- Date: YYYY-MM-DD"');
check(/^- Deciders: Dr\. Lee/.test(lines[3] || ''), 'line 4 must be "- Deciders: Dr. Lee (...)"');
const heads = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
const REQ = ['Context', 'Decision', 'Consequences', 'Revisit when'];
const present = heads.filter((h) => REQ.includes(h));
check(JSON.stringify(present) === JSON.stringify(REQ), `sections must include, in order, ${REQ.join(', ')} (got ${heads.join(', ')})`);
const extra = heads.filter((h) => !REQ.includes(h));
advise(extra.length === 0, `extra section(s) not in the template: ${extra.join(', ')}`);
const section = (h) => text.split(`## ${h}`)[1]?.split('\n## ')[0] || '';
advise(/\bWe will\b/.test(section('Decision')), 'Decision should be active voice ("We will ...") per Nygard');
advise(/\bBad\b|\bnegative\b|\bcost\b|\bno shared\b|\bcannot\b|\bmust\b/i.test(section('Consequences')), 'Consequences must include the bad, not only the good');
check(section('Revisit when').trim().length > 0, 'Revisit when needs a concrete trigger');
if (draft) check(status?.[1] === 'Proposed', 'agents may only draft Proposed ADRs; Dr. Lee accepts');
if (index && existsSync(index) && m) {
  const used = [...readFileSync(index, 'utf8').matchAll(/\[(\d{4})\]/g)].map((x) => x[1]);
  check(!used.includes(m[1]), `number ${m[1]} already used in ${index}`);
  const next = String(Math.max(...used.map(Number)) + 1).padStart(4, '0');
  check(m[1] === next, `next free number is ${next}, not ${m[1]}`);
}
for (const e of errors) console.log(`ERROR ${e}`);
for (const w of warns) console.log(`WARN  ${w}`);
console.log(errors.length ? `${file}: ${errors.length} error(s), ${warns.length} warning(s)` : `${file}: ok (status ${status[1]}, ${warns.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
