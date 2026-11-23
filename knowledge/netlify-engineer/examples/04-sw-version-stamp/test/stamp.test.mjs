// Run: node --test test/stamp.test.mjs   (no dependencies; uses temp dirs and a local http server)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { stamp, pickVersion, PLACEHOLDER } from "../stamp-sw.mjs";
import { smoke } from "../smoke.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "stamp-sw.mjs");
const SW = `const VERSION = "${PLACEHOLDER}";\nconst SHELL = "beachday-shell-" + VERSION;\n// ${PLACEHOLDER} also appears in a comment, so replace-all is tested\n`;
const A = "a".repeat(40), B = "b".repeat(39) + "c";
const mk = () => { const d = mkdtempSync(join(tmpdir(), "bd-stamp-")); const f = join(d, "sw.js"); writeFileSync(f, SW); return { d, f }; };

test("stamps every placeholder from COMMIT_REF and writes version.json", () => {
  const { d, f } = mk();
  const r = stamp({ file: f, env: { COMMIT_REF: A }, git: () => null });
  const out = readFileSync(f, "utf8");
  assert.equal(r.version, "aaaaaaaaaaaa");
  assert.ok(!out.includes(PLACEHOLDER));
  assert.equal(out.split("aaaaaaaaaaaa").length - 1, 2);
  const v = JSON.parse(readFileSync(join(d, "version.json"), "utf8"));
  assert.deepEqual([v.version, v.commit, typeof v.builtAt], ["aaaaaaaaaaaa", A, "string"]);
  rmSync(d, { recursive: true });
});

test("two different commits give different sw.js bytes (the reason this step exists)", () => {
  const one = mk(), two = mk();
  stamp({ file: one.f, env: { COMMIT_REF: A } });
  stamp({ file: two.f, env: { COMMIT_REF: B } });
  assert.notEqual(readFileSync(one.f, "utf8"), readFileSync(two.f, "utf8"));
  rmSync(one.d, { recursive: true }); rmSync(two.d, { recursive: true });
});

test("fallback order: COMMIT_REF, then git HEAD, then timestamp; junk COMMIT_REF is ignored", () => {
  assert.equal(pickVersion({ COMMIT_REF: A }).source, "COMMIT_REF");
  assert.equal(pickVersion({}, () => B).source, "git");
  assert.equal(pickVersion({ COMMIT_REF: "../../etc/passwd" }, () => B).source, "git");
  const t = pickVersion({}, () => null, () => new Date("2026-11-23T12:34:56Z"));
  assert.deepEqual([t.source, t.version, t.commit], ["timestamp", "t20261123123456", null]);
});

test("fails the build when the placeholder is gone (already stamped) or the file is missing", () => {
  const { d, f } = mk();
  stamp({ file: f, env: { COMMIT_REF: A } });
  assert.throws(() => stamp({ file: f, env: { COMMIT_REF: B } }), /not found/);
  assert.throws(() => stamp({ file: join(d, "nope.js"), env: { COMMIT_REF: A } }), /cannot read/);
  rmSync(d, { recursive: true });
});

test("CLI refuses outside Netlify unless --force, and never prints env", () => {
  const { d, f } = mk();
  const SENTINEL = "SECRET-SENTINEL-EXAMPLE-9f3a";
  const env = { PATH: process.env.PATH, COMMIT_REF: A, GITHUB_TOKEN: SENTINEL, ANTHROPIC_API_KEY: SENTINEL };
  const refused = spawnSync("node", [script, "--file", f], { env });
  assert.equal(refused.status, 1);
  assert.ok(readFileSync(f, "utf8").includes(PLACEHOLDER), "file untouched when refused");
  const ok = spawnSync("node", [script, "--file", f], { env: { ...env, NETLIFY: "true" } });
  assert.equal(ok.status, 0);
  const printed = ok.stdout.toString() + ok.stderr.toString() + refused.stdout.toString() + refused.stderr.toString();
  assert.ok(!printed.includes(SENTINEL), "no env value in output");
  assert.equal(ok.stdout.toString().trim().split("\n").length, 1, "exactly one output line");
  assert.match(ok.stdout.toString(), /^stamp-sw: version=aaaaaaaaaaaa source=COMMIT_REF file=/);
  const forced = mk();
  assert.equal(spawnSync("node", [script, "--file", forced.f, "--force"], { env }).status, 0);
  rmSync(d, { recursive: true }); rmSync(forced.d, { recursive: true });
});

// ---- smoke test against a local fake deploy -------------------------------
function fakeSite({ stamped, withAuth }) {
  const version = "aaaaaaaaaaaa";
  return createServer((req, res) => {
    const send = (code, headers, body = "") => { res.writeHead(code, headers); res.end(body); };
    const csp = "default-src 'self'; form-action 'self'";
    if (req.url === "/sw.js") return send(200, { "cache-control": "no-cache" }, `const VERSION="${stamped ? version : PLACEHOLDER}";`);
    if (req.url === "/version.json") return send(200, { "content-type": "application/json" }, JSON.stringify({ version, commit: A }));
    if (req.url === "/manifest.webmanifest") return send(200, { "content-type": "application/manifest+json" }, "{}");
    if (req.url === "/") return send(200, { "content-security-policy": csp }, "<html></html>");
    if (req.url.startsWith("/api/")) return withAuth ? send(401, { "cache-control": "no-store" }) : send(200, { "cache-control": "no-store" }, "{}");
    send(404, {});
  });
}
async function runSmoke(opts) {
  const s = fakeSite(opts); await new Promise((r) => s.listen(0, r));
  try { return await smoke(`http://127.0.0.1:${s.address().port}`, A); } finally { s.close(); }
}

test("smoke: a correct deploy passes every check", async () => {
  const r = await runSmoke({ stamped: true, withAuth: true });
  assert.deepEqual(r.filter((x) => !x.ok), []);
  assert.ok(r.length >= 12);
});
test("smoke: catches an unstamped sw.js and an open /api route", async () => {
  const r = await runSmoke({ stamped: false, withAuth: false });
  const failed = r.filter((x) => !x.ok).map((x) => x.msg);
  assert.ok(failed.some((m) => /unstamped/.test(m)));
  assert.ok(failed.some((m) => /without a token -> 401/.test(m)));
});
