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

## Beach Day secrets inventory (since ADR-0006)
| Secret | Where | Scope / lifetime | Rotation |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Netlify secret env var, Production context | dedicated workspace with a spend limit | on suspicion; at least yearly (our choice) |
| `GITHUB_TOKEN` | Netlify secret env var, **Production context only**, read only by approve | fine-grained PAT: 1 repo, Contents R/W, no Workflows (ADR-0005) | 90-day expiry, calendar reminder |
| `GITHUB_READ_TOKEN` (proposed, needs an ADR) | Netlify secret env var, Production | fine-grained PAT, **Public repositories** access, no permissions; read tools only | 90-day expiry |
| User access/refresh tokens | the user's browser `localStorage` only | access token 600 s; refresh token single-use | sign-out; refresh reuse detection revokes the session |

**Not secrets:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `GITHUB_REPO`. Never mark them secret, or secret scanning fails the build on `config.js`.

**Never created:** the Supabase secret key `sb_secret_…` and the legacy `service_role` JWT. The two old Console-password variables (names beginning `CONSOLE_` and `SESSION_`) were removed (ADR-0006); delete them from Netlify if they exist.

Rules from `secure-by-design`:
- Secrets are only ever read inside functions.
- They never appear in `public/`, the repo, fixtures, logs, responses or **prompts**.
- If one leaks: **rotate first, then investigate.**

## Audit and log design
Use **structured JSON** logs, one object per event:
```json
{"evt":"approve","requestId":"01J…","user":"<supabase user id>","agent":"pwa-mobile-engineer","proposal":"p_01J…","result":"committed","commit":"9b1e…","ms":1840}
```
- `user` is the Supabase user id (`sub`). It is not secret, and it is the audit actor. Never log the token itself.
- Never log:
  - request bodies (they can contain proposal content)
  - the `Authorization` header, `apikey` values, access or refresh tokens
  - `process.env`
  - full upstream error bodies
- Audit events (`agent-console-security`): proposal created, approve, step-up failure, reject, commit result. Supabase records sign-ins itself. Write them to Blobs with `onlyIfNew` keys so they are append-only.
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
  - `sb_secret_…` and any full three-part JWT (legacy `service_role`/`anon` keys, access tokens). The bare word `service_role` is not a rule.
  - `ANTHROPIC_API_KEY=` style assignments to our own env var names
- **Findings are redacted** to 6 characters plus the length, so they can be logged and shown.
- **Test fixtures are generated at runtime.** That follows OWASP's "standard test secrets" advice, and it keeps our own repo clean for GitHub push protection.

## Beach Day notes
- The scanner is a tripwire. The structural control is that **secrets never enter the model's context**, so an injected agent has nothing to exfiltrate. Keep env values out of system prompts, tool results and error messages returned to Claude.
- **Build logs:** on Free there are no env-var scopes, so builds can read secrets (ADR-0004). `scripts/**` is on the deny list, build scripts must never print env, and no test runner runs in the build (docs/04 §4.7).
- **Deploy Previews:** turned off (docs/04 §4.6). Per-context values on Free are UNVERIFIED, so functions also return 503 unless `context.deploy.context === "production"`. QA tests this.
- **Ordering:** run the scanner before storing a proposal and again at Approve. GitHub push protection is the third line of defence (doc 06).
