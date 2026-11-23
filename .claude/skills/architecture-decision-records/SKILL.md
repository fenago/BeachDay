---
name: architecture-decision-records
description: How Beach Day records architecture decisions in docs/adr/ — template, numbering, superseding, and the current decision log. Use when a design choice is made or challenged, or before proposing anything that might contradict an existing decision.
---
# Architecture Decision Records

- **Location:** `docs/adr/NNNN-short-title.md`. Index: `docs/adr/README.md`.
- **Numbering:** sequential with 4 digits. Never reuse a number.
- **Accepted ADRs are immutable.** To change a decision, write a new ADR with "Supersedes NNNN", then update the old one's status line to `Superseded by NNNN`. That status line is the only edit allowed on an accepted ADR.
- **Only Dr. Lee accepts ADRs.** Agents draft them with `Status: Proposed`, and the orchestrator brings them to Dr. Lee.

## Template
```markdown
# NNNN — Title
- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: Dr. Lee (+ agents consulted)

## Context        (forces, constraints, links to docs/ and sources)
## Decision       (what we will do, specific and testable)
## Consequences   (good, bad, follow-up work)
## Revisit when   (concrete trigger)
```

## Current log
| ADR | Decision |
|---|---|
| 0001 | *Superseded by 0006.* Static site + Functions for Claude/GitHub only; browser → Open-Meteo |
| 0002 | No rip-current proxy; link out to NWS |
| 0003 | Approve commits straight to `main` |
| 0004 | Netlify Free plan for now |
| 0005 | Fine-grained PAT, this repo, Contents R/W, no Workflows |
| 0006 | Supabase Auth for the Console (supersedes 0001): browser → Open-Meteo and → Supabase Auth directly; Functions only for Claude/GitHub; every function checks Bearer + `super_admin`, fails closed; publishable key only; vendored `@supabase/auth-js` |
| 0007 | Agent `read_file`/`list_files` read from GitHub `main`, pinned to one SHA per turn |
| 0008 | Approve cap, site-wide: 14 per rolling 31 days, 5 per day |

Exception on record: when Dr. Lee states a decision himself (as with 0006–0008), the ADR can be written straight as `Accepted` with `Deciders: Dr. Lee`. ADR-0004's "password gate" consequence is outdated since 0006 but stays unedited, because accepted ADRs are immutable.

## When to write one
Write an ADR for:
- a new dependency or service;
- a change to the trust boundary (secrets, auth, GitHub);
- a change to the deploy flow;
- data-source changes;
- anything that changes cost.

Small implementation choices go in code comments or the PR summary instead.
