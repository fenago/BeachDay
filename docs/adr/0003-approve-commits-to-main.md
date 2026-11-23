# 0003 — Approve commits straight to `main`
- Status: Accepted
- Date: 2026-11-23
- Deciders: Dr. Lee

## Context
Agent Console proposals need a path to production. The options were a direct commit to `main`, or a branch, then a PR, then a Deploy Preview, then a merge. See `docs/04-agent-console.md` §7.

## Decision
When the user clicks **Approve**, the approve function:
1. Re-validates the proposal: path allow-list, size, secret scan, content hash and status.
2. Writes **one atomic commit** to `main` with the Git Database API (always sending `base_tree`, with `force: false`).

Netlify then auto-deploys `main`.

## Consequences
- Fast and simple: one commit is one production deploy (15 credits).
- No preview gate before production. Unit and function tests run on `main`. A failed post-deploy smoke test means an immediate Netlify rollback ("Publish deploy" on the previous deploy) or a revert commit.
- The human review of the diff in the Console is the main safety control, together with the server-side allow-list.

## Revisit when
The app has real users, or a bad deploy reaches production. Then adopt the branch/PR/preview flow, which is already documented.
