# Secrets management, logging, and secret scanning
Source: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html · https://owasp.org/www-community/attacks/Log_Injection
Retrieved: 2026-11-23 (cheat sheets from the official OWASP/CheatSheetSeries GitHub source)

## Secret lifecycle ([Secrets Management §2.7](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html))
**Creation:**
- Generate secrets securely, "cryptographically robust enough for their purpose".
- Give them "the minimum privileges … to enable their required use/role".

**Rotation:**
- "regularly rotate secrets so that any stolen credentials will only work for a short time."
- *User* passwords are the exception. Rotate them only on suspicion or evidence of compromise, per NIST.

**Revocation:** revoke when the secret is no longer needed or is possibly compromised.

**Expiration:**
- "create secrets to expire after a defined time where possible".
- "Applications should verify that the secret is still active before trusting it."

**Detection (§8):**
- Shift left: pre-commit, IDE and CI scanning.
- Make secrets part of the threat model.
- Consider more than one detection tool.
- "Create standard test secrets and use them universally" to reduce false positives.
- Balance entropy-based detection against fixed-format detection.

Secret types to detect include API keys, private keys, session tokens, passwords, connection strings and "High availability secrets (Tokens that are difficult to rotate)".

## Logging ([Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html))
**Events to record** include authentication successes and failures, authorization failures, session-management failures such as "cookie session identification value modification", input-validation failures and high-risk actions.

**Do not log directly** (remove, mask, sanitize, hash or encrypt instead):
- "Session identification values (consider replacing with a hashed value if needed to track session specific events)"
- "Access tokens"
- "Authentication passwords"
- "Encryption keys and other primary secrets"
- "Application source code"
- sensitive PII

**Log injection:**
- "Perform sanitization on all event data to prevent log injection attacks e.g. carriage return (CR), line feed (LF) and delimiter characters".
- Prefer **structured** formats, because "unstructured text log formats are susceptible to log entry injection" (CWE-117).

Logs themselves are a target. One listed failure mode is "Logs contain technical secrets such as passwords."

## Beach Day secrets inventory
| Secret | Where | Scope / lifetime | Rotation |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Netlify secret env var | dedicated workspace with a spend limit | on suspicion; at least yearly (our choice) |
| `GITHUB_TOKEN` | Netlify secret env var, **Production context only** | fine-grained PAT: 1 repo, Contents R/W, no Workflows (ADR-0005) | 90-day expiry, calendar reminder |
| `CONSOLE_PASSWORD_HASH` | Netlify secret env var | the scrypt hash, not the password | when the password changes |
| `SESSION_SECRET` | Netlify secret env var | ≥ 32 random bytes | rotating it logs everyone out; use it as the "revoke all sessions" switch |

Rules from `secure-by-design`:
- Secrets are only ever read inside functions.
- They never appear in `public/`, the repo, fixtures, logs, responses or **prompts**.
- If one leaks: **rotate first, then investigate.**

## Audit and log design
Use **structured JSON** logs, one object per event:
```json
{"evt":"approve","requestId":"01J…","sid_h":"3f9a1c2e","agent":"pwa-mobile-engineer","proposal":"p_01J…","result":"committed","commit":"9b1e…","ms":1840}
```
- `sid_h` is a truncated HMAC of `sid`, never the raw `sid` or cookie.
- Never log:
  - request bodies (they can contain the password or proposal content)
  - `Authorization`/`Cookie` headers
  - `process.env`
  - full upstream error bodies
- Audit events (`agent-console-security`): login success and fail, proposal created, approve, reject, commit result. Write them to Blobs with `onlyIfNew` keys so they are append-only.
- Strip CR/LF from any user-controlled value that ends up in a log message. Using JSON fields instead of string concatenation does this.

## Our secret scanner (examples/03)
- **Rules from `agent-console-security`:**
  - `sk-ant-[A-Za-z0-9_-]{20,}`
  - `github_pat_[A-Za-z0-9_]{20,}`
  - `gh[pousr]_[A-Za-z0-9]{30,}`
  - `-----BEGIN [A-Z ]*PRIVATE KEY-----`
  - high entropy (≥ 40 chars) near key, token or secret
- **Added rules:**
  - AWS key ID
  - Slack token
  - `ANTHROPIC_API_KEY=` style assignments to our own env var names
- **Findings are redacted** to 6 characters plus the length, so they can be logged and shown.
- **Test fixtures are generated at runtime.** That follows OWASP's "standard test secrets" advice, and it keeps our own repo clean for GitHub push protection.

## Beach Day notes
- The scanner is a tripwire. The structural control is that **secrets never enter the model's context**, so an injected agent has nothing to exfiltrate. Keep env values out of system prompts, tool results and error messages returned to Claude.
- **Build logs:** on Free there are no env-var scopes, so builds can read secrets (ADR-0004). `scripts/**` is on the deny list, and build scripts must never print env.
- **Deploy Previews:** `GITHUB_TOKEN` is absent outside Production, so the approve function returns `not_configured`. QA tests this (`agent-console-security` → "token absent in non-production").
- **Ordering:** run the scanner before storing a proposal and again at Approve. GitHub push protection is the third line of defence (doc 06).
