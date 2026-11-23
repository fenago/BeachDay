---
name: agent-console-security
description: Security controls specific to the Beach Day Agent Console — the Supabase token and super_admin check on every function, step-up before Approve, Origin checks, path allow-list and deny-list, secret scanning of proposals, approval-only commits, prompt-injection defenses, rate and cost limits, audit log, and the tests that prove them. Use when building, reviewing or testing the Console.
---
# Agent Console security (details: docs/04 §3, §4, §6, §9, §10, §12)

## Who may do what
- Anyone can sign up through Supabase Auth, so being signed in proves nothing. The only privilege is `profiles.role = 'super_admin'`, set by Dr. Lee by hand (ADR-0006).
- **Every `/api/*` function** runs the check first (docs/04 §4.1):
  1. Bearer token present;
  2. `getClaims(token)` verifies it;
  3. check `iss`, `aud`, `is_anonymous` and `sub` yourself;
  4. read the role from `profiles` as the caller.
- Outcomes: **401** for a bad token, **403** if not `super_admin`, **503** on any upstream failure. Fail closed, and never echo the error. The role is not cached.
- `/api/jobs-run` (background) re-runs the same check on the forwarded token **and** consumes a single-use nonce by CAS. Store only the nonce's SHA-256.
- Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Never the secret key or `service_role`.

## Step-up before Approve (docs/04 §4.2, example: knowledge/security-engineer/examples/01-bearer-step-up-and-origin/)
Approve calls `getUser(token)` and then requires all of these:
- an `amr` entry with method `password` or `oauth` that is **≤ 600 s old**;
- `last_sign_in_at` **≤ 600 s old**;
- `aal2` if the user has a verified factor.

On failure: **401 `step_up_required`**, and the proposal stays `pending`.
- `reauthenticate()` is not a step-up. A fresh `totp` alone never passes, because a token thief could enrol their own factor.
- Google step-up is a new `signInWithOAuth` redirect. After it, the user clicks Approve again; nothing is approved from a URL.
- Approve stays disabled until the pre-launch tests on the real project pass (docs/04 §4.2 a–e).

## Browser and tokens
- The session lives in `localStorage`, on the **same origin as the beach app**. Any script on the site can read it, so the CSP is the defence.
- The access token lives **600 s**. Use `flowType: 'pkce'`. Log-out is `signOut({scope:'local'})`.
- Remove `code` from the URL after the PKCE exchange. Never cache `/api/**` or Supabase responses in the service worker.
- Render model output, diffs and Supabase errors with `textContent` or sanitized Markdown with no remote images. Never `innerHTML`.

## CSRF, Origin & framing
- Bearer tokens in a header aren't sent by the browser on its own, and we send **no** `Access-Control-Allow-*` headers, so classic CSRF is gone. There is no CSRF token and no cookie.
- Defence in depth on every POST: **403** if `Sec-Fetch-Site` is present and not `same-origin`, or if `Origin` is present and not the site URL. When both are absent, the call passes (server to server).
- No query string or hash ever triggers a state change. `frame-ancestors 'none'`.

