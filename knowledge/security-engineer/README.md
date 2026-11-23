# Knowledge: security-engineer
Date: 2026-11-23 (reworked the same day for ADR-0006 Supabase Auth, ADR-0007 and ADR-0008)

Reference notes from OWASP, GitHub's and Supabase's official docs, plus runnable examples of the Console's security controls. Read them with:
- `docs/04-agent-console.md` §3, §4, §6, §9, §10 and §12;
- the `secure-by-design`, `agent-console-security` and `supabase-auth` skills;
- ADR-0003 to ADR-0008, and the Proposed ADR-0009 (read token);
- `knowledge/supabase-auth-engineer/`, for the auth API details.

## docs/
| File | Covers | Read it when |
|---|---|---|
| [docs/01-owasp-top10-and-llm-top10.md](docs/01-owasp-top10-and-llm-top10.md) | OWASP Top 10:2025 categories; OWASP LLM Top 10 2025; LLM01 prompt-injection mitigations; LLM06 excessive-agency controls mapped to Beach Day | Threat-modelling, or labelling review findings |
| [docs/02-supabase-tokens-sessions-and-step-up.md](docs/02-supabase-tokens-sessions-and-step-up.md) | Supabase session lifetime, Pro-only time-box, `amr`/`aal` claims, TOTP on all plans; OWASP re-auth; our step-up, token-lifetime and storage decisions | Reviewing the token check, Approve step-up, Dashboard auth settings |
| [docs/03-csrf-csp-and-security-headers.md](docs/03-csrf-csp-and-security-headers.md) | CSRF with Bearer tokens (why it's mostly gone), Fetch Metadata + Origin, CSP delivery and our site-wide policy, recommended header values | Reviewing any `/api/*` POST, `public/_headers`, function response headers |
| [docs/04-input-validation-and-path-allowlists.md](docs/04-input-validation-and-path-allowlists.md) | OWASP input-validation rules, GitHub tree modes and symlinks, the path validator design with the canonical list, other function inputs | Reviewing the allow-list, `propose_change`, or any request parsing |
| [docs/05-secrets-logging-and-scanning.md](docs/05-secrets-logging-and-scanning.md) | Secret lifecycle, what not to log, log injection, our secrets inventory (Supabase era), the scanner rules | Reviewing env vars, logging, audit records, the secret scan |
| [docs/06-github-fine-grained-pat-push-protection-rulesets.md](docs/06-github-fine-grained-pat-push-protection-rulesets.md) | Fine-grained PAT scope, limits and expiry; public-repo read access; permissions per endpoint; Workflows; push protection; rulesets | Reviewing the token setup (ADR-0005), the read-token question (ADR-0007), GitHub error handling |

Retired on 2026-11-23 with ADR-0006: `docs/02-password-storage-and-sessions.md` and `examples/01-password-and-session/` (scrypt password, HMAC session cookie, CSRF token). If the Console ever goes back to a shared password, the OWASP Password Storage Cheat Sheet is the source to re-read.

## examples/
| Example | Demonstrates | Verified |
|---|---|---|
| [examples/01-bearer-step-up-and-origin/](examples/01-bearer-step-up-and-origin/) | Approve step-up (`amr` password/oauth ≤ 600 s, `last_sign_in_at`, `aal2` when a factor exists, TOTP never a substitute) with `getUser` failures failing closed, **including returned (not thrown) `AuthRetryableFetchError` → 503** (fixed wave 3b); optional `alg`/`kid` header pre-check; `Sec-Fetch-Site`/`Origin` check | 4 tests (21-row step-up table, 9-row `getUser` failure table, 14-row header pre-check table, 7-row Origin table) pass, `node:test` |
| [examples/02-path-allowlist/](examples/02-path-allowlist/) | Layered path validator (charset allow-list → segments → case-insensitive DENY → exact-case ALLOW) with the canonical list from docs/04 §6, warnings, and proposal checks (incl. lone surrogates); **wave 4:** `commitmsg.mjs`, which has the one-line summary check, `buildCommitMessage`, `gitBlobSha` and the reconciler match with the full-page rule (docs/04 §6, §7) | 9/9 `node:test` (63-row attack table + 8 more); 5 mutants each caught |
| [examples/03-secret-scan-and-review/](examples/03-secret-scan-and-review/) | Proposal secret scanner, including `sb_secret_` and full-JWT rules, a path-shaped exclusion and redacted findings; a sample **APPROVE WITH CHANGES** review | 4/4 `node:test`; repo self-scan 6 findings, none real |

All examples use only Node built-ins. No real secrets are used anywhere. Placeholders are short (`sk-ant-EXAMPLE`, `github_pat_EXAMPLE`), and the scanner's positive fixtures are generated at runtime.

## Open items (for the orchestrator / Dr. Lee)
1. **Deny `public/console.html` and `public/js/console/**`** to agents (my recommendation). Until Dr. Lee rules, they are allowed with a warning.
2. **Site-wide compute budget of 180 function-minutes per rolling 31 days** (docs/04 §9). The number needs Dr. Lee's confirmation; without some budget, the per-user daily limits can't bound Netlify credits.
3. **Separate public-read-only GitHub token for the read tools:** drafted as [ADR-0009](../../docs/adr/0009-public-read-token-for-agent-reads.md) (`GITHUB_READ_TOKEN`), **Proposed**, awaiting Dr. Lee. Until he accepts it, ADR-0007 stands.
4. **TOTP for the `super_admin` account** (recommended; free on all Supabase plans).
5. **Pre-launch tests on the real Supabase project** (docs/04 §4.2 a–e). Approve stays disabled until they pass.
6. **OWASP Top 10 edition.** The current edition is **2025**, not 2021. Use the A0x:2025 IDs in reviews.

## Gaps for agent-builder
- The `github-repo-workflow` skill still describes `sha: null` deletions and the old `Proposal:/Agent:/Approved-via:` commit message; docs/04 §6–§7 (wave 4) supersede both. Flagged to the orchestrator.
- supabase.com is blocked from the sandbox. Supabase facts here came from the `supabase/supabase` docs source on GitHub. Re-check the live pages when allowed.
- docs.github.com did not resolve this round; one fact was read from the `github/docs` source.
- Not covered by any official page read: whether Google honours a forced re-login through `signInWithOAuth` `queryParams`, and how Netlify merges two `_headers` rules that set the same header.
