// Validates netlify.toml and public/_headers against the documented syntax
// and Beach Day's rules. Also proves the `ignore` command skips docs-only
// commits and builds for real changes, using a throwaway git repo.
// Run: node validate.mjs   (needs smol-toml; git and bash on PATH)
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

// ---------- netlify.toml ----------
const toml = parse(readFileSync(join(here, "netlify.toml"), "utf8"));
check(true, "netlify.toml parses as TOML");
check(toml.build?.publish === "public", "[build] publish = public");
check(typeof toml.build?.command === "string", "[build] command set");
check(/build-agents\.mjs.*stamp-sw\.mjs.*gen-config\.mjs/.test(toml.build.command), "build command runs build-agents, stamp-sw, then gen-config (ADR-0006)");
check(!/vitest|npm (run )?test/.test(toml.build.command), "build command does not run tests (agent-writable tests/** would see build secrets)");
check(toml.build?.environment?.NODE_VERSION === "22" && Object.keys(toml.build.environment).length === 1, "[build.environment] only pins NODE_VERSION");
check(!("context" in toml), "no [context.*] overrides needed today");
check(toml.functions?.directory === "netlify/functions", "[functions] directory = netlify/functions");
check(!toml.functions.directory.startsWith(toml.build.publish + "/"), "functions directory is outside publish directory");
check(toml.functions?.node_bundler === "esbuild", "[functions] node_bundler = esbuild");
check(Array.isArray(toml.functions?.included_files), "[functions] included_files is an array");
check(!("headers" in toml), "no [[headers]] in toml (single source: public/_headers)");
check(!JSON.stringify(toml).match(/rate_?limit/i), "no function rate limits in toml (not supported there)");
check(!toml.build?.environment || !Object.keys(toml.build.environment).some((k) => /TOKEN|KEY|SECRET|PASSWORD/.test(k)),
  "no secret-looking variables in [build.environment]");
const ignore = toml.build?.ignore ?? "";
for (const p of ["public", "netlify", "netlify.toml", "package.json", "package-lock.json", "scripts", ".claude/agents"]) {
  check(ignore.split(/\s+/).includes(p), `ignore command watches '${p}'`);
}

// ---------- public/_headers ----------
// Documented syntax: a path line (starts with "/"), then indented
// "Name: value" lines; lines starting with "#" are comments; names are
// case-insensitive. Wildcard * anywhere in a segment; :placeholder only at
// segment start; both not in the same segment.
const IGNORED = ["accept-ranges", "age", "allow", "alt-svc", "connection", "content-encoding", "content-length",
  "content-range", "date", "location", "server", "set-cookie", "trailer", "transfer-encoding", "upgrade"];
const rules = [];
const lines = readFileSync(join(here, "public/_headers"), "utf8").split("\n");
lines.forEach((raw, i) => {
  const line = raw.trimEnd();
  if (!line.trim() || line.trim().startsWith("#")) return;
  if (/^\S/.test(line)) {
    if (!line.startsWith("/")) return check(false, `line ${i + 1}: path must start with "/": ${line}`);
    for (const seg of line.split("/")) {
      if (seg.includes(":") && seg.includes("*")) check(false, `line ${i + 1}: wildcard and placeholder in one segment`);
      if (seg.includes(":") && !seg.startsWith(":")) check(false, `line ${i + 1}: placeholder not at segment start`);
    }
    rules.push({ path: line, headers: [] });
  } else {
    const m = line.trim().match(/^([A-Za-z0-9-]+):\s*(.+)$/);
    if (!m) return check(false, `line ${i + 1}: not a "Name: value" header line`);
    if (!rules.length) return check(false, `line ${i + 1}: header before any path`);
    rules.at(-1).headers.push({ name: m[1].toLowerCase(), value: m[2] });
  }
});
check(rules.length > 0 && rules.every((r) => r.headers.length > 0), `_headers parses: ${rules.length} paths, each with headers`);
check(rules.every((r) => r.headers.every((h) => !IGNORED.includes(h.name))), "no header Netlify ignores (Set-Cookie, Location, ...)");

const matches = (pattern, path) =>
  new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:[^/]+/g, "[^/]+") + "$").test(path);
const headersFor = (path) => rules.filter((r) => matches(r.path, path)).flatMap((r) => r.headers);

