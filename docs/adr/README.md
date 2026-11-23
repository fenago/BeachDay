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
| [0001](0001-static-site-plus-functions.md) | Static site + Netlify Functions, no other servers | Accepted |
| [0002](0002-no-rip-current-proxy.md) | No rip-current proxy; link out to NWS | Accepted |
| [0003](0003-approve-commits-to-main.md) | Approve commits straight to `main` | Accepted |
| [0004](0004-netlify-free-plan.md) | Stay on Netlify Free for now | Accepted |
| [0005](0005-fine-grained-pat.md) | Fine-grained personal access token for GitHub | Accepted |
