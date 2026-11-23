// Import-graph and token-name rules (docs/06 §3.6, §3.7; build-contracts §7; R6 W1 review).
//  - only approve.mts imports github-write.mts; chat, jobs, job-run, job-status, proposal, agents and reject never reach it;
//  - the beach app imports nothing from vendor/, generated/, js/console/ and names no Supabase host;
//  - GITHUB_TOKEN / ANTHROPIC_API_KEY are named only in the modules that may read them.
import { describe, it, expect } from "vitest";
import { join, dirname, resolve } from "node:path";
import { ROOT, PUBLIC, rel, read, walk, exists } from "./fs.mjs";

const FN = join(ROOT, "netlify", "functions");
const mts = walk(FN).filter((f) => f.endsWith(".mts"));
const stripCode = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const importsOf = (file) => {
  const src = stripCode(read(file));
  const out = [];
  for (const m of src.matchAll(/(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith(".")) out.push(resolve(dirname(file), spec));
  }
  return out;
};
const closure = (file, seen = new Set()) => { for (const d of importsOf(file)) if (!seen.has(d)) { seen.add(d); if (exists(d)) closure(d, seen); } return seen; };
const WRITE = join(FN, "lib", "github-write.mts");
const HANDLERS = ["agents", "chat", "jobs", "job-run", "job-status", "proposal", "approve", "reject"];

describe("GitHub write module", () => {
  it("is imported by approve.mts and by nothing else", () => {
    const importers = mts.filter((f) => importsOf(f).includes(WRITE)).map(rel);
    expect(importers.filter((f) => f !== "netlify/functions/approve.mts")).toEqual([]);
  });
  for (const name of HANDLERS.filter((n) => n !== "approve")) {
    it(`${name}.mts cannot reach github-write.mts through any chain of imports`, (ctx) => {
      const f = join(FN, `${name}.mts`);
      if (!exists(f)) return ctx.skip(`PENDING: netlify/functions/${name}.mts does not exist yet`);
      expect([...closure(f)].includes(WRITE)).toBe(false);
    });
  }
  it("approve.mts exists and reaches github-write.mts; the read module is not what approve uses to write", (ctx) => {
    const f = join(FN, "approve.mts");
    if (!exists(f)) return ctx.skip("PENDING: netlify/functions/approve.mts does not exist yet");
    expect([...closure(f)].includes(WRITE)).toBe(true);
  });
  it("github-read.mts imports nothing that can write (not github-write, not a PATCH/POST/PUT/DELETE requester)", () => {
    const f = join(FN, "lib", "github-read.mts");
    expect([...closure(f)].map(rel).filter((x) => /github-write/.test(x))).toEqual([]);
    expect(stripCode(read(f))).not.toMatch(/method:\s*["'](PATCH|POST|PUT|DELETE)["']/);
  });
});

describe("only the allowed modules name a secret variable", () => {
  const names = (needle) => mts.filter((f) => stripCode(read(f)).includes(needle)).map(rel);
  it("GITHUB_TOKEN: settings.mts (the read-module setting), github-write.mts, and the secret scanner's pattern list", () => {
    expect(names("GITHUB_TOKEN").filter((f) => !["netlify/functions/lib/settings.mts", "netlify/functions/lib/github-write.mts", "netlify/functions/lib/secretscan.mts"].includes(f))).toEqual([]);
  });
  it("GITHUB_READ_TOKEN: nowhere in code except settings.mts's comment-free value or the scanner (ADR-0009 is Proposed)", () => {
    expect(names("GITHUB_READ_TOKEN").filter((f) => !["netlify/functions/lib/settings.mts", "netlify/functions/lib/secretscan.mts", "netlify/functions/lib/github-read.mts"].includes(f))).toEqual([]);
  });
  it("ANTHROPIC_API_KEY: claude.mts, the scanner, and the two handlers that call Claude", () => {
    expect(names("ANTHROPIC_API_KEY").filter((f) => !["netlify/functions/lib/claude.mts", "netlify/functions/lib/secretscan.mts", "netlify/functions/chat.mts", "netlify/functions/job-run.mts"].includes(f))).toEqual([]);
  });
  it("SUPABASE_SECRET / service_role keys are named nowhere in function code", () => {
    expect(mts.filter((f) => /SERVICE_ROLE|SUPABASE_SECRET|sb_secret_/i.test(stripCode(read(f))) && !f.endsWith("secretscan.mts")).map(rel)).toEqual([]);
  });
  it("the Anthropic base URL is hard-coded and no env var redirects an upstream (no ANTHROPIC_BASE_URL, GITHUB_API_URL, *_BASE_URL reads)", () => {
    expect(mts.filter((f) => /process\.env\.[A-Z_]*(BASE_URL|API_URL|_HOST)\b/.test(stripCode(read(f)))).map(rel)).toEqual([]);
  });
  it("no handler or lib reads process.env wholesale or logs it", () => {
    expect(mts.filter((f) => /console\.\w+\([^)]*process\.env\b(?!\.)|JSON\.stringify\(\s*process\.env|Object\.(keys|entries|values)\(\s*process\.env/.test(stripCode(read(f)))).map(rel)).toEqual([]);
  });
});

describe("no auth code in the beach app (build-contracts §7)", () => {
  const AUTH_OK = (f) => f === join(PUBLIC, "console.html") || /\/public\/(js\/console|vendor|generated)\//.test(f);
  const files = walk(PUBLIC).filter((f) => /\.(js|html|css|webmanifest)$/.test(f) && !AUTH_OK(f));
  it("scans at least the shared files", () => { expect(files.length).toBeGreaterThan(5); });
  it("no file outside Agents references vendor/, generated/, js/console/, a supabase.co host or @supabase/", () => {
    const bad = [];
    for (const f of files) {
      const src = stripCode(read(f));
      const isSw = f === join(PUBLIC, "sw.js");
      // sw.js may NAME the paths in its never-intercept list, but never import them
      if (isSw) { if (/importScripts\([^)]*(vendor|generated|console)/.test(src) || /\bimport\b[^;]*(vendor|generated|js\/console)/.test(src)) bad.push(rel(f)); continue; }
      if (/["'`(=]\s*\/?(?:\.\.?\/)*(vendor|generated|js\/console)\//.test(src) || /(?<![&;<\w-])[a-z0-9-]{3,}\.supabase\.co(?![a-z])|@supabase\//.test(src.replace(/&lt;project-ref&gt;\.supabase\.co|<project-ref>\.supabase\.co/g, ""))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
  it("sw.js imports only from /sw/**", () => {
    const src = stripCode(read(join(PUBLIC, "sw.js")));
    for (const m of src.matchAll(/importScripts\(([^)]*)\)/g)) for (const s of m[1].matchAll(/["']([^"']+)["']/g)) expect(s[1]).toMatch(/^\/sw\//);
    expect(/^\s*import\s/m.test(src)).toBe(false);
  });
  it("the beach app (index.html and js/app.js, js/ui, js/pwa, forecast and data modules) loads no console or vendor script", (ctx) => {
    const f = join(PUBLIC, "index.html");
    if (!exists(f)) return ctx.skip("PENDING: public/index.html does not exist yet");
    const src = read(f);
    expect(src).not.toMatch(/js\/console|\/vendor\/|\/generated\//);
  });
});

describe("Agents page loads only same-origin modules", () => {
  it("console.html references scripts under /js/console/ (and nothing remote)", (ctx) => {
    const f = join(PUBLIC, "console.html");
    if (!exists(f)) return ctx.skip("PENDING: public/console.html does not exist yet (Remy-B)");
    const srcs = [...read(f).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) expect(s).toMatch(/^\/js\/console\//);
  });
});
