# 0007 — Agent read tools read from GitHub `main`
- Status: Accepted
- Date: 2026-11-23
- Deciders: Dr. Lee (+ software-architect drafted; security-engineer, agent-console-engineer to review)

## Context
- Console agents have two read tools, `read_file(path)` and `list_files(dir)`, plus `propose_change` (docs/04 §7, docs/05). Their source wasn't specified.
- **The deployed bundle is not the repo.** Netlify publishes `public/`, and functions bundle only what `included_files` lists (`agents.json`). `docs/`, `tests/`, `.claude/` and `netlify/` aren't readable at runtime, and what is deployed can lag `main` by a build.
- **The approve flow already compares against `main`.** It checks the proposal's `baseSha` and the blob SHA of each file it read against `main` (docs/04 §7). Reads that come from somewhere else can't give honest base SHAs.
- `GITHUB_TOKEN` (ADR-0005) is a fine-grained PAT with Contents read/write on this repo only. Contents read covers the Contents, Git Trees and Git Blobs GET endpoints.
- GitHub's primary REST limit for an authenticated PAT is 5,000 requests per hour ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). Jobs are capped at 15 tool rounds (docs/04 §9).
- Dr. Lee decided on 2026-11-23 that the read tools read from GitHub `main`.

## Decision
We will serve `read_file` and `list_files` from GitHub, pinned to one commit per turn:

1. **Pin the commit.** At the start of each chat turn or job, the function resolves `GET /repos/{repo}/git/ref/heads/main` once and stores that `headSha` in the turn or job state. Every read in that turn or job uses `ref=<headSha>`, so a turn sees one consistent snapshot even if `main` moves.
2. **`list_files(dir)`** uses `GET /repos/{repo}/git/trees/{headSha}?recursive=1` once per turn or job. It caches the tree in the job state and filters it by `dir`. If the API reports a truncated tree, the tool says so; it does not guess.
3. **`read_file(path)`** uses `GET /repos/{repo}/contents/{path}?ref={headSha}` and returns the text plus its blob `sha`.
   - The function records `{path → sha}` in the turn or job state.
   - `propose_change` stores that `headSha` as the proposal's `baseSha`. It stores each file's recorded `sha` as `readBlobSha`, or `null` for a new file or one the agent never read.
4. **Read deny rules,** enforced in code and checked before any GitHub call. Paths are normalised first, the same way as the write allow-list.
   - Refuse `.env*`, `*.pem`, `*.key` and `.git/**`.
   - Refuse anything that isn't UTF-8 text, and anything over 200 KB.
   - Other paths, including the denied write paths such as `netlify/**`, may be read so that agents can understand the code. Reading is not writing.
5. **Same token, read-only use.** The chat and job functions use `GITHUB_TOKEN` only for the GET calls above, through a small `github-read` module that exposes no write methods. Only the approve function imports the write module.
6. **Errors become tool results.** A GitHub error becomes a `tool_result` with `is_error: true` and a short message. It never contains a token, a header or a stack trace.

## Consequences
- **Good:** agents see exactly what Approve will compare against. Stale-base detection uses real SHAs, so a proposal built on an old read is caught as `stale`.
- **Good:** agents can read `docs/`, `tests/` and `.claude/`, which aren't deployed, so they have the context they need.
- **Bad: wider token use.** `GITHUB_TOKEN`, which can write, is now loaded by the chat and job functions too. A bug there would hold a write-capable token. Mitigation: the read module exposes no write methods, and code review gates `netlify/**`. Open question for security-engineer: should a second fine-grained PAT with **Contents: read-only** serve the read tools? That would add a secret.
- **Bad: reads fail in Deploy Previews.** `GITHUB_TOKEN` is meant to exist only in the Production context (ADR-0005), so read tools fail there. That is acceptable, because the Console is used on production. If Free can't scope env per context [UNVERIFIED, docs/03], previews would read too, which is harmless for reads.
- **Bad: one more dependency on GitHub.** If GitHub is down, chat still works but the read tools return errors.
- **Cost:** about 2 + N GitHub GETs per turn (the ref, the tree, and N files), far under 5,000 an hour. No Netlify credit impact.

## Revisit when
- Turns regularly need more than about 50 file reads, which suggests caching blobs by SHA in Blobs.
- The repository becomes private and holds files agents must not read; extend the read deny rules.
- Security-engineer recommends a separate read-only token.
