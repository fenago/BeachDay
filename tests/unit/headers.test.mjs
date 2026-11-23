// public/_headers and netlify.toml against docs/03 §3 and docs/04 §10.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const IGNORED = ["accept-ranges", "age", "allow", "alt-svc", "connection", "content-encoding", "content-length", "content-range", "date", "location", "server", "set-cookie", "trailer", "transfer-encoding", "upgrade"];

const rules = [];
read("public/_headers").split("\n").forEach((raw, i) => {
  const line = raw.trimEnd();
  if (!line.trim() || line.trim().startsWith("#")) return;
  if (/^\S/.test(line)) { expect(line.startsWith("/"), `line ${i + 1} path`).toBe(true); rules.push({ path: line, headers: [] }); return; }
  const m = line.trim().match(/^([A-Za-z0-9-]+):\s*(.+)$/);
  expect(m, `line ${i + 1} is Name: value`).toBeTruthy();
  rules.at(-1).headers.push({ name: m[1].toLowerCase(), value: m[2] });
});
const matches = (pattern, path) => new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:[^/]+/g, "[^/]+") + "$").test(path);
const headersFor = (path) => rules.filter((r) => matches(r.path, path)).flatMap((r) => r.headers);
const get = (path, name) => headersFor(path).find((h) => h.name === name)?.value ?? "";
const HOST = /https:\/\/[^\s;]*supabase\.co/;

test("parses: every path has headers, none that Netlify ignores", () => {
  expect(rules.length).toBeGreaterThan(0);
  for (const r of rules) { expect(r.headers.length, r.path).toBeGreaterThan(0); for (const h of r.headers) expect(IGNORED, h.name).not.toContain(h.name); }
});

test("CSP equals docs/04 §10 except the Supabase host; exact host, no wildcard", () => {
  const doc = read("docs/04-agent-console.md").split("\n").find((l) => l.startsWith("Content-Security-Policy: "));
  expect(doc).toBeTruthy();
  const ours = get("/", "content-security-policy");
  expect(ours.replace(HOST, "HOST")).toBe(doc.slice("Content-Security-Policy: ".length).replace(HOST, "HOST"));
  expect(ours).toContain("https://<project-ref>.supabase.co"); // placeholder kept until Dr. Lee's project exists; gen-config fails the build until it matches SUPABASE_URL
  expect(ours.match(/supabase\.co/g)).toHaveLength(1);
  expect(ours).not.toMatch(/\*|unsafe-inline|unsafe-eval|anthropic|github/);
  expect(ours).toMatch(/script-src 'self'(;|$)/);
  expect(ours).toMatch(/style-src 'self'(;|$)/);
  expect(ours).toContain("form-action 'self'");
  expect(ours).toContain("frame-ancestors 'none'");
});

test("no header is set twice for one path (no double CSP)", () => {
  for (const path of ["/", "/index.html", "/sw.js", "/manifest.webmanifest", "/version.json", "/console", "/console.html", "/js/app.js", "/generated/config.js", "/guide/"]) {
    const names = headersFor(path).map((h) => h.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i), path).toEqual([]);
  }
});

test("security headers and the special paths", () => {
  expect(get("/", "x-content-type-options")).toBe("nosniff");
  expect(get("/", "referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(get("/", "permissions-policy")).toBe("geolocation=(self), camera=(), microphone=()");
  expect(get("/", "strict-transport-security")).toMatch(/^max-age=\d+/);
  expect(get("/", "cross-origin-opener-policy")).toBe("same-origin");
  expect(get("/sw.js", "cache-control")).toBe("no-cache");
  expect(get("/manifest.webmanifest", "content-type")).toBe("application/manifest+json");
  expect(get("/version.json", "cache-control")).toBe("no-store");
  for (const p of ["/console", "/console.html"]) { expect(get(p, "x-robots-tag")).toBe("noindex"); expect(get(p, "cache-control")).toBe("no-store"); }
  expect(get("/index.html", "cache-control")).toBe("");
});

test("netlify.toml: no [[headers]], no rate limits, no secrets, build runs no tests, three build steps in order", () => {
  const text = read("netlify.toml");
  const toml = parse(text);
  expect("headers" in toml).toBe(false);
  expect(text).not.toMatch(/^\s*\[\[headers\]\]/m);
  expect(JSON.stringify(toml)).not.toMatch(/rate_?limit/i);
  expect(toml.build.publish).toBe("public");
  expect(toml.build.command).toMatch(/^node scripts\/build-agents\.mjs && node scripts\/stamp-sw\.mjs && node scripts\/gen-config\.mjs$/);
  expect(toml.build.command).not.toMatch(/vitest|npm (run )?test|playwright/);
  expect(toml.build.environment).toEqual({ NODE_VERSION: "22" });
  expect("context" in toml).toBe(false);
  expect(toml.functions).toEqual({ directory: "netlify/functions", node_bundler: "esbuild", included_files: ["netlify/functions/lib/agents.json"] });
  expect(toml.build.ignore).toContain('[ -n "$CACHED_COMMIT_REF" ]');
  expect(toml.build.ignore).toMatch(/\|\| exit 1$/);
});

test(".gitignore lists the build output", () => {
  const g = read(".gitignore").split("\n");
  for (const p of ["public/generated/", "public/version.json", "netlify/functions/lib/agents.json", "node_modules/"]) expect(g).toContain(p);
});
