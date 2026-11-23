// Secret scan for proposals (agent-console-security "Proposal integrity"; security-engineer example 03).
// Runs at propose_change AND again at Approve. Findings carry a redacted preview only
// (6 chars + length), so they are safe to log, store in the audit and return to the agent.

export interface Finding { path: string; line: number; rule: string; preview: string }

export const RULES: ReadonlyArray<{ id: string; re: RegExp }> = Object.freeze([
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "github-fine-grained-pat", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { id: "github-token", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: "supabase-secret-key", re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  // Any full three-part JWT: legacy service_role / anon keys and access tokens all start "eyJ".
  // The bare word service_role is NOT flagged: our docs explain it.
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: "netlify-env-assignment", re: /\b(?:ANTHROPIC_API_KEY|GITHUB_TOKEN|GITHUB_READ_TOKEN)\s*[:=]\s*["']?[^\s"'`]{8,}/g },
]);

// Generic rule: a long high-entropy token on a line that also mentions key/token/secret/password.
const CONTEXT = /\b(?:api[_-]?key|key|token|secret|passw(?:or)?d|bearer|auth)\b/i;
const CANDIDATE = /[A-Za-z0-9+/_=-]{40,}/g;
const ENTROPY_MIN = 4.2; // bits/char; hex (max 4.0) such as git SHAs stays below on purpose
const PATH_LIKE = /^\/?[a-z0-9._-]+(?:\/[a-z0-9._-]+)+\/?$/; // lower-case slash paths are not secrets

export function shannon(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export const redact = (s: string): string => `${s.slice(0, 6)}…(${s.length} chars)`;

export function scanText(text: string, path = "<input>"): Finding[] {
  const findings: Finding[] = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    for (const { id, re } of RULES) {
      for (const m of line.matchAll(re)) findings.push({ path, line: i + 1, rule: id, preview: redact(m[0]) });
    }
    if (CONTEXT.test(line)) {
      for (const m of line.matchAll(CANDIDATE)) {
        const hitOnLine = findings.some((f) => f.line === i + 1 && f.path === path);
        if (!PATH_LIKE.test(m[0]) && shannon(m[0]) >= ENTROPY_MIN && !hitOnLine) {
          findings.push({ path, line: i + 1, rule: "high-entropy-near-keyword", preview: redact(m[0]) });
        }
      }
    }
  });
  return findings;
}

/** Scan every file (path AND content) of a proposal. ok=false blocks it. */
export function scanProposal(files: ReadonlyArray<{ path: string; content: string }>): { ok: boolean; findings: Finding[] } {
  const findings = files.flatMap((f) => [...scanText(f.path, `${f.path} (path)`), ...scanText(f.content, f.path)]);
  return { ok: findings.length === 0, findings };
}
