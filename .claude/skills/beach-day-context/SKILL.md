---
name: beach-day-context
description: Beach Day product brief, the architecture decisions, glossary and the map of docs/. Use whenever working on anything in the Beach Day repo, to stay consistent with what was decided.
---
# Beach Day — project context

## Product
- Beach Day is an installable PWA. The user picks a South Florida beach and sees whether today and the next few days are good beach days, and **why**.
- Data comes from the free, keyless Open-Meteo Forecast and Marine APIs.
- The deployed app also includes an **Agent Console** at `/console`:
  - lists the agents in `.claude/agents/`;
  - lets you chat with any of them;
  - lets an agent *propose* code changes, which are committed to GitHub only after a human clicks **Approve**.

Lead: **Dr. Lee** (human). Dr. Lee makes all product decisions.

## Decisions (docs/adr/) — do not contradict them
| ADR | Decision |
|---|---|
| 0001 | Static front end on Netlify plus Netlify Functions **only** for the Claude and GitHub calls. No other servers. The browser calls Open-Meteo directly. |
| 0002 | No rip-current proxy. Link out to the National Weather Service (NWS). |
| 0003 | Approve commits straight to `main` as one atomic commit. Netlify then auto-deploys. |
| 0004 | Stay on the Netlify Free plan: 300 credits/month, roughly 20 production deploys. |
| 0005 | Fine-grained PAT, this repo only, Contents read/write, no Workflows permission. |

If a task seems to need breaking a decision, stop and tell the orchestrator. Do not work around it.

## Where things are
| Topic | Doc |
|---|---|
| Use case, Open-Meteo, scoring | `docs/01-use-case-and-scoring.md` |
| PWA / install / service worker | `docs/02-pwa-installability.md` |
| Netlify architecture & limits | `docs/03-architecture-netlify.md` |
| Agent Console & security | `docs/04-agent-console.md` |
| Claude API | `docs/05-claude-api.md` |
| Testing & accessibility | `docs/06-testing-accessibility.md` |
| Team, skills, review gates | `docs/expert-roster.md` |

Read the relevant doc before changing that area.

## Planned layout
- `public/` (static: HTML, `js/` ES modules, `css/`, `icons/`, `manifest.webmanifest`, `sw.js`, `_headers`)
- `netlify/functions/` (+ `lib/`)
- `scripts/build-agents.mjs`
- `tests/` (`unit/`, `e2e/`, `fixtures/`)
- `docs/`
- `.claude/`

## Glossary
- **Verdict:** Great / Good / Fair / Skip it.
- **Beach window:** daylight hours that are scored.
- **Proposal:** an agent's suggested change, waiting for Approve.
- **Allow-list:** the paths agents may change.
- **Deploy:** a Netlify production deploy (costs 15 credits).

## Non-negotiables
- No secrets in the browser, the repo or logs.
- Verdicts are never conveyed by color alone.
- Always show the Open-Meteo attribution (CC BY 4.0).
- Never present Beach Day as a safety service. Always say to check NWS rip-current risk and posted flags.
