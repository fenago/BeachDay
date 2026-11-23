# Beach Day: guide for Claude Code

Beach Day is an installable PWA. You pick a South Florida beach and it tells you whether today and the next few days are good beach days, using the free, keyless Open-Meteo Forecast and Marine APIs. The deployed app also has an **Agent Console** (`/console`). There you can chat with the agents defined below. An agent can propose code changes, and they are committed to `main` only after a human clicks **Approve**.

The project lead is **Dr. Lee**, who makes the product decisions.

## Decisions you must respect (`docs/adr/`)

1. **Architecture:** a static front end on Netlify, with Netlify Functions **only** for the Claude and GitHub calls. No other servers. The browser calls Open-Meteo directly. ADR-0006 supersedes this for sign-in: Console users sign in with Supabase Auth, which the browser calls directly, and every function checks the token and role.
2. **Rip currents:** no rip-current proxy. Link out to the National Weather Service.
3. **Approve:** commits straight to `main` as one atomic commit, and Netlify auto-deploys it.
4. **Hosting plan:** Netlify Free (300 credits a month, 15 per production deploy).
5. **GitHub access:** a fine-grained PAT for this repo only, with Contents read/write and no Workflows permission.

Research and specs live in `docs/`. Start with `docs/README.md`.

## The agent team

The 12 project subagents are in `.claude/agents/`. Their 25 shared skills are in `.claude/skills/<skill>/SKILL.md`. Each agent preloads its skills through the `skills:` frontmatter field. The full roster and skill matrix are in `docs/expert-roster.md`.

| Agent | Role |
|---|---|
| `orchestrator` (**Kai**) | Runs the team: plans, delegates, routes handoffs, enforces review gates, reports to Dr. Lee |
| `agent-builder` (**Juno**) | Meta agent: creates and improves the agents and skills |
| `software-architect` (**Rowan**) | System design, interfaces, ADRs |
| `open-meteo-integrator` (**Dewey**) | Open-Meteo data layer and the beach-day score |
| `pwa-mobile-engineer` (**Pip**) | Manifest, service worker, offline, install on iOS and Android |
| `security-engineer` (**Vera**) | Threat model and security reviews (can block) |
| `agent-console-engineer` (**Remy**) | Agent Console: Claude via Functions, proposals, Approve → GitHub commit |
| `supabase-auth-engineer` (**Cass**) | Console sign-in on Supabase Auth: profiles and roles, the token-and-role check on every function |
| `ui-designer-apple-liquid-glass` (**Sable**) | Apple-inspired Liquid Glass visual design system |
| `ux-designer-apple-hig` (**Wren**) | Flows, interaction and copy per Apple's Human Interface Guidelines |
| `qa-engineer` (**Tess**) | Tests and the release gate |
| `netlify-engineer` (**Nell**) | Netlify config, functions platform, env vars, deploys, credits |

### Agent knowledge (`knowledge/<agent-name>/`)

Each agent has its own knowledge folder:
- `docs/` holds reference notes taken from the official documentation, each with its source link.
- `examples/` holds small worked examples that were run, showing what good looks like.
- `README.md` indexes the folder.

Every agent file has a **Before you answer** section. It tells the agent to read its whole knowledge folder first and to prefer it over memory. When you add an agent, add its knowledge folder too.

### How the team works

- **The orchestrator runs the experts in parallel.** It splits a goal into tasks and sends independent ones to several experts at once, in one message with multiple Agent calls. For example, Wren designs a flow while open-meteo-integrator builds the data layer and netlify-engineer prepares config. Dependent work runs in sequence: UX → UI → architect check → builders → QA → security → Netlify.
- **Agents hand work to each other only through the orchestrator.** Experts can't spawn other agents (`disallowedTools: Agent`). Each expert finishes with a `HANDOFF` block, and its `needs:` line names who should act next. The orchestrator reads the block and sends the follow-up task to that expert with the context it needs. No expert-to-expert calls (hub and spoke; see the `team-protocol` skill).
- **Experts don't commit or push.** Only the orchestrator commits, and only when Dr. Lee asks. In the deployed Agent Console, agents can only call `propose_change` on allow-listed paths. A human approves every commit.
- **Review gates** (which agent must review which change) are in the `change-proposal-protocol` skill and `docs/expert-roster.md` §5.

### Running the team

- Recommended: start a session with the orchestrator as the main agent, so it can delegate directly:
  ```bash
  claude --agent orchestrator
  ```
- The orchestrator's `Agent(...)` allow-list is enforced only when it runs as the main agent (`--agent`). When it runs as a subagent, the experts' `disallowedTools: Agent` is what keeps all routing in the orchestrator.
- Keep the experimental agent-teams mode off: teammates ignore the `skills:` preloads.
- In an ordinary session, hand any multi-step Beach Day request to the `orchestrator` subagent. Don't call experts yourself, so routing stays in one place. Answering a quick question yourself is fine.
- Each agent file has a model (its "brain"), a first name in the custom `persona:` field, and a one-line `personality:` field. Claude Code ignores the two custom fields; the Agent Console shows them. They are all listed in `docs/agent-brains.md`.

## Working rules for every session

- Read the relevant `docs/` file and the existing code before you change anything.
- Never put secrets (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) in the repo, the front end, logs or prompts. The Supabase project URL and publishable key are public by design; the Supabase secret and `service_role` keys are used nowhere.
- Verdicts never depend on colour alone. Keep the Open-Meteo attribution on screen. Beach Day is not a safety service, so always point people to NWS rip-current risk and posted flags.
- Every push to `main` is a production deploy and costs Netlify credits, so batch changes.
- When you add or rename an agent or skill, update `.claude/agents/`, `.claude/skills/`, `knowledge/`, `docs/expert-roster.md`, the orchestrator's `Agent(...)` list and this file together.
