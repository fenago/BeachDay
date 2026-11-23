#!/usr/bin/env node
// Lints Claude Code subagent files and skills for the Beach Day repo.
// Checks Claude Code's own load rules (sub-agents and skills docs) plus Beach Day conventions
// (claude-code-agent-authoring skill, CLAUDE.md, change-proposal-protocol).
//
// Usage:
//   node lint-agents.mjs [--root <repo>] [--agents-dir <dir>] [--skills-dir <dir>]... [--json] [--no-docs]
// Defaults: --root = cwd, agents = <root>/.claude/agents, skills = <root>/.claude/skills
// Several --skills-dir values are searched in order (lets an example skill sit outside the repo).
// Exit 1 if any ERROR, else 0. WARN never fails the run. Read-only: it never edits files.
// Dependency: yaml (npm i yaml) — the same YAML 1.2 parser family Claude Code-compatible tooling uses.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ---- documented values (code.claude.com/docs/en/sub-agents, /skills) ----
const AGENT_FIELDS = ['name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns',
  'autoCompactWindow', 'skills', 'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort',
  'isolation', 'color', 'initialPrompt', 'experimental'];
const CUSTOM_AGENT_FIELDS = ['personality', 'persona']; // Beach Day: read by the Agent Console, ignored by Claude Code
const SKILL_FIELDS = ['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation',
  'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background',
  'hooks', 'paths', 'shell', 'metadata', 'license', 'compatibility'];
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
const MODEL_ALIASES = ['sonnet', 'opus', 'haiku', 'fable', 'inherit'];
const MEMORY = ['user', 'project', 'local'];
const EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSION_MODES = ['default', 'manual', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan'];
// ---- Beach Day conventions ----
const REQUIRED_SKILLS = ['beach-day-context', 'change-proposal-protocol'];
const ORCHESTRATOR = 'orchestrator';

// ---- args ----
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const root = resolve(opt('--root') || process.cwd());
const agentsDir = resolve(opt('--agents-dir') || join(root, '.claude/agents'));
const skillDirs = args.flatMap((a, i) => (a === '--skills-dir' ? [resolve(args[i + 1])] : []));
if (skillDirs.length === 0) skillDirs.push(join(root, '.claude/skills'));
const asJson = args.includes('--json');
const checkDocs = !args.includes('--no-docs'); // skip CLAUDE.md / roster mentions (for fixtures)

const findings = [];
const add = (level, file, msg) => findings.push({ level, file, msg });
const rel = (p) => p.replace(root + '/', '');

// Levenshtein distance for "did you mean" on unknown fields
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const suggest = (k, list) => list.find((f) => f.toLowerCase() === k.toLowerCase() || lev(f, k) <= 2);

/** Split a Markdown file into frontmatter (parsed) and body, following Claude Code's line-1 rule. */
export function readFrontmatter(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { error: `'---' is not on line 1 (found ${JSON.stringify(lines[0]?.slice(0, 20))}); Claude Code treats the file as having no frontmatter` };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { error: 'no closing --- for the frontmatter' };
  let data;
  try {
    data = parseYaml(lines.slice(1, end).join('\n'));
  } catch (e) {
    return { error: `YAML does not parse: ${e.message.split('\n')[0]}` };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { error: 'frontmatter is not a YAML mapping' };
  return { data, body: lines.slice(end + 1).join('\n'), lineCount: lines.length };
}

const toList = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()).filter(Boolean));
/** Split a tools string on commas that are not inside parentheses: "Agent(a, b), Read" → ["Agent(a, b)", "Read"]. */
export function splitTools(v) {
  if (Array.isArray(v)) return v.map(String);
  if (v == null) return [];
  const out = []; let depth = 0; let cur = '';
  for (const ch of String(v)) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function findSkill(name) {
  for (const d of skillDirs) {
    const p = join(d, name, 'SKILL.md');
    if (existsSync(p)) return p;
  }
  return null;
}

// ---------------- skills ----------------
const skills = new Map(); // name -> {path, data}
for (const dir of skillDirs) {
  if (!existsSync(dir)) { add('ERROR', dir, 'skills directory not found'); continue; }
  for (const folder of readdirSync(dir).sort()) {
    const fdir = join(dir, folder);
    if (!statSync(fdir).isDirectory()) continue;
    const p = join(fdir, 'SKILL.md');
    if (!existsSync(p)) { add('ERROR', rel(fdir), 'skill folder has no SKILL.md'); continue; }
    const fm = readFrontmatter(p);
    if (fm.error) { add('ERROR', rel(p), fm.error); continue; }
    const { data, lineCount } = fm;
    skills.set(folder, { path: p, data });
    for (const k of Object.keys(data)) if (!SKILL_FIELDS.includes(k)) {
      const s = suggest(k, SKILL_FIELDS);
      add('WARN', rel(p), `unknown skill field "${k}" (ignored by Claude Code)${s ? `; did you mean "${s}"?` : ''}`);
    }
    if (!data.name) add('ERROR', rel(p), 'missing name (convention: set it, equal to the folder name)');
    else if (data.name !== folder) add('ERROR', rel(p), `name "${data.name}" != folder "${folder}"`);
    if (!data.description) add('ERROR', rel(p), 'missing description (Claude cannot decide when to use the skill)');
    const descLen = String(data.description || '').length + String(data.when_to_use || '').length;
    if (descLen > 1536) add('WARN', rel(p), `description + when_to_use is ${descLen} chars; listing truncates at 1,536`);
    if (/[<>]/.test(String(data.description || ''))) add('WARN', rel(p), 'description contains < or >; shown as HTML entities');
    if (lineCount > 500) add('WARN', rel(p), `${lineCount} lines; docs say keep SKILL.md under 500`);
    if (data['disable-model-invocation'] === true) add('INFO', rel(p), 'disable-model-invocation: true → cannot be preloaded by agents');
  }
}

// ---------------- agents ----------------
const agents = new Map(); // name -> {path, data, body}
if (!existsSync(agentsDir)) add('ERROR', agentsDir, 'agents directory not found');
const agentFiles = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort() : [];
for (const f of agentFiles) {
  const p = join(agentsDir, f);
  const fm = readFrontmatter(p);
  if (fm.error) { add('ERROR', rel(p), fm.error + ' → Claude Code skips this agent'); continue; }
  const { data, body } = fm;
  const file = rel(p);
  // Claude Code load rules
  if (!data.name) { add('ERROR', file, 'missing name → treated as documentation, not loaded'); continue; }
  const name = String(data.name);
  if (name.includes(':') || name.startsWith('-') || name.length > 256) add('ERROR', file, `invalid name "${name}" → skipped`);
  if (!data.description) add('ERROR', file, 'missing description → skipped');
  agents.set(name, { path: p, data, body, file });
  for (const k of Object.keys(data)) {
    if (AGENT_FIELDS.includes(k) || CUSTOM_AGENT_FIELDS.includes(k)) continue;
    const s = suggest(k, [...AGENT_FIELDS, ...CUSTOM_AGENT_FIELDS]);
    add(s ? 'ERROR' : 'WARN', file, `unknown field "${k}" is silently ignored${s ? `; did you mean "${s}"?` : ''}`);
  }
  if (data.model != null && !MODEL_ALIASES.includes(data.model) && !/^claude-[a-z0-9.-]+$/.test(data.model))
    add('ERROR', file, `model "${data.model}" is not an alias (${MODEL_ALIASES.join('/')}) or a claude-* ID`);
  if (data.color != null && !COLORS.includes(data.color)) add('ERROR', file, `color "${data.color}" not in ${COLORS.join(', ')}`);
  if (data.memory != null && !MEMORY.includes(data.memory)) add('ERROR', file, `memory "${data.memory}" not in ${MEMORY.join('/')}`);
  if (data.effort != null && !EFFORT.includes(data.effort)) add('ERROR', file, `effort "${data.effort}" not in ${EFFORT.join('/')}`);
  if (data.permissionMode != null && !PERMISSION_MODES.includes(data.permissionMode)) add('ERROR', file, `permissionMode "${data.permissionMode}" invalid`);
  // skills
  if (data.skills != null && !Array.isArray(data.skills)) add('ERROR', file, 'skills must be a YAML list');
  const sk = toList(data.skills);
  if (sk.length > 32) add('WARN', file, `${sk.length} skills; only the first 32 are preloaded`);
  const dup = sk.filter((s, i) => sk.indexOf(s) !== i);
  if (dup.length) add('WARN', file, `duplicate skills: ${[...new Set(dup)].join(', ')}`);
  for (const s of sk) {
    const sp = findSkill(s);
    if (!sp) add('ERROR', file, `skill "${s}" has no folder with SKILL.md → silently not preloaded`);
    else if (skills.get(s)?.data['disable-model-invocation'] === true) add('ERROR', file, `skill "${s}" sets disable-model-invocation: true → cannot be preloaded`);
  }
  for (const r of REQUIRED_SKILLS) if (!sk.includes(r)) add('ERROR', file, `convention: every agent preloads "${r}"`);
  // Beach Day conventions
  if (name !== basename(f, '.md')) add('ERROR', file, `convention: name "${name}" must equal the filename`);
  if (!data.personality || String(data.personality).trim() === '') add('ERROR', file, 'convention: personality line missing (Agent Console falls back to description)');
  if (!data.persona || !/^[A-Z][a-z]+$/.test(String(data.persona))) add('ERROR', file, `convention: persona must be a first name (got ${JSON.stringify(data.persona)})`);
  else if (!new RegExp(`^## Who you are\\s*$`, 'm').test(body)) add('WARN', file, 'convention: body has no "## Who you are" section for the persona');
  else if (!body.includes(`**${data.persona}**`)) add('WARN', file, `"Who you are" section does not name **${data.persona}**`);
  if (data.personality && String(data.personality).includes('\n')) add('WARN', file, 'personality should be one line');
  for (const k of ['tools', 'model', 'color']) if (data[k] == null) add('WARN', file, `convention: set "${k}" explicitly`);
  const tools = splitTools(data.tools);
  const disallowed = splitTools(data.disallowedTools);
  if (name !== ORCHESTRATOR) {
    if (!disallowed.includes('Agent')) add('ERROR', file, 'expert must have disallowedTools: Agent (hub-and-spoke)');
    if (tools.some((t) => t === 'Agent' || t.startsWith('Agent(') || t === 'Task' || t.startsWith('Task(')))
      add('ERROR', file, 'expert lists Agent/Task in tools; only the orchestrator delegates');
  }
  if (!/HANDOFF/.test(body)) add('WARN', file, 'body never mentions HANDOFF (team-protocol)');
  const kn = `knowledge/${name}/`;
  if (!body.includes(kn)) add('WARN', file, `body does not point to ${kn} ("Before you answer" block)`);
  else if (!existsSync(join(root, kn))) add('WARN', file, `${kn} referenced but missing`);
  if (/\b(sk-ant-|github_pat_|ghp_)[A-Za-z0-9_]{20,}/.test(readFileSync(p, 'utf8'))) add('ERROR', file, 'looks like a secret token in the file');
}

// ---------------- cross-file checks ----------------
const orch = agents.get(ORCHESTRATOR);
if (orch) {
  const tools = splitTools(orch.data.tools);
  const agentEntry = tools.find((t) => /^(Agent|Task)\(/.test(t));
  if (!agentEntry) add('ERROR', orch.file, 'orchestrator has no Agent(...) allowlist in tools');
  else {
    const listed = agentEntry.replace(/^(Agent|Task)\(|\)$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    const experts = [...agents.keys()].filter((n) => n !== ORCHESTRATOR);
    const missing = experts.filter((n) => !listed.includes(n));
    const extra = listed.filter((n) => !agents.has(n));
    if (missing.length) add('ERROR', orch.file, `Agent(...) is missing agent files: ${missing.join(', ')}`);
    if (extra.length) add('ERROR', orch.file, `Agent(...) lists agents with no file: ${extra.join(', ')}`);
    if (!missing.length && !extra.length) add('INFO', orch.file, `Agent(...) matches the ${experts.length} expert files`);
    add('INFO', orch.file, 'Agent(...) is enforced only when run as `claude --agent orchestrator` (docs: sub-agents)');
  }
} else if (agentFiles.length > 1) add('WARN', agentsDir, 'no orchestrator.md; skipped Agent(...) roster check');

const used = new Set([...agents.values()].flatMap((a) => toList(a.data.skills)));
for (const s of skills.keys()) if (!used.has(s)) add('WARN', rel(skills.get(s).path), 'skill is not preloaded by any agent');

for (const doc of ['CLAUDE.md', 'docs/expert-roster.md', 'docs/agent-brains.md']) {
  const p = join(root, doc);
  if (!checkDocs || !existsSync(p) || agents.size < 2) continue;
  const text = readFileSync(p, 'utf8');
  for (const n of agents.keys()) if (!text.includes(n)) add('WARN', doc, `does not mention agent "${n}"`);
  if (doc !== 'docs/expert-roster.md') for (const a of agents.values()) if (a.data.persona && !text.includes(String(a.data.persona))) add('WARN', doc, `does not mention persona "${a.data.persona}"`);
  if (doc === 'docs/expert-roster.md') for (const s of skills.keys()) if (!text.includes(s)) add('WARN', doc, `does not mention skill "${s}"`);
}

// ---------------- report ----------------
const counts = { ERROR: 0, WARN: 0, INFO: 0 };
findings.forEach((f) => counts[f.level]++);
if (asJson) {
  console.log(JSON.stringify({ root, agents: agents.size, skills: skills.size, counts, findings }, null, 2));
} else {
  console.log(`Linted ${agents.size} agent(s) in ${rel(agentsDir) || agentsDir} and ${skills.size} skill(s) in ${skillDirs.map(rel).join(', ')}`);
  for (const lvl of ['ERROR', 'WARN', 'INFO']) for (const f of findings.filter((x) => x.level === lvl))
    console.log(`${lvl.padEnd(5)} ${f.file}: ${f.msg}`);
  console.log(`\n${counts.ERROR} error(s), ${counts.WARN} warning(s), ${counts.INFO} info`);
}
process.exit(counts.ERROR ? 1 : 0);
