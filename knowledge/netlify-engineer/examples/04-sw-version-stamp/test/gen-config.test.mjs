// Run: node --test test/gen-config.test.mjs   (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { genConfig } from "../gen-config.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "gen-config.mjs");
const A = "a".repeat(40);
const URL_OK = "https://abcdefghijklmnop.supabase.co";
const KEY_OK = "sb_publishable_EXAMPLEexample0123456789"; // fake, shaped like the real thing
const SECRET = "sb_secret_EXAMPLEexample0123456789";      // fake
const LEGACY = "eyJhbGciOiJIUzI1NiJ9.EXAMPLE.EXAMPLE";      // fake JWT-looking legacy key
const run = (env, extra = []) => {
  const out = mkdtempSync(join(tmpdir(), "bd-cfg-"));
  const r = spawnSync(process.execPath, [script, "--out", out, ...extra], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  return { out, r, file: join(out, "config.js") };
};

test("writes config.js from the three named variables only", () => {
  const out = mkdtempSync(join(tmpdir(), "bd-cfg-"));
  const r = genConfig({ outDir: out, env: { SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK, COMMIT_REF: A, ANTHROPIC_API_KEY: "sk-ant-EXAMPLE" }, git: () => null });
  const text = readFileSync(r.file, "utf8");
  assert.match(text, /export const SUPABASE_URL = "https:\/\/abcdefghijklmnop\.supabase\.co";/);
  assert.match(text, /export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_EXAMPLEexample0123456789";/);
  assert.match(text, /export const BUILD_VERSION = "aaaaaaaaaaaa";/);
  assert.ok(!text.includes("sk-ant"), "no other variable leaks into the file");
  rmSync(out, { recursive: true });
});

test("rejects a secret key, a legacy JWT key, a missing key; the log never shows the value", () => {
  for (const bad of [SECRET, LEGACY, "", undefined]) {
    const { r, file, out } = run({ SUPABASE_URL: URL_OK, ...(bad === undefined ? {} : { SUPABASE_PUBLISHABLE_KEY: bad }), NETLIFY: "true", COMMIT_REF: A });
    assert.equal(r.status, 1, `key ${JSON.stringify(bad)?.slice(0, 20)} must fail the build`);
    assert.ok(!existsSync(file), "no config.js is written on failure");
    assert.ok(!(r.stdout + r.stderr).includes("EXAMPLE"), "the rejected value is never echoed");
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
