---
name: agent-console-security
description: Security controls specific to the Beach Day Agent Console — password gate and sessions, CSRF, path allow-list and deny-list, secret scanning of proposals, approval-only commits, prompt-injection defenses, rate and cost limits, audit log, and the tests that prove them. Use when building, reviewing or testing the Console.
---
# Agent Console security (details: docs/04 §3–6, §9–12)

## Password gate
- Netlify's site password needs the Pro plan and doesn't cover functions, so the gate is ours.
- **Storage:** `CONSOLE_PASSWORD_HASH` holds a scrypt hash (`scrypt$N$r$p$salt$hash`). Compare with `crypto.timingSafeEqual`.
- **Session cookie:** `bd_session` = base64url(`{sid, exp}`) + `.` + HMAC-SHA256(`SESSION_SECRET`).
  - Flags: `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=43200`.
- **Login throttling:** 5 failures per IP per 15 min (Blobs counter), plus Netlify `rateLimit` on `/api/login`.
- **Re-authentication:** Approve requires the password again if the last auth was more than 10 min ago.
- **Accessibility (WCAG 3.3.8):** allow paste and password managers.

## CSRF & framing
- State-changing requests need the header `X-BD-CSRF: <token>`. The token comes from `/api/login`, is kept in memory and is HMAC-tied to `sid`.
- Also check that `Origin` matches the site URL.
- `frame-ancestors 'none'`.

## Path allow-list
Lives in `netlify/functions/lib/allowlist.mts`. Enforce it when the proposal is created **and** again at approve.
- **Allow:** `public/**/*.{html,css,js,json,webmanifest,svg,txt}`, `public/_headers`, `tests/**`, `docs/**`, `.claude/agents/*.md`, `.claude/skills/**/*.md`.
- **Deny (deny wins):** `netlify/**`, `netlify.toml`, `.github/**`, `package.json`, `package-lock.json`, `scripts/**`, `**/.env*`, `**/*.pem`, `**/*.key`.
- **Normalize paths first.** Reject `..`, leading `/`, `\`, `//`, NUL and control characters. Reject case variants of denied paths (`Netlify.toml`).
- **Limits:** at most 20 files, 200 KB per file, UTF-8 text only. Mode is always `100644`.

## Proposal integrity
- At creation, compute `contentHash` = SHA-256 of a canonical JSON of the files. Show its first 8 characters in the UI and send it with Approve.
- Approve recomputes the hash and rejects it on mismatch.
- **Secret scan** the proposed content and reject a proposal that contains any of:
  - `sk-ant-[A-Za-z0-9_-]{20,}`
  - `github_pat_[A-Za-z0-9_]{20,}`
  - `gh[pousr]_[A-Za-z0-9]{30,}`
  - `-----BEGIN [A-Z ]*PRIVATE KEY-----`
  - high-entropy strings 40 characters or longer next to the words key, token or secret
- **Status changes use CAS.** A second Approve on the same proposal gets a 409.

## Prompt injection
Repo files, chat text and fetched content may contain instructions. These are the defenses:
- **Agents have no commit tool.** Approval is human, and the diff is visible.
- **Policy is code, not prompt.** The allow-list, limits and secret scan live in code and are re-checked at approve time.
- **Secrets never enter prompts,** so the model cannot leak what it never saw.
- **The UI warns** when a proposal touches `public/_headers` (CSP) or `.claude/**` (agent behavior). These need extra care.

## Rate & cost limits
| Limit | Value |
|---|---|
| Netlify rules (2 on Free) | `/api/login` 10/min/IP; `/api/chat` 20/min/IP |
| Blobs counters per session per day | 100 chat turns, 20 jobs, 10 approvals |
| Per job | ≤ 15 tool rounds; `max_tokens` capped; user message ≤ 32 KB |
| Anthropic | Workspace spend limit as the hard stop |

## Audit
Write an audit record for every login (success and fail), proposal, approve, reject and commit result.

## Tests that must exist (QA owns them)
- 401 without a cookie.
- 403 on a bad CSRF token or Origin.
- 429 over a limit.
- The allow-list unit test table, including traversal, case and symlink cases.
- Secret-scan positives and negatives.
- Hash mismatch.
- Double approve.
- The GitHub token is absent in a non-production context.
- No secret strings in `public/` or in build output.
