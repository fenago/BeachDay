// Run: npx vitest run tests/unit/scripts
import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { genConfig, checkCspHost } from "../../../scripts/gen-config.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "gen-config.mjs");
const A = "a".repeat(40);
const URL_OK = "https://abcdefghijklmnop.supabase.co";
// Fixtures are BUILT AT RUNTIME (Vera): no committed literal looks like a secret, so scanners and
// push protection never see one. Each run gets a fresh random tail.
const tail = () => randomBytes(12).toString("hex");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const KEY_OK = ["sb", "publishable", tail()].join("_");                       // shaped like the real thing
const SECRET = ["sb", "secret", tail()].join("_");                            // rejected: a secret key
const LEGACY = [b64({ alg: "HS256", typ: "JWT" }), b64({ role: "service" + "_role" }), tail()].join("."); // rejected: legacy JWT key
const OTHER = ["sk", "ant", tail()].join("-");                                // some other variable's value
const HEADERS_OK = `/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.open-meteo.com ${URL_OK}; form-action 'self'\n`;
const run = (env, extra = []) => {
  const out = mkdtempSync(join(tmpdir(), "bd-cfg-"));
  const r = spawnSync(process.execPath, [script, "--out", out, "--no-headers-check", ...extra], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  return { out, r, file: join(out, "config.js") };
};

test("writes config.js from the three named variables only", () => {
  const out = mkdtempSync(join(tmpdir(), "bd-cfg-"));
  const r = genConfig({ outDir: out, env: { SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK, COMMIT_REF: A, ANTHROPIC_API_KEY: OTHER }, git: () => null });
  const text = readFileSync(r.file, "utf8");
  assert.match(text, /export const SUPABASE_URL = "https:\/\/abcdefghijklmnop\.supabase\.co";/);
  assert.ok(text.includes(`export const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(KEY_OK)};`));
  assert.match(text, /export const BUILD_VERSION = "aaaaaaaaaaaa";/);
  assert.ok(!text.includes(OTHER), "no other variable leaks into the file");
  rmSync(out, { recursive: true });
});

test("rejects a secret key, a legacy JWT key, a missing key; the log never shows the value", () => {
  for (const bad of [SECRET, LEGACY, "", undefined]) {
    const { r, file, out } = run({ SUPABASE_URL: URL_OK, ...(bad === undefined ? {} : { SUPABASE_PUBLISHABLE_KEY: bad }), NETLIFY: "true", COMMIT_REF: A });
    assert.equal(r.status, 1, `key ${JSON.stringify(bad)?.slice(0, 20)} must fail the build`);
    assert.ok(!existsSync(file), "no config.js is written on failure");
    assert.ok(bad === undefined || bad === "" || !(r.stdout + r.stderr).includes(bad.slice(-12)), "the rejected value is never echoed");
    rmSync(out, { recursive: true });
  }
});

test("rejects a bad URL (http, path, credentials, missing)", () => {
  for (const bad of ["http://abcdefghijklmnop.supabase.co", `${URL_OK}/rest/v1`, "https://user:pw@abcdefghijklmnop.supabase.co", "not a url", ""]) {
    const { r, out } = run({ SUPABASE_URL: bad, SUPABASE_PUBLISHABLE_KEY: KEY_OK, NETLIFY: "true", COMMIT_REF: A });
    assert.equal(r.status, 1, `url ${bad} must fail the build`);
    assert.ok(!(r.stdout + r.stderr).includes("pw@"), "credentials are never echoed");
    rmSync(out, { recursive: true });
  }
});

test("CLI: succeeds on Netlify with valid values, prints one line, refuses outside Netlify without --force", () => {
  const ok = run({ SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK, NETLIFY: "true", COMMIT_REF: A });
  assert.equal(ok.r.status, 0);
  assert.equal(ok.r.stdout.trim().split("\n").length, 1);
  assert.ok(!ok.r.stdout.includes("sb_publishable_") && !ok.r.stdout.includes(URL_OK), "stdout shows no value");
  assert.ok(existsSync(ok.file));
  const no = run({ SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK });
  assert.equal(no.r.status, 1);
  assert.ok(!existsSync(no.file));
  const forced = run({ SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK, COMMIT_REF: A }, ["--force"]);
  assert.equal(forced.r.status, 0);
  [ok, no, forced].forEach((x) => rmSync(x.out, { recursive: true }));
});

test("CSP host check: the build fails unless public/_headers names exactly the SUPABASE_URL origin (no wildcard, no other host)", () => {
  assert.doesNotThrow(() => checkCspHost(HEADERS_OK, URL_OK));
  assert.throws(() => checkCspHost(HEADERS_OK.replace(URL_OK, "https://zzzzzzzzzzzzzzzz.supabase.co"), URL_OK), /does not list/);
  assert.throws(() => checkCspHost(HEADERS_OK.replace(URL_OK, "https://<project-ref>.supabase.co"), URL_OK), /does not list/);
  assert.throws(() => checkCspHost(HEADERS_OK.replace(URL_OK, "https://*.supabase.co"), URL_OK), /does not list/);
  assert.throws(() => checkCspHost(HEADERS_OK.replace("form-action", `https://zzzzzzzzzzzzzzzz.supabase.co; form-action`), URL_OK), /other than/);
  assert.throws(() => checkCspHost("/*\n  X-Content-Type-Options: nosniff\n", URL_OK), /no Content-Security-Policy/);
  const out = mkdtempSync(join(tmpdir(), "bd-cfg-"));
  const hf = join(out, "_headers");
  writeFileSync(hf, HEADERS_OK);
  assert.ok(genConfig({ outDir: join(out, "g"), env: { SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK, COMMIT_REF: A }, git: () => null, headersFile: hf }).file);
  writeFileSync(hf, HEADERS_OK.replace(URL_OK, "https://zzzzzzzzzzzzzzzz.supabase.co"));
  assert.throws(() => genConfig({ outDir: join(out, "h"), env: { SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK, COMMIT_REF: A }, git: () => null, headersFile: hf }));
  assert.ok(!existsSync(join(out, "h", "config.js")), "nothing written on a mismatch");
  // CLI default: the check is ON and public/_headers is read relative to the working directory
  const cli = spawnSync(process.execPath, [script, "--out", join(out, "c")], { cwd: out, env: { PATH: process.env.PATH, SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK, NETLIFY: "true", COMMIT_REF: A }, encoding: "utf8" });
  assert.equal(cli.status, 1, "no public/_headers in cwd -> the build fails closed");
  rmSync(out, { recursive: true });
});

test("the REAL public/_headers passes the CSP host check for a matching origin and fails for a wrong one", () => {
  const real = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "_headers"), "utf8");
  const filled = real.replace("https://<project-ref>.supabase.co", URL_OK);
  assert.doesNotThrow(() => checkCspHost(filled, URL_OK));
  assert.throws(() => checkCspHost(real, URL_OK), /does not list/, "the committed placeholder fails the build until a human fills it in");
});
