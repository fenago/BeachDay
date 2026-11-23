# 0009 — Separate public-read GitHub token for the agent read tools (supersedes 0007)
- Status: Proposed
- Date: 2026-11-23
- Deciders: Dr. Lee (+ software-architect drafted; security-engineer recommended it; netlify-engineer, agent-console-engineer to review)

Would supersede [0007](0007-agent-reads-from-github-main.md). It changes only 0007's point 5 (which token the read tools use). 0007's other points are restated unchanged in Decision 6, so this file would be the single current statement of how agents read the repo. Until Dr. Lee accepts it, ADR-0007 stands as written.

## Context
- **ADR-0007 point 5:** the `chat` and `jobs-run` functions use the write-capable `GITHUB_TOKEN` (ADR-0005: Contents read/write on `fenago/BeachDay`) for their GET calls, through a `github-read` module with no write methods. ADR-0007's own Consequences call this "wider token use" and name the trigger "security-engineer recommends a separate read-only token" under Revisit when.
- **That trigger has fired.** security-engineer recommends a separate token (docs/04 §4.6, wave 2 review, 2026-11-23).
- **Where the exposure is.** `chat` and `jobs-run` hold the most code, run longest (up to 15 min), and are the functions that process model output and repo text, so they are where prompt injection and bugs live. With ADR-0007 they carry a token that can write `main`. `approve` is small, short and reached only after step-up (docs/04 §4.2).
- **What GitHub allows.** "Tokens always include read-only access to all public repositories on GitHub" ([managing PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), read from the `github/docs` source on 2026-11-23; `knowledge/security-engineer/docs/06-…`). So a fine-grained token with **public repositories** access and **no permissions** can read this repo while it is public, and can write nothing.
- **The repo is public.** `GET /repos/fenago/BeachDay` returned `"private": false, "visibility": "public"` on 2026-11-23.
- **Rate budgets.** An authenticated token gets 5,000 REST requests an hour; unauthenticated calls get 60 an hour per IP address ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)), and Netlify function IPs are shared. ADR-0007 estimates 2 + N GETs per turn.
- **Options considered:**

| Option | Leak exposes | Works if repo goes private | Extra secrets |
|---|---|---|---|
| A. Status quo (ADR-0007): one write token everywhere | Write access to `main` | Yes | 0 |
| B. Second PAT, this repo only, **Contents: read** | Read of this repo (public today, so nothing new) | Yes | 1 |
| C. Second PAT, **public repositories only, no permissions** | Nothing an anonymous visitor lacks, except its rate budget | **No**: reads fail closed | 1 |
| D. No token for reads (anonymous GETs) | Nothing | No | 0, but 60 requests/hour per shared IP is too low |

- B and C are equal while the repo is public. C fails safe if the repo goes private (reads stop; nothing widens), and it holds no permission on any repo, so a mistake in its scope can't grant write. B keeps working after a private switch, which is exactly the moment the read scope should be re-decided.
- **Cost:** no Netlify credits, no new dependency, no new route. One more secret to create, store and rotate.
- **Free plan:** env-var scopes are Pro+, and per-context values on Free are **[UNVERIFIED]** (docs/03 §6, docs/04 §4.6). The new token gets the same four-layer treatment as the others; because it grants nothing private, its exposure to builds is acceptable.

## Decision
We will give the read tools their own token, option C:

