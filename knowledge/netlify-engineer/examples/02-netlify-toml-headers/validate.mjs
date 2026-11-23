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
check(toml.functions?.directory === "netlify/functions", "[functions] directory = netlify/functions");
check(!toml.functions.directory.startsWith(toml.build.publish + "/"), "functions directory is outside publish directory");
check(toml.functions?.node_bundler === "esbuild", "[functions] node_bundler = esbuild");
check(Array.isArray(toml.functions?.included_files), "[functions] included_files is an array");
check(!("headers" in toml), "no [[headers]] in toml (single source: public/_headers)");
check(!JSON.stringify(toml).match(/rate_?limit/i), "no function rate limits in toml (not supported there)");
check(!toml.build?.environment || !Object.keys(toml.build.environment).some((k) => /TOKEN|KEY|SECRET|PASSWORD/.test(k)),
  "no secret-looking variables in [build.environment]");
const ignore = toml.build?.ignore ?? "";
for (const p of ["public", "netlify", "netlify.toml", "package.json", "scripts", ".claude/agents"]) {
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
check(/frame-ancestors 'none'/.test(csp) && !/unsafe-inline|unsafe-eval/.test(csp), "CSP: no framing, no unsafe-inline/eval");
check(get("/sw.js", "cache-control") === "no-cache", "/sw.js is Cache-Control: no-cache");
check(get("/manifest.webmanifest", "content-type") === "application/manifest+json", "manifest content type");
check(get("/console", "x-robots-tag") === "noindex", "/console is noindex");

// ---------- ignore command behaviour ----------
const repo = mkdtempSync(join(tmpdir(), "bd-ignore-"));
const sh = (cmd) => execSync(cmd, { cwd: repo, stdio: "pipe" }).toString().trim();
try {
  sh("git init -q && git config user.email t@example.invalid && git config user.name test");
  for (const f of ["public/index.html", "docs/notes.md", ".claude/agents/qa.md"]) {
    mkdirSync(join(repo, dirname(f)), { recursive: true });
    writeFileSync(join(repo, f), "v1\n");
  }
  sh("git add -A && git commit -qm base");
  const base = sh("git rev-parse HEAD");
  const runIgnore = (file) => {
    writeFileSync(join(repo, file), `changed ${Date.now()}\n`);
    sh(`git commit -qam change`);
    const head = sh("git rev-parse HEAD");
    const r = spawnSync("bash", ["-c", ignore], { cwd: repo, env: { ...process.env, CACHED_COMMIT_REF: base, COMMIT_REF: head } });
    sh(`git reset -q --hard ${base}`);
    return r.status;
  };
  check(runIgnore("docs/notes.md") === 0, "ignore: docs-only commit -> exit 0 (build skipped, no credits)");
  check(runIgnore("public/index.html") === 1, "ignore: change under public/ -> exit 1 (build runs)");
  check(runIgnore(".claude/agents/qa.md") === 1, "ignore: agent file change -> exit 1 (agents.json must rebuild)");
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