## Path allow-list (canonical: docs/04 §6; mirrored in `change-proposal-protocol`)
Lives in `netlify/functions/lib/allowlist.mts`. Enforce it at proposal time **and** again at approve time.
- **Allow:** `public/**` with a text extension (`html, css, js, json, webmanifest, svg, txt, md`), `tests/**`, `docs/**`, `.claude/agents/*.md`, `.claude/skills/**/*.md`.
- **Deny (deny wins):** `public/_headers`, `public/_redirects`, `public/sw.js`, `public/sw/**`, `public/vendor/**`, `public/generated/**`, `public/version.json`, `netlify/**`, `netlify.toml`, `.github/**`, `package.json`, `package-lock.json`, `scripts/**`, `**/.env*`, `.git/**`, `.gitmodules`, `.claude/settings*`, `**/*.pem`, `**/*.key`.
- **Open for Dr. Lee:** also deny `public/console.html` and `public/js/console/**` (security-engineer's recommendation). Until he rules, they are allowed with a warning.
- **Validate the exact string sent to GitHub.** Use a character allow-list `[A-Za-z0-9._-/]`. Reject `..`, `.`, empty segments, a leading `/` and trailing dots. Deny is case-insensitive (`Netlify.toml`, `public/_Headers`); allow is exact-case.
- **Limits:** at most 20 files, 200 KB per file, UTF-8 text only, mode always `100644`, no case-insensitive duplicates.
- **Warn in the proposal card** on:
  - `public/**/*.js` and `*.html`, because they run next to the tokens;
  - `.claude/**`, because it changes agent behaviour or model;
  - `tests/**`, because it runs in CI.

## Proposal integrity
- At creation, compute `contentHash` = SHA-256 of a canonical JSON of the files. Show its first 8 characters in the UI and send it with Approve. Approve recomputes it and **compares**; a mismatch gets 409.
- **Secret scan** at proposal time and again at Approve (example 03). Reject a proposal that contains any of:
  - `sk-ant-[A-Za-z0-9_-]{20,}`
  - `github_pat_[A-Za-z0-9_]{20,}`, `gh[pousr]_[A-Za-z0-9]{30,}`
  - `sb_secret_[A-Za-z0-9_-]{20,}`
  - a full JWT: `eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`. That covers legacy `service_role`/`anon` keys and access tokens.
  - `-----BEGIN [A-Z ]*PRIVATE KEY-----`
  - assignments to `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` or `GITHUB_READ_TOKEN`
  - high-entropy strings of 40+ characters next to key, token or secret. Lower-case slash paths are excluded.
- **Do not** match the bare word `service_role`: the docs explain it. Findings are redacted to 6 characters plus the length.
- **Status changes use CAS.** A second Approve on the same proposal gets a 409. One approve is in flight site-wide.

## Prompt injection
Repo files, chat text and fetched content may contain instructions. These are the defenses:
- **Agents have no commit tool.** Approval is human, after a fresh sign-in, and the diff is visible.
- **Policy is code, not prompt.** The allow-list, limits and secret scan live in code and are re-checked at approve time.
- **Secrets never enter prompts,** so the model can't leak what it never saw. The read tools refuse `.env*`, `*.pem`, `*.key`, `.git/**` and binaries (ADR-0007).
- **The browser never sends** `tool_use`, `tool_result` or `thinking` blocks. They exist only in server-side state.

## Rate & cost limits (docs/04 §9)
| Limit | Value |
|---|---|
| Netlify rules (2 on Free) | `/api/chat` 20 per 60 s; `/api/jobs` 10 per 60 s; `aggregateBy: ["ip","domain"]` |
| Per user per day (Blobs, America/New_York) | 200 chat turns, 20 jobs; counted at start, never refunded |
| Per turn or job | ≤ 15 tool rounds; ≤ 1,000,000 tokens (all input, cache and output tokens summed); `max_tokens` capped; user message ≤ 32 KB; job ≤ 14 min |
| Site-wide compute budget | 180 function-minutes of chat + jobs-run per rolling 31 days (number awaits Dr. Lee) → `429 budget_exhausted` |
| Approve cap (ADR-0008) | 14 per rolling 31 days, 5 per day, site-wide; only `committed` counts, so nothing is refunded; reconciled commits count |
| Anthropic | Workspace spend limit as the hard stop |

## Environments & build (docs/04 §4.6, §4.7)
- `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` are set for the Production context only.
- Deploy Previews and branch deploys are **off**.
- Functions return 503 unless `context.deploy.context === "production"`.
- No test runner in the Netlify build. Tests run in GitHub Actions with `permissions: contents: read` and no secrets.

## Audit
Write an audit record (actor = Supabase user id) for every proposal, approve, step-up failure, reject and commit result. Supabase logs sign-ins; we don't duplicate them.

## Tests that must exist (QA owns them; docs/04 §12)
- **On every function:** 401 for no, garbage, expired, bad-signature, wrong-`iss` or anonymous tokens; 403 for role `user` or no row; 503 when Supabase is down. None of these touch any store.
- **Step-up:** 601 s → 401; `token_refresh` only → 401; fresh `totp` with a stale sign-in → 401; factor present with `aal1` → 401.
- **Origin:** 403 on a cross-site `Sec-Fetch-Site` or a foreign `Origin`; no `Access-Control-Allow-*` on any response.
- **Limits:** 429 over each one, including the 5th/6th approval in a day and the 14th/15th in 31 days.
- **Allow-list:** the unit test table for the canonical list, including traversal, case and symlink cases.
- **Secret scan:** positives and negatives (`service_role` in prose stays quiet).
- **Approve:** hash mismatch → 409; double approve → one 200 and one 409.
- **Environments:** functions return 503 outside production.
- **No secret strings** in `public/` or the build output; the CSP header equals docs/04 §10.
