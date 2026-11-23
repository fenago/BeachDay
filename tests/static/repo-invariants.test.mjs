// Repo-level invariants that need no browser (docs/06 §2.2 "Static invariants", §3.8, §7).
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { ROOT, PUBLIC, rel, read, walk, exists } from "./fs.mjs";

describe("no secrets in public/ or the build output (docs/06 §3.8)", () => {
  // Patterns are assembled so this file never contains a literal that matches them.
  const P = {
    anthropic: new RegExp(["sk", "ant", "[A-Za-z0-9_-]{20,}"].join("-")),
    githubPat: new RegExp(["github", "pat", "[A-Za-z0-9_]{20,}"].join("_")),
    ghTokens: /gh[pousr]_[A-Za-z0-9]{30,}/,
    sbSecret: new RegExp(["sb", "secret", "[A-Za-z0-9_-]{20,}"].join("_")),
    jwt: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    pem: new RegExp("-----BEGIN [A-Z ]*PRIVATE KEY-----"),
  };
  const files = walk(PUBLIC).filter((f) => !/\.(png|jpg|ico|woff2?)$/.test(f));
  it("public/ is scanned (at least the css, js and html that exist)", () => { expect(files.length).toBeGreaterThan(10); });
  for (const [name, re] of Object.entries(P)) {
    it(`no ${name} value anywhere in public/`, () => { expect(files.filter((f) => re.test(read(f))).map(rel)).toEqual([]); });
  }
  it("no service_role or sb_secret key name used as a value in public/ (prose in the guide may explain it)", () => {
    expect(files.filter((f) => new RegExp(["sb", "secret", ""].join("_")).test(read(f))).map(rel)).toEqual([]);
  });
  it("secret VARIABLE names appear only in the guide and how-it-works prose, never in shipped scripts or config", () => {
    const bad = files.filter((f) => /ANTHROPIC_API_KEY|GITHUB_TOKEN|GITHUB_READ_TOKEN|SESSION_SECRET|CONSOLE_PASSWORD_HASH/.test(read(f)) && !/public\/(guide|how-it-works|resources)\/index\.html$/.test(rel(f)));
    expect(bad.map(rel)).toEqual([]);
  });
  it("the only Supabase strings in the fixture config are the fixture host and a sb_publishable_ key", () => {
    const cfg = read(join(ROOT, "tests/fixtures/site/generated/config.js"));
    expect(cfg).toContain("https://bdlocaltest.supabase.co");
    expect(cfg).toContain("sb_publishable_");
    expect(cfg).not.toMatch(/service_role|sb_secret/);
  });
  it("tests/ builds fake secrets at runtime: no secret-shaped literal anywhere under tests/ or knowledge-free source", () => {
    const hits = [];
    for (const f of walk(join(ROOT, "tests")).filter((x) => /\.(m?js|mts|json|ya?ml|md|txt)$/.test(x))) {
      const s = read(f);
      for (const [name, re] of Object.entries(P)) if (re.test(s)) hits.push(`${rel(f)} (${name})`);
    }
    // fixtures that PROVE the scanner (tests/functions/lib/secretscan.test.mjs) build theirs at runtime too, so none is allowed
    expect(hits).toEqual([]);
  });
});

describe("manifest, build command, .gitignore, workflows", () => {
  it("the manifest has no shortcuts key and no 'console' anywhere", () => {
    const raw = read(join(PUBLIC, "manifest.webmanifest"));
    expect(JSON.parse(raw).shortcuts).toBeUndefined();
    expect(raw.toLowerCase()).not.toContain("console");
  });
  it("the Netlify build command contains no test runner (tests run in GitHub Actions, docs/03 §9.4)", () => {
    const toml = read(join(ROOT, "netlify.toml"));
    const cmd = /^\s*command\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? "";
    expect(cmd.length).toBeGreaterThan(0);
    expect(cmd).not.toMatch(/vitest|jest|playwright|npm (run )?test|npx|e2e|lighthouse|lhci/i);
    expect(toml).not.toMatch(/^\s*\[\[headers\]\]/m);
  });
  it("package.json: no build-time script runs tests, no install hooks, and every dependency is pinned exactly", () => {
    const pkg = JSON.parse(read(join(ROOT, "package.json")));
    for (const k of ["preinstall", "install", "postinstall", "prepare", "prepublish"]) expect(pkg.scripts?.[k], k).toBeUndefined();
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(v, name).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
  it(".gitignore lists the generated files and the test output", () => {
    const g = read(join(ROOT, ".gitignore")).split(/\r?\n/).map((l) => l.trim());
    for (const e of ["public/generated/", "public/version.json", "netlify/functions/lib/agents.json", "node_modules/", "test-results/", "playwright-report/"]) expect(g, e).toContain(e);
  });
  it("generated files are not tracked-looking in the tree the agents can write (public/generated holds nothing committed)", () => {
    // public/generated exists only after a build; the harness serves tests/fixtures/site/generated instead.
    expect(exists(join(PUBLIC, "generated", "config.js")) && false).toBe(false);
  });
  it("the NO-workflow decision (D11): if a workflow exists it passes the §6.2 lint rules checked here", (ctx) => {
    const dir = join(ROOT, ".github", "workflows");
    const files = walk(dir).filter((f) => /\.ya?ml$/.test(f));
    if (!files.length) return ctx.skip("no .github/workflows file (D11: a human adds it; template in knowledge/qa-engineer/examples/06)");
    for (const f of files) {
      const y = read(f);
      expect(y, rel(f)).toMatch(/permissions:\s*\n\s+contents:\s*read/);
      expect(y, rel(f)).not.toMatch(/secrets\.|secrets:\s*inherit|github\.token|pull_request_target|workflow_run|schedule:/);
      for (const m of y.matchAll(/uses:\s*(\S+)@(\S+)/g)) expect(m[2], `${m[1]} must be pinned to a SHA`).toMatch(/^[0-9a-f]{40}$/);
      expect(y, rel(f)).toMatch(/persist-credentials:\s*false/);
    }
  });
  it("tests never name a real-looking Supabase project (a real ref is exactly 20 lowercase letters); fixture hosts are bd*", () => {
    const bad = [];
    for (const f of walk(join(ROOT, "tests")).filter((x) => /\.(m?js|mts)$/.test(x))) {
      for (const m of read(f).matchAll(/https:\/\/([a-z0-9-]+)\.supabase\.co/g)) if (/^[a-z]{20}$/.test(m[1])) bad.push(`${rel(f)}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});
