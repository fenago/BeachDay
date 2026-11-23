#!/usr/bin/env node
// Validates HANDOFF blocks (team-protocol format) found in Markdown or text files.
// Usage: node validate-handoff.mjs <file> [more files...]
// Exit code 0 = every block valid, 1 = at least one invalid block or no blocks found.
// No dependencies (Node 22+).

import { readFileSync } from 'node:fs';

export const REQUIRED = ['status', 'summary', 'files', 'tests', 'needs', 'risks/questions'];
export const STATUS = ['done', 'blocked', 'needs-review'];
export const AGENTS = [
  'orchestrator', 'agent-builder', 'software-architect', 'open-meteo-integrator',
  'pwa-mobile-engineer', 'security-engineer', 'agent-console-engineer',
  'ui-designer-apple-liquid-glass', 'ux-designer-apple-hig', 'qa-engineer', 'netlify-engineer',
];

// Pull every HANDOFF block: a line that is exactly "HANDOFF" up to a closing ``` fence or blank line pair.
export function extractBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'HANDOFF') continue;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim().startsWith('```') || l.trim() === 'HANDOFF') break;
      body.push(l);
    }
    blocks.push({ line: i + 1, body });
    i = j - 1;
  }
  return blocks;
}

// Parse "key: value" lines; indented lines continue the previous field.
export function parseBlock(bodyLines) {
  const fields = {};
  const order = [];
  let current = null;
  for (const raw of bodyLines) {
    if (raw.trim() === '') continue;
    const m = raw.match(/^([a-z/]+):\s?(.*)$/);
    if (m && REQUIRED.includes(m[1])) {
      current = m[1];
      if (current in fields) fields[current] += '\n' + m[2]; // duplicate key, keep and flag later
      else fields[current] = m[2];
      order.push(current);
    } else if (/^\s+\S/.test(raw) && current) {
      fields[current] += '\n' + raw.trim();
    } else {
      order.push(`?${raw.trim()}`);
    }
  }
  return { fields, order };
}

export function validateBlock(bodyLines) {
  const { fields, order } = parseBlock(bodyLines);
  const errors = [];
  for (const key of REQUIRED) {
    if (!(key in fields)) errors.push(`missing field "${key}"`);
    else if (fields[key].trim() === '') errors.push(`empty field "${key}"`);
  }
  const dupes = order.filter((k, i) => !k.startsWith('?') && order.indexOf(k) !== i);
  for (const d of new Set(dupes)) errors.push(`duplicate field "${d}"`);
  for (const k of order.filter((k) => k.startsWith('?'))) errors.push(`unexpected line "${k.slice(1)}"`);
  const present = order.filter((k) => REQUIRED.includes(k));
  const expected = REQUIRED.filter((k) => present.includes(k));
  if (JSON.stringify([...new Set(present)]) !== JSON.stringify(expected)) {
    errors.push(`fields out of order (expected ${REQUIRED.join(', ')})`);
  }
  if ('status' in fields) {
    const s = fields.status.trim();
    if (!STATUS.includes(s)) errors.push(`status "${s}" not in ${STATUS.join(' | ')}`);
    if (s === 'blocked' && /^none\b/i.test((fields.needs || '').trim()) &&
        /^none\b/i.test((fields['risks/questions'] || '').trim())) {
      errors.push('status "blocked" must say what blocks it (needs or risks/questions)');
    }
  }
  if ('needs' in fields) {
    const n = fields.needs.trim();
    if (!/^none\b/i.test(n)) {
      const named = AGENTS.filter((a) => n.includes(a));
      if (named.length === 0 && !/Dr\. Lee/.test(n)) {
        errors.push('needs must be "none" or name an agent from the roster (or Dr. Lee)');
      }
    }
  }
  if ('tests' in fields && /\bpass(ed)?\b/i.test(fields.tests) && !/\d/.test(fields.tests)) {
    errors.push('tests claims a pass but gives no command/count; say what ran');
  }
  return { fields, errors };
}

function main(files) {
  if (files.length === 0) {
    console.error('usage: node validate-handoff.mjs <file> [...]');
    process.exit(2);
  }
  let bad = 0;
  let total = 0;
  for (const f of files) {
    const blocks = extractBlocks(readFileSync(f, 'utf8'));
    if (blocks.length === 0) {
      console.log(`${f}: no HANDOFF blocks found`);
      bad++;
      continue;
    }
    for (const b of blocks) {
      total++;
      const { fields, errors } = validateBlock(b.body);
      const tag = `${f}:${b.line} [status=${(fields.status || '?').trim()}]`;
      if (errors.length) {
        bad++;
        console.log(`INVALID ${tag}`);
        for (const e of errors) console.log(`  - ${e}`);
      } else {
        console.log(`ok      ${tag}`);
      }
    }
  }
  console.log(`\n${total} block(s) checked, ${bad} problem(s)`);
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
