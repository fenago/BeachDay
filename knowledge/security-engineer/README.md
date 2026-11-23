# Knowledge: security-engineer
Date: 2026-11-23

Reference notes from OWASP and GitHub's official docs, plus runnable examples of the Console's security controls. Read these with `docs/04-agent-console.md` §3–6 and §9–12, the `secure-by-design` and `agent-console-security` skills, and ADR-0001 to ADR-0005.

## docs/
| File | Covers | Read it when |
|---|---|---|
| [docs/01-owasp-top10-and-llm-top10.md](docs/01-owasp-top10-and-llm-top10.md) | OWASP Top 10:2025 categories; OWASP LLM Top 10 2025; LLM01 prompt-injection mitigations; LLM06 excessive-agency controls mapped to Beach Day | Threat-modelling, or labelling review findings |
| [docs/02-password-storage-and-sessions.md](docs/02-password-storage-and-sessions.md) | Argon2id/scrypt parameters, Node `scrypt` `maxmem` and `timingSafeEqual` rules, session entropy, cookie flags, `__Host-`, timeouts, re-auth; our deviations | Reviewing login, `requireSession`, cookies, step-up |
| [docs/03-csrf-csp-and-security-headers.md](docs/03-csrf-csp-and-security-headers.md) | Signed CSRF tokens, Fetch Metadata + Origin fallback, CSP delivery and policies, recommended header values | Reviewing any `/api/*` POST, `public/_headers`, function response headers |
| [docs/04-input-validation-and-path-allowlists.md](docs/04-input-validation-and-path-allowlists.md) | OWASP input-validation rules, GitHub tree modes and symlinks, the path validator design, other function inputs | Reviewing the allow-list, `propose_change`, or any request parsing |
| [docs/05-secrets-logging-and-scanning.md](docs/05-secrets-logging-and-scanning.md) | Secret lifecycle, what not to log, log injection, our secrets inventory, the scanner rules | Reviewing env vars, logging, audit records, the secret scan |
| [docs/06-github-fine-grained-pat-push-protection-rulesets.md](docs/06-github-fine-grained-pat-push-protection-rulesets.md) | Fine-grained PAT scope, limits and expiry; permissions per endpoint; Workflows; push protection; rulesets | Reviewing the token setup (ADR-0005), GitHub error handling, repo settings |

## examples/
| Example | Demonstrates | Verified |
|---|---|---|
| [examples/01-password-and-session/](examples/01-password-and-session/) | `crypto.scrypt` (N=2^17, r=8, p=1, explicit `maxmem`) + `timingSafeEqual`; HMAC-signed `bd_session` create and verify; CSRF token bound to `sid`; 10-min step-up | 8/8 `node:test`, including tampering and expiry |
| [examples/02-path-allowlist/](examples/02-path-allowlist/) | Layered path validator (charset allow-list → segments → case-insensitive DENY → exact-case ALLOW) + proposal checks | 51-row attack table + 2 more tests, all pass |
| [examples/03-secret-scan-and-review/](examples/03-secret-scan-and-review/) | Proposal secret scanner with redacted findings and runtime-generated fixtures; a sample **APPROVE WITH CHANGES** review with a HANDOFF block | 4/4 `node:test`; the review is prose |

All examples use only Node built-ins. No real secrets are used anywhere. Placeholders are short (`sk-ant-EXAMPLE`, `github_pat_EXAMPLE`), and the scanner's positive fixtures are generated at runtime.

## Open items found while researching (for the orchestrator / Dr. Lee)
1. **`.png` on the allow-list vs "UTF-8 text only".** PNG proposals can never pass. Drop `png`, or design a binary path.
2. **Cookie path.** OWASP recommends the `__Host-` prefix with `Path=/`. We use `Path=/api`, a documented deviation.
3. **Revocation.** Stateless signed sessions can't be revoked before `exp`. Rotating `SESSION_SECRET` is the "log out everyone" switch, and a `sid` deny-list in Blobs is the alternative.
4. **Session length.** The 12 h absolute session is longer than OWASP's 4–8 h example for a workday. Consider 8 h.
5. **OWASP Top 10 edition.** The current edition is **2025**, not 2021. Use the A0x:2025 IDs in reviews.
