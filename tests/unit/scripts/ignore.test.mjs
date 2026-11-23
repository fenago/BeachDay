// The `ignore` command in netlify.toml, run in a throwaway git repo: docs-only commits skip (exit 0),
// anything the build reads or publishes builds (exit 1), and a missing cached ref builds (build_plan D9).
import { test, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parse } from "smol-toml";

const ignore = parse(readFileSync(new URL("../../../netlify.toml", import.meta.url), "utf8")).build.ignore;

test("ignore: skips docs-only, tests-only and root-markdown commits; builds for everything the build reads", () => {
  const repo = mkdtempSync(join(tmpdir(), "bd-ignore-"));
  const sh = (cmd) => execSync(cmd, { cwd: repo, stdio: "pipe" }).toString().trim();
  try {
    sh("git init -q && git config user.email t@example.invalid && git config user.name test && git config commit.gpgsign false");
    const files = ["public/index.html", "public/sw.js", "docs/notes.md", "docs/adr/0001.md", "knowledge/x/README.md", "tests/unit/a.test.js",
      ".claude/agents/qa.md", ".claude/skills/s/SKILL.md", ".claude/settings.json", "scripts/build-agents.mjs", "netlify/functions/chat.mts",
      "netlify.toml", "package.json", "package-lock.json", "CLAUDE.md", "README.md"];
    for (const f of files) { mkdirSync(join(repo, dirname(f)), { recursive: true }); writeFileSync(join(repo, f), "v1\n"); }
    sh("git add -A && git commit -qm base");
    const base = sh("git rev-parse HEAD");
    const run = (file, { cached = base, command = ignore } = {}) => {
      if (file) { writeFileSync(join(repo, file), `changed ${Math.random()}\n`); sh("git commit -qam change"); }
      const env = { ...process.env, COMMIT_REF: sh("git rev-parse HEAD") };
      if (cached) env.CACHED_COMMIT_REF = cached; else delete env.CACHED_COMMIT_REF;
      const r = spawnSync("bash", ["-c", command], { cwd: repo, env });
      sh(`git reset -q --hard ${base}`);
      return r.status;
    };
    for (const f of ["docs/notes.md", "docs/adr/0001.md", "tests/unit/a.test.js", "CLAUDE.md", "README.md", ".claude/settings.json"]) expect(run(f), `${f} skips`).toBe(0);
    for (const f of ["public/index.html", "public/sw.js", ".claude/agents/qa.md", ".claude/skills/s/SKILL.md", "knowledge/x/README.md", "scripts/build-agents.mjs",
      "netlify/functions/chat.mts", "netlify.toml", "package.json", "package-lock.json"]) expect(run(f), `${f} builds`).toBe(1);
    expect(run("docs/notes.md", { cached: "" }), "first build (no cached ref) builds").toBe(1);
    expect(run("docs/notes.md", { cached: "0".repeat(40) }), "cached commit missing from clone builds").toBe(1);
    const naive = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- public netlify";
    expect(run("public/index.html", { cached: "", command: naive }), "control: the naive command skips a first build").toBe(0);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