for (const path of ["/", "/index.html", "/sw.js", "/manifest.webmanifest", "/console"]) {
  const names = headersFor(path).map((h) => h.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check(dupes.length === 0, `${path}: each header set once (${names.length} headers)`);
}
const get = (path, name) => headersFor(path).find((h) => h.name === name)?.value ?? "";
const csp = get("/", "content-security-policy");
check(/connect-src[^;]*https:\/\/api\.open-meteo\.com/.test(csp) && csp.includes("https://marine-api.open-meteo.com"),
  "CSP connect-src allows both Open-Meteo hosts (browser calls them directly, ADR-0001)");
check(!/anthropic|github/.test(csp), "CSP does not let the browser call Claude or GitHub (functions do)");
// Vera's final CSP (docs/04 §10): exact Supabase host, no wildcard, same directive set.
const supaHosts = csp.match(/https?:\/\/[^\s;]*supabase\.co/g) ?? [];
check(supaHosts.length === 1 && /connect-src[^;]*https:\/\/<project-ref>\.supabase\.co/.test(csp), "CSP connect-src names exactly one Supabase host (placeholder <project-ref> until the project exists)");
check(!/\*/.test(csp), "CSP has no wildcard at all (no *.supabase.co)");
const directives = csp.split(";").map((d) => d.trim().split(/\s+/)[0]).sort().join(",");
check(directives === ["base-uri", "connect-src", "default-src", "form-action", "frame-ancestors", "img-src", "manifest-src", "object-src", "script-src", "style-src", "worker-src"].join(","), "CSP has exactly the agreed directives");
check(/script-src 'self'(;|$)/.test(csp) && /style-src 'self'(;|$)/.test(csp), "script-src and style-src are 'self' only (vendored auth bundle, no CDN)");
check(get("/", "cross-origin-opener-policy") === "same-origin", "Cross-Origin-Opener-Policy: same-origin (sign-in uses redirects, not pop-ups)");
check(/frame-ancestors 'none'/.test(csp) && !/unsafe-inline|unsafe-eval/.test(csp), "CSP: no framing, no unsafe-inline/eval");
check(get("/sw.js", "cache-control") === "no-cache", "/sw.js is Cache-Control: no-cache");
check(get("/manifest.webmanifest", "content-type") === "application/manifest+json", "manifest content type");
check(get("/console", "x-robots-tag") === "noindex", "/console is noindex");
check(get("/version.json", "cache-control") === "no-store", "/version.json is Cache-Control: no-store");
check(/form-action 'self'/.test(csp), "CSP has form-action 'self'");

// ---------- ignore command behaviour ----------
const repo = mkdtempSync(join(tmpdir(), "bd-ignore-"));
const sh = (cmd) => execSync(cmd, { cwd: repo, stdio: "pipe" }).toString().trim();
try {
  sh("git init -q && git config user.email t@example.invalid && git config user.name test");
  const files = ["public/index.html", "public/sw.js", "docs/notes.md", "knowledge/x/README.md", "tests/unit/a.test.js",
    ".claude/agents/qa.md", ".claude/skills/s/SKILL.md", "scripts/build-agents.mjs", "netlify/functions/chat.mts",
    "netlify.toml", "package.json", "package-lock.json", "CLAUDE.md"];
  for (const f of files) {
    mkdirSync(join(repo, dirname(f)), { recursive: true });
    writeFileSync(join(repo, f), "v1\n");
  }
  sh("git add -A && git commit -qm base");
  const base = sh("git rev-parse HEAD");
  const run = (file, { cached = base, command = ignore } = {}) => {
    if (file) { writeFileSync(join(repo, file), `changed ${Date.now()}\n`); sh("git commit -qam change"); }
    const head = sh("git rev-parse HEAD");
    const env = { ...process.env, COMMIT_REF: head };
    if (cached) env.CACHED_COMMIT_REF = cached; else delete env.CACHED_COMMIT_REF;
    const r = spawnSync("bash", ["-c", command], { cwd: repo, env });
    sh(`git reset -q --hard ${base}`);
    return r.status;
  };
  for (const f of ["docs/notes.md", "knowledge/x/README.md", "tests/unit/a.test.js", ".claude/skills/s/SKILL.md", "CLAUDE.md"])
    check(run(f) === 0, `ignore: ${f} only -> exit 0 (build skipped, 0 credits)`);
  for (const f of ["public/index.html", "public/sw.js", ".claude/agents/qa.md", "scripts/build-agents.mjs", "netlify/functions/chat.mts",
    "netlify.toml", "package.json", "package-lock.json"])
    check(run(f) === 1, `ignore: ${f} -> exit 1 (build runs)`);
  check(run("docs/notes.md", { cached: "" }) === 1, "ignore: CACHED_COMMIT_REF empty (first build) -> exit 1 (build runs)");
  check(run("docs/notes.md", { cached: "0".repeat(40) }) === 1, "ignore: cached commit missing from clone -> exit 1 (build runs)");
  // Negative control: the command from the old skill (no -n guard, unquoted) skips a first build.
  const naive = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- public netlify";
  check(run("public/index.html", { cached: "", command: naive }) === 0,
    "control: naive command SKIPS a first build when CACHED_COMMIT_REF is empty (why the -n guard exists)");
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