1. **The token.** A fine-grained personal access token owned by `fenago`, with repository access set to **public repositories only** (the exact label in GitHub's UI is **[UNVERIFIED]**; check it when creating the token) and **no permissions** granted. Expiry 90 days, rotated on the same calendar reminder as `GITHUB_TOKEN` (ADR-0005).
2. **Storage.** Netlify secret env var **`GITHUB_READ_TOKEN`**, set with `--context production --secret`, under the four layers of docs/04 §4.6 (production context, Deploy Previews and branch deploys off, a production check in code, nothing agent-writable in the build).
3. **One token per function, enforced in code.**
   - Only `netlify/functions/lib/github-read.mts` reads `GITHUB_READ_TOKEN`. `chat`, `jobs-run` and `GET /api/proposals/:id` (whose `committing` reconciler only reads `main`, docs/04 §7) import `github-read` and nothing that can write. Each runs the production-context check (docs/04 §4.6) before the module reads the token.
   - Only `netlify/functions/lib/github-write.mts` reads `GITHUB_TOKEN`, and only the approve function imports it. Approve's own GETs (the `main` ref, the base commit, blob SHAs) also use `GITHUB_TOKEN`, so approve depends on one secret.
   - A unit test scans `netlify/**` and fails if `GITHUB_TOKEN` appears outside `github-write.mts`, or `GITHUB_READ_TOKEN` appears outside `github-read.mts`. It matches whole words (`\bGITHUB_TOKEN\b`, so `GITHUB_READ_TOKEN` doesn't count as `GITHUB_TOKEN`) in every access form: `process.env.X`, `process.env["X"]`, `Netlify.env.get("X")` and any other string literal `"X"`/`'X'`/`` `X` ``. Building the name from pieces, or reading env through a computed key in those files' callers, also fails the test (match `process.env[` and `Netlify.env.get(` with a non-literal argument anywhere in `netlify/**`). So does any bulk read of the environment anywhere in `netlify/**`: spreading `process.env` (`{...process.env}`), `Object.entries`/`keys`/`values`/`assign` over `process.env`, passing `process.env` itself as an argument, destructuring from it, and `Netlify.env.toObject()`.
4. **Fail closed, never fall back.** If `GITHUB_READ_TOKEN` is missing or GitHub answers 401, 403 or 404, the read tool returns a `tool_result` with `is_error: true` and a short message such as "Repository reads are unavailable." It never retries with `GITHUB_TOKEN`. The chat turn itself continues.
5. **Pre-launch test (on the real token, before chat is enabled):** with `GITHUB_READ_TOKEN`, `GET /repos/fenago/BeachDay/git/ref/heads/main`, `GET …/git/trees/{sha}?recursive=1` and `GET …/contents/{path}?ref={sha}` succeed, and `POST …/git/blobs` is refused. Record the result in docs/04 §4.6. If it fails, the read tools stay off and the orchestrator brings it back to Dr. Lee. There is no automatic fallback to `GITHUB_TOKEN`.
6. **Carried over from ADR-0007 unchanged:**
   - pin `main` once per chat turn or job and read everything at that `headSha`;
   - `list_files` uses one recursive tree call per turn or job and reports truncation instead of guessing;
   - `read_file` returns the text and its blob `sha`; `propose_change` stores `baseSha` and each file's `readBlobSha` (`null` for new or unread files);
   - read deny rules: `.env*`, `*.pem`, `*.key`, `.git/**`, non-UTF-8 files and files over 200 KB are refused before any GitHub call; other paths, including denied write paths, may be read;
   - GitHub errors become `is_error` tool results with no token, header or stack trace.

## Consequences
- **Good:** the functions most exposed to prompt injection and bugs no longer hold a credential that can write `main`. Only the approve function does, after step-up.
- **Good:** a leaked read token exposes nothing that isn't already public. Reads and Approve have separate 5,000-per-hour budgets, so a chatty job can't starve an Approve.
- **Bad:** one more secret to create, store and rotate, and a second 90-day reminder. It also counts toward GitHub's 50 fine-grained tokens per user, which is not a practical limit here.
- **Bad:** **if the repo goes private, the read tools stop working** until a new ADR picks a token (most likely option B). This is deliberate: a scope change should be a decision, not a silent widening. The Console must show the tool error clearly.
- **Bad:** whether a no-permission token gets exactly anonymous-level read on the tree, ref and contents endpoints is **[UNVERIFIED]** until the test in Decision 5 runs.
- **Neutral:** 0 Netlify credits, no new dependency, no new route, no change to the approve flow.
- **Follow-up (on acceptance only):**
  - set ADR-0007's status line to `Superseded by 0009`;
  - netlify-engineer adds `GITHUB_READ_TOKEN` to the env table in docs/03 §6 and the `netlify-config-deploy` skill;
  - security-engineer points docs/04 §4.6, `secure-by-design` and the secrets inventory at this ADR;
  - agent-console-engineer builds `github-read.mts` / `github-write.mts` and the token-name scan test;
  - Dr. Lee creates the token and runs the Decision 5 test.

## Revisit when
- The repository becomes private, or GitHub changes what a fine-grained token can read in public repositories.
- We move from PATs to a GitHub App (ADR-0005's revisit trigger). Installation tokens can be narrowed per request, which would replace both PATs.
- Read volume approaches the 5,000-per-hour budget (ADR-0007 suggests caching blobs by SHA first).
