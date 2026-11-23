// DEPLOY_PATHS must equal the path list in the `ignore` command in netlify.toml (docs/04 §1, build_plan D9).
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { DEPLOY_PATHS, deploysOnCommit, deploysOnPath } from "../../netlify/functions/lib/deploys.mts";

const toml = parse(readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8"));
const ignoreList = (cmd) => cmd.split(/\s--\s/)[1].replace(/\s*\|\|\s*exit 1\s*$/, "").trim().split(/\s+/);

test("parity: DEPLOY_PATHS equals the path list in netlify.toml ignore, in the same order", () => {
  expect([...DEPLOY_PATHS]).toEqual(ignoreList(toml.build.ignore));
});

test("D9: knowledge and .claude/skills are deploy paths; docs, tests and root markdown are not", () => {
  expect(DEPLOY_PATHS).toEqual(["public", "netlify", "netlify.toml", "package.json", "package-lock.json", "scripts", ".claude/agents", ".claude/skills", "knowledge"]);
  for (const p of ["public/index.html", "public/js/app.js", "netlify/functions/chat.mts", "netlify.toml", "package.json", "package-lock.json",
    "scripts/stamp-sw.mjs", ".claude/agents/qa-engineer.md", ".claude/skills/netlify-blobs/SKILL.md", "knowledge/netlify-engineer/README.md"]) {
    expect(deploysOnPath(p), p).toBe(true);
  }
  for (const p of ["docs/03-architecture-netlify.md", "docs/adr/0004.md", "tests/unit/a.test.mjs", "README.md", "CLAUDE.md", ".claude/settings.json", ".github/workflows/x.yml"]) {
    expect(deploysOnPath(p), p).toBe(false);
  }
});

test("path matching is by whole segment and case-sensitive", () => {
  expect(deploysOnPath("publicity/x.md")).toBe(false);
  expect(deploysOnPath("netlify.toml.bak")).toBe(false);
  expect(deploysOnPath("Public/index.html")).toBe(false);
  expect(deploysOnPath("")).toBe(false);
});

test("deploysOnCommit: any deploying path deploys; an empty or docs-only commit does not", () => {
  expect(deploysOnCommit(["docs/a.md", "public/index.html"])).toBe(true);
  expect(deploysOnCommit(["docs/a.md", "tests/x.test.mjs"])).toBe(false);
  expect(deploysOnCommit([])).toBe(false);
});
