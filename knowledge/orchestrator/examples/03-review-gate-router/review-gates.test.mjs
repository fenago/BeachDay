// Run: node --test knowledge/orchestrator/examples/03-review-gate-router/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredReviewers, globToRegExp, normalisePath, GATES } from './review-gates.mjs';

test('glob matcher: ** spans directories, * does not', () => {
  assert.ok(globToRegExp('netlify/functions/**').test('netlify/functions/lib/auth.mts'));
  assert.ok(globToRegExp('.claude/skills/**').test('.claude/skills/team-protocol/SKILL.md'));
  assert.ok(globToRegExp('**/.env*').test('.env.local'));
  assert.ok(globToRegExp('**/.env*').test('netlify/.env'));
  assert.ok(!globToRegExp('public/*.js').test('public/js/app.js'));
  assert.ok(globToRegExp('public/js/console/{auth,approve}.js').test('public/js/console/approve.js'));
});

test('functions change → security + netlify + qa (production)', () => {
  const r = requiredReviewers(['netlify/functions/chat.mts']);
  assert.deepEqual(r.reviewers, ['security-engineer', 'netlify-engineer', 'qa-engineer']);
  assert.equal(r.deploys, true);
  assert.deepEqual(r.blocking, []);
});

test('allow-list change → security-engineer can block', () => {
  const r = requiredReviewers(['netlify/functions/lib/allowlist.mts']);
  assert.ok(r.reviewers.includes('security-engineer'));
  assert.ok(r.reviewers.includes('netlify-engineer'));
  assert.deepEqual(r.blocking, ['security-engineer']);
  assert.deepEqual(r.gates.map((g) => g.id), ['functions-config', 'console-security', 'production']);
});

test('_headers lives in public/ but still needs security + netlify', () => {
  const r = requiredReviewers(['public/_headers']);
  assert.deepEqual(r.reviewers, ['security-engineer', 'netlify-engineer', 'qa-engineer']);
});

test('scoring thresholds → open-meteo-integrator + Wren (+ qa for production)', () => {
  const r = requiredReviewers(['public/js/score-config.js']);
  assert.deepEqual(r.reviewers, ['open-meteo-integrator', 'ux-designer-apple-hig', 'qa-engineer']);
});

test('visual tokens → Sable + QA', () => {
  const r = requiredReviewers(['public/css/tokens.css']);
  assert.deepEqual(r.reviewers, ['ui-designer-apple-liquid-glass', 'qa-engineer']);
});

test('service worker and manifest → pwa + QA', () => {
  const r = requiredReviewers(['public/sw.js', 'public/manifest.webmanifest']);
  assert.deepEqual(r.reviewers, ['pwa-mobile-engineer', 'qa-engineer']);
  assert.equal(r.gates.find((g) => g.id === 'pwa').paths.length, 2);
});

test('agent and skill files → agent-builder + orchestrator, no deploy', () => {
  const r = requiredReviewers(['.claude/agents/qa-engineer.md', '.claude/skills/team-protocol/SKILL.md']);
  assert.deepEqual(r.reviewers, ['agent-builder', 'orchestrator']);
  assert.equal(r.deploys, false);
});

test('docs-only change needs no gate and does not deploy', () => {
  const r = requiredReviewers(['docs/adr/0006-hash-route-spa.md', 'docs/README.md']);
  assert.deepEqual(r.reviewers, []);
  assert.equal(r.deploys, false);
});

test('mixed proposal unions reviewers without duplicates', () => {
  const r = requiredReviewers(['public/css/glass.css', 'public/js/score.js', 'tests/unit/score.test.js']);
  assert.deepEqual(r.reviewers,
    ['open-meteo-integrator', 'ux-designer-apple-hig', 'ui-designer-apple-liquid-glass', 'qa-engineer']);
});

test('env files anywhere → security + netlify', () => {
  const r = requiredReviewers(['.env.production']);
  assert.deepEqual(r.reviewers, ['security-engineer', 'netlify-engineer']);
});

test('unsafe paths are rejected and escalated to security-engineer', () => {
  assert.equal(normalisePath('public/../netlify.toml'), null);
  assert.equal(normalisePath('/etc/passwd'), null);
  assert.equal(normalisePath('public\\sw.js'), null);
  assert.equal(normalisePath('./public//sw.js'), 'public/sw.js');
  const r = requiredReviewers(['public/../netlify/functions/approve.mts']);
  assert.deepEqual(r.invalid, ['public/../netlify/functions/approve.mts']);
  assert.deepEqual(r.blocking, ['security-engineer']);
});

test('every gate row from the skill table is implemented', () => {
  const rows = GATES.map((g) => g.id);
  assert.deepEqual(rows, ['functions-config', 'console-security', 'scoring', 'visual', 'pwa', 'agents', 'production']);
});
