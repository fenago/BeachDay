// scripts/build-agents.mjs: shape, prompt assembly and every fail rule (build_plan §5).
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildAgents, parseFrontmatter, resolveModel, MAX_PROMPT_BYTES } from "../../../scripts/build-agents.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repo, "scripts", "build-agents.mjs");

function fixture(over = {}) {
  const root = mkdtempSync(join(tmpdir(), "bd-agents-"));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const fm = over.frontmatter ?? "name: zed\ndescription: Zed does things: with a colon\nmodel: sonnet\ncolor: red\nskills:\n  - alpha\n  - beta\npersona: Zed\npersonality: Calm.";
  w(".claude/agents/zed.md", `---\n${fm}\n---\n\n## Body\nHello.\n`);
  w(".claude/agents/ann.md", "---\nname: ann\ndescription: Ann\n---\nAnn body\n");
  if (!over.noSkills) { w(".claude/skills/alpha/SKILL.md", "---\nname: alpha\n---\nALPHA\n"); w(".claude/skills/beta/SKILL.md", "BETA\n"); }
  for (const n of ["zed", "ann"]) {
    if (over.noReadme !== n) w(`knowledge/${n}/README.md`, `# ${n} knowledge\nindex\n`);
    w(`knowledge/${n}/docs/02-b.md`, "# Doc B\nb\n"); w(`knowledge/${n}/docs/01-a.md`, "# Doc A\na\n");
    w(`knowledge/${n}/examples/01-x/README.md`, "# Example X\n");
  }
  return root;
}
const withRoot = (over, fn) => { const root = fixture(over); try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };

test("shape: sorted by name, persona/personality fallbacks, model resolved, knowledge listing", () => withRoot({}, (root) => {
  const { agents } = buildAgents({ root });
  expect(agents.map((a) => a.name)).toEqual(["ann", "zed"]);
  const [ann, zed] = agents;
  expect([ann.persona, ann.personality, ann.model, ann.modelLabel]).toEqual(["ann", "Ann", "claude-opus-5-5", "Opus"]);
  expect([zed.persona, zed.personality, zed.model, zed.modelLabel, zed.color]).toEqual(["Zed", "Calm.", "claude-sonnet-5-5", "Sonnet", "red"]);
  expect(zed.description).toBe("Zed does things: with a colon");
  expect(zed.skills).toEqual(["alpha", "beta"]);
  expect(zed.knowledge).toEqual({ path: "knowledge/zed/", title: "zed knowledge", docs: [{ file: "01-a.md", title: "Doc A" }, { file: "02-b.md", title: "Doc B" }], examples: [{ dir: "01-x", title: "Example X" }] });
}));

test("systemPrompt order: body, skills in listed order, knowledge README then sorted docs, examples list; no timestamp", () => withRoot({}, (root) => {
  const p = buildAgents({ root }).agents[1].systemPrompt;
  const at = (s) => { const i = p.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
  const order = [at("## Body"), at("# Skill: alpha"), at("ALPHA"), at("# Skill: beta"), at("BETA"), at("# Knowledge: knowledge/zed/"), at("index"), at("docs/01-a.md"), at("docs/02-b.md"), at("Read them with read_file from main"), at("knowledge/zed/examples/01-x/")];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(buildAgents({ root }).agents[1].systemPrompt).toBe(p); // deterministic
  expect(p).not.toMatch(/20\d\d-\d\d-\d\dT\d\d:/);
}));

test("fails: missing skill folder, missing knowledge README, bad model, bad YAML, unsafe names, oversize prompt", () => {
  withRoot({ noSkills: true }, (root) => expect(() => buildAgents({ root })).toThrow(/skill folder missing for alpha/));
  withRoot({ noReadme: "zed" }, (root) => expect(() => buildAgents({ root })).toThrow(/missing knowledge\/zed\/README.md/));
  for (const bad of ["fable", "claude-opus-5-5", "Opus"]) {
    withRoot({ frontmatter: `name: zed\ndescription: d\nmodel: ${bad}` }, (root) => expect(() => buildAgents({ root }), bad).toThrow(/model must be/));
  }
  withRoot({ frontmatter: "name: zed\ndescription: d\n  nested: thing" }, (root) => expect(() => buildAgents({ root })).toThrow(/list item without a key|invalid frontmatter/));
  withRoot({ frontmatter: "name: zed\nname: again\ndescription: d" }, (root) => expect(() => buildAgents({ root })).toThrow(/duplicate key/));
  withRoot({ frontmatter: "name: ../zed\ndescription: d" }, (root) => expect(() => buildAgents({ root })).toThrow(/safe slug/));
  withRoot({ frontmatter: "name: zed\ndescription: d\nskills:\n  - ../../etc" }, (root) => expect(() => buildAgents({ root })).toThrow(/safe slug/));
  withRoot({}, (root) => {
    writeFileSync(join(root, "knowledge/zed/docs/03-big.md"), "# Big\n" + "x".repeat(MAX_PROMPT_BYTES));
    expect(() => buildAgents({ root })).toThrow(/over the \d+ limit/);
  });
  expect(() => parseFrontmatter("no frontmatter", "f")).toThrow(/must start with/);
  expect(() => parseFrontmatter("---\nname: a\n", "f")).toThrow(/not closed/);
});

test("model aliases: opus, inherit and missing give Opus; sonnet; haiku", () => {
  expect(resolveModel(undefined, "f").model).toBe("claude-opus-5-5");
  expect(resolveModel("inherit", "f").model).toBe("claude-opus-5-5");
  expect(resolveModel("sonnet", "f").model).toBe("claude-sonnet-5-5");
  expect(resolveModel("haiku", "f").model).toBe("claude-haiku-5-5");
});

test("agent files are data: an agent body containing code is never executed", () => withRoot({}, (root) => {
  writeFileSync(join(root, ".claude/agents/ann.md"), "---\nname: ann\ndescription: Ann\n---\n```js\nprocess.exit(7); throw new Error('ran')\n```\n");
  expect(buildAgents({ root }).agents[0].systemPrompt).toContain("process.exit(7)");
}));

test("CLI on the REAL repo: 12 agents, writes agents.json, one summary line, never prints env", () => {
  const out = join(mkdtempSync(join(tmpdir(), "bd-agents-out-")), "agents.json");
  const SENTINEL = "SECRET-SENTINEL-EXAMPLE-77b1";
  const r = spawnSync(process.execPath, [script, "--out", out], { env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: SENTINEL }, encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout.trim().split("\n")).toHaveLength(1);
  expect(r.stdout).toMatch(/^build-agents: 12 agents, \d+ skills, biggest prompt [\d.]+ KB/);
  expect(r.stdout + r.stderr + readFileSync(out, "utf8")).not.toContain(SENTINEL);
  const agents = JSON.parse(readFileSync(out, "utf8"));
  expect(agents).toHaveLength(12);
  expect(agents.map((a) => a.name)).toEqual([...agents.map((a) => a.name)].sort());
  for (const a of agents) {
    expect(Object.keys(a).sort()).toEqual(["color", "description", "knowledge", "model", "modelLabel", "name", "persona", "personality", "skills", "systemPrompt"]);
    expect(Buffer.byteLength(a.systemPrompt)).toBeLessThan(MAX_PROMPT_BYTES);
    expect(a.systemPrompt).toContain(`# Knowledge: knowledge/${a.name}/`);
  }
});

test("CLI failure exits 1 and writes nothing", () => withRoot({ noSkills: true }, (root) => {
  const out = join(root, "agents.json");
  const r = spawnSync(process.execPath, [script, "--root", root, "--out", out], { encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(existsSync(out)).toBe(false);
}));
