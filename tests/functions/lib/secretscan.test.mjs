// Positive fixtures are BUILT AT RUNTIME so this file never holds a scannable literal (secure-by-design).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { scanText, scanProposal } from "../../../netlify/functions/lib/secretscan.mts";

function rand(seed, n, alphabet) { let x = seed >>> 0 || 1; let o = ""; for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o += alphabet[(x >>> 0) % alphabet.length]; } return o; }
const AZ09 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const POSITIVES = {
  "anthropic-key": "const k = '" + ["sk", "ant", "api03"].join("-") + "-" + rand(1, 40, AZ09) + "';",
  "github-fine-grained-pat": "token: " + ["github", "pat", rand(2, 60, AZ09 + "_")].join("_"),
  "github-token": "GH=" + "gh" + "p_" + rand(3, 36, AZ09),
  "private-key": "-----BEGIN " + "RSA PRIVATE" + " KEY-----",
  "supabase-secret-key": "key: " + ["sb", "secret", rand(9, 32, AZ09)].join("_"),
  "jwt": "apikey = " + ["ey" + "J" + rand(10, 30, AZ09), "ey" + "J" + rand(11, 60, AZ09), rand(12, 43, AZ09 + "_-")].join("."),
  "netlify-env-assignment": "GITHUB" + "_READ_TOKEN=" + rand(6, 24, AZ09),
  "high-entropy-near-keyword": "const secret = \"" + rand(7, 48, AZ09 + "+/") + "\";",
};
const NEGATIVES = {
  "placeholder anthropic": "Use sk-ant-EXAMPLE in docs.",
  "env var name only": "Read process.env.ANTHROPIC_API_KEY inside the function.",
  "git sha near token": "token rotated in commit 0df6f303ea573bbf1946c40607039f75e97d170b",
  "sha-256 near key": "content key " + createHash("sha256").update("beach").digest("hex"),
  "service_role in prose": "Never use the service_role key; it bypasses RLS.",
  "publishable placeholder": "SUPABASE_PUBLISHABLE_KEY=sb_publishable_EXAMPLE",
  "repo path near token": "See knowledge/supabase-auth-engineer/examples/01-token-and-role-check for the token check.",
  "truncated JWT in prose": "Legacy keys look like eyJhbGciOi... and are not used.",
};

describe("secretscan", () => {
  it.each(Object.entries(POSITIVES))("fires: %s", (rule, text) => {
    const f = scanText(text, "fx");
    expect(f.some((x) => x.rule === rule)).toBe(true);
    for (const x of f) expect(x.preview).toMatch(/^.{1,6}…\(\d+ chars\)$/);
  });
  it.each(Object.entries(NEGATIVES))("quiet: %s", (_n, text) => {
    expect(scanText(text, "fx")).toEqual([]);
  });
  it("never returns the secret; scanProposal reports path+line and scans paths too", () => {
    const secret = POSITIVES["anthropic-key"].match(/'([^']+)'/)[1];
    expect(JSON.stringify(scanText(POSITIVES["anthropic-key"]))).not.toContain(secret);
    const bad = scanProposal([{ path: "public/index.html", content: "<p>fine</p>" }, { path: "public/app.js", content: "// c\n" + POSITIVES["github-token"] + "\n" }]);
    expect(bad.ok).toBe(false);
    expect(bad.findings.map((f) => [f.path, f.line, f.rule])).toEqual([["public/app.js", 2, "github-token"]]);
    expect(scanProposal([{ path: "docs/a.md", content: "Use sk-ant-EXAMPLE" }]).ok).toBe(true);
  });
});
