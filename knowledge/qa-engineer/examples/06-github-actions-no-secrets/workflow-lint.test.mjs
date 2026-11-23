// Run: npm install && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lintWorkflow } from "./workflow-lint.mjs";

const template = readFileSync(new URL("./tests.yml", import.meta.url), "utf8");
const pinned = template.replaceAll("<PIN-SHA>", "a".repeat(40)); // what a human's real file looks like

test("the template passes in template mode, and the pinned copy passes in strict mode", () => {
  assert.deepEqual(lintWorkflow(template, { strict: false }), []);
  assert.deepEqual(lintWorkflow(pinned, { strict: true }), []);
});
test("the template FAILS strict mode: unpinned actions are caught (a human must pin before committing)", () => {
  const p = lintWorkflow(template, { strict: true });
  assert.equal(p.filter((x) => x.includes("not pinned")).length, (template.match(/uses:/g) ?? []).length); // every `uses:` line
});

// Each mutation turns the good file into a bad one; the lint must name the problem.
const mutations = [
  ["write permission", (t) => t.replace("contents: read\n\nconcurrency", "contents: write\n\nconcurrency"), "permissions must be exactly"],
  ["extra permission", (t) => t.replace("permissions:\n  contents: read\n", "permissions:\n  contents: read\n  pull-requests: write\n"), "permissions must be exactly"],
  ["missing permissions block", (t) => t.replace("permissions:\n  contents: read\n\nconcurrency", "concurrency"), "permissions must be exactly"],
  ["job asks for id-token", (t) => t.replace("  unit:\n    runs-on", "  unit:\n    permissions:\n      id-token: write\n    runs-on"), "job unit: permissions may only"],
  ["pull_request_target", (t) => t.replace("  pull_request:\n", "  pull_request_target:\n"), "pull_request_target"],
  ["workflow_run", (t) => t.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  workflow_run:\n    workflows: [x]\n"), "workflow_run"],
  ["a secret reference", (t) => t.replace("node scripts/smoke.mjs", "node scripts/smoke.mjs --token ${{ secrets.NETLIFY_TOKEN }}"), "references secrets"],
  ["a Beach Day secret name", (t) => t.replace("EXPECT_COMMIT:", "ANTHROPIC_API_KEY: x\n          EXPECT_COMMIT:"), "names a Beach Day secret"],
  ["an unpinned tag", (t) => t.replaceAll("<PIN-SHA>", "a".repeat(40)).replace("a".repeat(40) + " # v4.x.y", "v4 # v4"), "not pinned"],
  ["a branch ref", (t) => t.replaceAll("<PIN-SHA>", "a".repeat(40)).replace("actions/setup-node@" + "a".repeat(40), "actions/setup-node@main"), "not pinned"],
  ["checkout keeps credentials", (t) => t.replace("          persist-credentials: false\n", ""), "persist-credentials"],
  ["expression inside run", (t) => t.replace("run: npm ci", 'run: echo "${{ github.head_ref }}"'), "inside run"],
  ["no timeout", (t) => t.replace("    timeout-minutes: 10\n", ""), "timeout-minutes"],
];
for (const [name, mutate, expected] of mutations) {
  test(`lint catches: ${name}`, () => {
    const problems = lintWorkflow(mutate(template), { strict: false });
    assert.ok(problems.some((x) => x.includes(expected)), `expected "${expected}" in ${JSON.stringify(problems)}`);
  });
}
test("repository variables (vars.SITE_URL) are allowed: they are plain text, not secrets", () => {
  assert.ok(template.includes("vars.SITE_URL"));
  assert.deepEqual(lintWorkflow(template, { strict: false }), []);
});
