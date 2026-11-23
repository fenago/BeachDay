# 0005 — Fine-grained personal access token for GitHub
- Status: Accepted
- Date: 2026-11-23
- Deciders: Dr. Lee

## Context
The approve function must write commits to `fenago/BeachDay`. The options were a fine-grained PAT (simple, but long-lived, and it acts as the owner) or a GitHub App (tokens that expire after 1 hour, a bot identity, but more setup).

## Decision
Use a **fine-grained personal access token** set up as follows:
- **Repository access:** Only select repositories → `fenago/BeachDay`.
- **Permissions:** Contents: Read and write (Metadata: read is implied).
- **No Workflows permission** and no Pull requests permission.
- **Expiration:** 90 days, rotated on a calendar reminder.
- **Storage:** Netlify secret env var `GITHUB_TOKEN`, **Production context only**.

## Consequences
- The token cannot be limited to paths, so the path allow-list in `netlify/functions/lib/allowlist.mts` is the enforcement point. It must be re-checked at approve time.
- Without Workflows permission the token cannot change `.github/workflows/*`.
- Commits are attributed to the token owner; the agent name goes in the commit message and author name.
- Add a ruleset on `main` to block force pushes and deletions.

- **Open check before launch:** Netlify's pricing table lists per-deploy-context env var values as "Not included" on Free **[UNVERIFIED]**. Before launch, run `netlify env:set GITHUB_TOKEN <value> --context production --secret`. If Free refuses it, the token will also be visible to Deploy Preview and branch builds. In that case, disable deploy previews and branch deploys, or raise the decision with Dr. Lee.

## Revisit when
More people use the Console, the token is suspected leaked, or bot-attributed commits are wanted. Then move to a GitHub App.
