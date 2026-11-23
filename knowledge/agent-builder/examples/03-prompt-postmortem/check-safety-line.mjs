#!/usr/bin/env node
// End-state check for UX specs: every "## " section that shows a verdict label must also carry
// the safety line (ADR-0002, beach-day-scoring). Usage: node check-safety-line.mjs <spec.md> [...]
import { readFileSync } from 'node:fs';

export const VERDICTS = ['Great beach day', 'Good', 'Fair — pick your hours', 'Skip it'];
export const SAFETY = 'Beach Day is not a safety service — check NWS rip-current risk and posted beach flags.';

export function checkSpec(text) {
  const sections = text.split(/^## /m).slice(1).map((s) => ({ title: s.split('\n')[0].trim(), body: s }));
  const cell = (label) => new RegExp(`\\|\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`);
  return sections
    .filter((s) => VERDICTS.some((v) => cell(v).test(s.body)))
    .map((s) => ({ section: s.title, ok: s.body.includes(SAFETY) }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0;
  for (const f of process.argv.slice(2)) {
    for (const r of checkSpec(readFileSync(f, 'utf8'))) {
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${f} § ${r.section}${r.ok ? '' : ' — verdicts shown without the safety line'}`);
      if (!r.ok) failed++;
    }
  }
  process.exit(failed ? 1 : 0);
}
