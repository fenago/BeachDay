// lib/secretscan shape: block a proposal whose files contain anything that looks like a credential.
// Runs at propose time AND at approve time (defence in depth before GitHub push protection).
// Findings never contain the secret itself, only a redacted preview, so they are safe to log and show.

export const RULES = [
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "github-fine-grained-pat", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { id: "github-token", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: "supabase-secret-key", re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  // Any full three-part JWT: legacy service_role / anon keys and user access tokens all start "eyJ".
  // A bare mention of the word service_role is NOT flagged: our own docs explain it.
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: "netlify-env-assignment", re: /\b(?:ANTHROPIC_API_KEY|GITHUB_TOKEN|GITHUB_READ_TOKEN)\s*[:=]\s*["']?[^\s"'`]{8,}/g },
];

// Generic rule: a long high-entropy token on a line that also mentions key/token/secret/password.
const CONTEXT = /\b(?:api[_-]?key|key|token|secret|passw(?:or)?d|bearer|auth)\b/i;
const CANDIDATE = /[A-Za-z0-9+/_=-]{40,}/g;
const ENTROPY_MIN = 4.2; // bits/char. Hex (max 4.0) such as git SHAs stays below this on purpose.
// Repo paths like knowledge/supabase-auth-engineer/examples/01-token-and-role-check score above 4.2.
// Skip lower-case, slash-separated path-like strings; base64 secrets are mixed-case.
const PATH_LIKE = /^\/?[a-z0-9._-]+(?:\/[a-z0-9._-]+)+\/?$/;

export function shannon(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

const redact = (s) => `${s.slice(0, 6)}…(${s.length} chars)`;

export function scanText(text, path = "<input>") {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { id, re } of RULES) {
      for (const m of line.matchAll(re)) findings.push({ path, line: i + 1, rule: id, preview: redact(m[0]) });
    }
    if (CONTEXT.test(line)) {
      for (const m of line.matchAll(CANDIDATE)) {
        if (!PATH_LIKE.test(m[0]) && shannon(m[0]) >= ENTROPY_MIN && !findings.some((f) => f.line === i + 1 && f.path === path)) {
          findings.push({ path, line: i + 1, rule: "high-entropy-near-keyword", preview: redact(m[0]) });
        }
      }
    }
  });
  return findings;
}

/** Scan every file (path AND content) of a proposal. ok=false blocks the proposal. */
export function scanProposal(files) {
  const findings = files.flatMap((f) => [...scanText(f.path, `${f.path} (path)`), ...scanText(f.content, f.path)]);
  return { ok: findings.length === 0, findings };
}
