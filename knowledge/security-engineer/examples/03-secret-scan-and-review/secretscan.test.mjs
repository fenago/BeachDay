// node --test secretscan.test.mjs
// Positive fixtures are BUILT AT RUNTIME (string concatenation + a seeded PRNG) so this file never
// contains a literal that GitHub push protection or other scanners would flag.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scanText, scanProposal, shannon } from "./secretscan.mjs";

function rand(seed, n, alphabet) { // deterministic xorshift, NOT crypto: fixtures only
  let x = seed >>> 0 || 1; let out = "";
  for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; out += alphabet[(x >>> 0) % alphabet.length]; }
  return out;
}
const AZ09 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const POSITIVES = {
  "anthropic-key": "const k = '" + "sk-" + "ant-" + "api03-" + rand(1, 40, AZ09) + "';",
  "github-fine-grained-pat": "token: " + "github" + "_pat_" + rand(2, 60, AZ09 + "_"),
  "github-token": "GH=" + "gh" + "p_" + rand(3, 36, AZ09),
  "private-key": "-----BEGIN " + "RSA PRIVATE" + " KEY-----",
  "aws-access-key-id": "aws_id = " + "AK" + "IA" + rand(4, 16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"),
  "slack-token": "SLACK=" + "xo" + "xb-" + rand(5, 24, AZ09),
  "netlify-env-assignment": "ANTHROPIC" + "_API_KEY=" + rand(6, 24, AZ09),
  "high-entropy-near-keyword": "const secret = \"" + rand(7, 48, AZ09 + "+/") + "\";",
};

const NEGATIVES = {
  "placeholder anthropic": "Use sk-ant-EXAMPLE in docs.",
  "placeholder github": "GITHUB_TOKEN placeholder: github_pat_EXAMPLE",
  "env var name only": "Read process.env.ANTHROPIC_API_KEY inside the function.",
  "git sha near 'token'": "token rotated in commit 0df6f303ea573bbf1946c40607039f75e97d170b",
  "sha-256 hex near 'key'": "content key " + createHash("sha256").update("beach").digest("hex"),
  "long low-entropy run": "secret: " + "x".repeat(60),
  "normal code": "export const config = { path: \"/api/chat\" };",
  "base64 image, no keyword": "data:image/png;base64," + rand(8, 120, AZ09 + "+/"),
  "public key header": "-----BEGIN PUBLIC KEY-----",
};

test("every rule fires on its positive fixture, preview is redacted", () => {
  for (const [rule, text] of Object.entries(POSITIVES)) {
    const f = scanText(text, "fixture");
    assert.ok(f.some((x) => x.rule === rule), `${rule} should fire on fixture`);
    for (const x of f) assert.match(x.preview, /^.{1,6}…\(\d+ chars\)$/, "preview shows at most 6 chars");
    console.log(`fires  ${rule.padEnd(26)} -> ${f.map((x) => x.preview).join(", ")}`);
  }
});

test("negatives (placeholders, hashes, names) do not fire", () => {
  for (const [name, text] of Object.entries(NEGATIVES)) {
    const f = scanText(text, "fixture");
    console.log(`quiet  ${name.padEnd(26)} -> ${f.length} findings${name.includes("sha") ? ` (entropy ${shannon(text.match(/[0-9a-f]{40,}/)[0]).toFixed(2)})` : ""}`);
    assert.equal(f.length, 0, `${name}: ${JSON.stringify(f)}`);
  }
});

test("findings never contain the full secret", () => {
  const text = POSITIVES["anthropic-key"];
  const secret = text.match(/sk-ant-[^']+/)[0];
  const [f] = scanText(text);
  assert.ok(!JSON.stringify(f).includes(secret));
  assert.match(f.preview, /^sk-ant…\(\d+ chars\)$/);
});

test("scanProposal blocks on any file and reports path + line", () => {
  const ok = scanProposal([{ path: "public/index.html", content: "<p>Use sk-ant-EXAMPLE</p>" }]);
  assert.equal(ok.ok, true);
  const bad = scanProposal([
    { path: "public/index.html", content: "<p>fine</p>" },
    { path: "public/app.js", content: "// config\n" + POSITIVES["github-fine-grained-pat"] + "\n" },
  ]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.findings.map((f) => [f.path, f.line, f.rule]), [["public/app.js", 2, "github-fine-grained-pat"]]);
});
