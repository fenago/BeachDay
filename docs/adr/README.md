# Architecture Decision Records

One file per decision: `NNNN-short-title.md`, using the template below. ADRs are never edited after they are accepted. To change a decision, write a new ADR that supersedes the old one and set the old one's status to `Superseded by NNNN`.

```markdown
# NNNN — Title
- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: Dr. Lee (+ agents consulted)

## Context
## Decision
## Consequences
## Revisit when
```

| ADR | Title | Status |
|---|---|---|
| [0001](0001-static-site-plus-functions.md) | Static site + Netlify Functions, no other servers | Superseded by 0006 |
| [0002](0002-no-rip-current-proxy.md) | No rip-current proxy; link out to NWS | Accepted |
| [0003](0003-approve-commits-to-main.md) | Approve commits straight to `main` | Accepted |
| [0004](0004-netlify-free-plan.md) | Stay on Netlify Free for now | Accepted |
| [0005](0005-fine-grained-pat.md) | Fine-grained personal access token for GitHub | Accepted |
| [0006](0006-supabase-auth-for-console.md) | Supabase Auth for the Agent Console (supersedes 0001) | Accepted |
| [0007](0007-agent-reads-from-github-main.md) | Agent read tools read from GitHub `main` | Accepted |
| [0008](0008-site-wide-approve-cap.md) | Site-wide Approve cap: 14 per rolling month, 5 per day | Accepted |
| [0009](0009-public-read-token-for-agent-reads.md) | Separate public-read GitHub token (`GITHUB_READ_TOKEN`) for the agent read tools (would supersede 0007) | Proposed |
| [0010](0010-diff-and-smol-toml-dependencies.md) | Two new npm dependencies: `diff` (runtime) and `smol-toml` (dev) | Proposed |

Note: ADR-0004's consequence about the "Console password gate" and its `/api/login` rate-limit rule are outdated since ADR-0006. ADR-0004's decision (stay on Netlify Free) still stands.
