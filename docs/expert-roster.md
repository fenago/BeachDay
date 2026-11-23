# Beach Day — Expert Roster (agent team)

> **Decision on record:** Beach Day is a PWA on Netlify. It has a static front end and Netlify Functions for the Claude API and GitHub calls, and no other servers. The browser calls Open-Meteo directly (keyless, CORS-enabled). Only the Agent Console needs functions.
>
> This roster defines the agents that will live in `.claude/agents/` and the skills they share (to live in `.claude/skills/`). The Agent Console in the deployed app lists these same agents.

## 1. The team at a glance

| # | Agent (file name) | Persona | Suggested model | One-line job |
|---|---|---|---|---|
| 1 | `orchestrator` | — | `opus` | Runs the team. Turns Dr. Lee's goals into tasks, assigns them to the right expert, orders the handoffs, and decides when work is ready to ship. |
| 2 | `agent-builder` (meta agent) | — | `opus` | Builds, tunes and retires the other agents and skills. Writes their `.claude/agents/*.md` files, prompts and skill files, and improves them from what went wrong. |
| 3 | `software-architect` | — | `opus` | Owns the overall design: front-end module layout, the Functions/Blobs boundary, data flow, ADRs, and keeping the app "static + functions, nothing else". |
| 4 | `open-meteo-integrator` | — | `sonnet` | Owns the Forecast and Marine API calls, response parsing, caching and the beach-day scoring model, including its sources and thresholds. |
| 5 | `pwa-mobile-engineer` | — | `sonnet` | Makes Beach Day installable and fast on iPhone and Android: manifest, icons, service worker, offline mode, update flow, install prompts. |
| 6 | `security-engineer` | — | `opus` | Threat-models and reviews everything that touches secrets or GitHub: password gate, token scope, path allow-list, rate limits, headers/CSP, prompt-injection defenses. |
| 7 | `agent-console-engineer` | — | `opus` | Builds the Agent Console: the agent list, streaming chat via a Netlify Function calling Claude, proposals in Netlify Blobs, and Approve → GitHub commit → redeploy. |
| 8 | `ui-designer-apple-liquid-glass` | **Sable** | `sonnet` | Designs the visual layer in an Apple-inspired Liquid Glass style: translucent materials, depth, color, type and motion, while keeping it legible and accessible on the web. |
| 9 | `ux-designer-apple-hig` | **Wren** | `sonnet` | Designs flows, information architecture and interaction patterns following Apple's Human Interface Guidelines: beach picker, day verdicts, explanations, Console approval UX. |
| 10 | `qa-engineer` | — | `sonnet` | Owns test strategy and the quality gate: unit tests for scoring, Playwright end-to-end on mobile profiles, offline/SW tests, axe accessibility, Function tests. |
| 11 | `netlify-engineer` | — | `sonnet` | Owns the Netlify side: `netlify.toml`, headers and redirects, Functions config and limits, background functions, Blobs, env vars and deploy contexts, deploy previews and rollbacks. |

### Additional roles considered

All required roles are covered. I considered the roles below and **did not add them as separate agents**. An app this size doesn't need them, and adding them would mean more handoffs and more tokens for little gain.

| Considered | Covered by | Why not separate |
|---|---|---|
| Accessibility specialist | Wren (UX), Sable (UI), QA | WCAG 2.2 AA is a shared skill (below) with QA as the gate. |
| Data scientist / beach-safety analyst | `open-meteo-integrator` | The scoring model is a small, documented heuristic, not ML. |
| DevOps / release manager | `netlify-engineer` + `orchestrator` | Netlify CI/CD *is* the release pipeline; no other infra exists. |
| Technical writer | Each agent documents its own area; `orchestrator` keeps `docs/README.md` current | Docs are small and live next to the work. |
| Product manager | Dr. Lee (human) + `orchestrator` | Product decisions stay with the human lead. |
| Backend engineer | `agent-console-engineer` + `netlify-engineer` | There is no backend beyond a handful of functions. |

Revisit this if the app adds user accounts, push notifications, a native (Capacitor) build, or monetization. A *native-release engineer* would be the first addition in that case.

## 2. Agent profiles and skills

Skill IDs refer to §3. These agents are implemented in `.claude/agents/<name>.md`, and each one preloads exactly these skills through its `skills:` frontmatter. The skills themselves are in `.claude/skills/<skill-id>/SKILL.md`. Experts have `disallowedTools: Agent`, so only the orchestrator delegates, and all handoffs go through it (see `CLAUDE.md`).

### 1. `orchestrator`
**Job:** Runs the team: plans, delegates, sequences handoffs, enforces the definition of done, and reports to Dr. Lee.
**Skills:** `beach-day-context`, `team-protocol`, `change-proposal-protocol`, `claude-code-agent-authoring`, `architecture-decision-records`, `github-repo-workflow`

### 2. `agent-builder` (meta agent)
**Job:** Creates and improves agents and skills: frontmatter, system prompts, personalities, tool lists, model choice. Runs post-mortems on agent mistakes and updates prompts.
**Skills:** `beach-day-context`, `team-protocol`, `claude-code-agent-authoring`, `claude-api`, `change-proposal-protocol`

### 3. `software-architect`
**Job:** Owns system design and module boundaries, writes ADRs, and reviews every cross-cutting change for fit with "static + functions only".
**Skills:** `beach-day-context`, `architecture-decision-records`, `web-platform-vanilla`, `netlify-functions`, `netlify-config-deploy`, `netlify-blobs`, `open-meteo-apis`, `claude-api`, `secure-by-design`, `performance-budgets`, `change-proposal-protocol`

### 4. `open-meteo-integrator`
**Job:** Owns the weather and marine data layer and the beach-day score: fetch, normalize, cache, score, explain.
**Skills:** `beach-day-context`, `open-meteo-apis`, `beach-day-scoring`, `web-platform-vanilla`, `testing-vitest-playwright`, `change-proposal-protocol`

### 5. `pwa-mobile-engineer`
**Job:** Owns installability, offline support and the mobile shell on iOS Safari and Android Chrome, plus the advice on whether a Capacitor wrapper is needed.
**Skills:** `beach-day-context`, `pwa-manifest-service-worker`, `ios-android-install-behavior`, `web-platform-vanilla`, `netlify-config-deploy`, `apple-hig`, `accessibility-wcag22`, `performance-budgets`, `testing-vitest-playwright`, `change-proposal-protocol`

### 6. `security-engineer`
**Job:** Owns the threat model and reviews security-relevant changes. It can block any change that weakens the password gate, token scope, allow-list, rate limits or headers.
**Skills:** `beach-day-context`, `secure-by-design`, `agent-console-security`, `github-repo-workflow`, `netlify-functions`, `netlify-config-deploy`, `netlify-blobs`, `claude-api`, `architecture-decision-records`, `change-proposal-protocol`

### 7. `agent-console-engineer`
**Job:** Builds the Console end to end: the agents manifest, chat UI with streaming, the Claude tool loop, the proposal diff view, Approve/Reject, the GitHub commit and redeploy status.
**Skills:** `beach-day-context`, `claude-api`, `claude-code-agent-authoring`, `github-repo-workflow`, `agent-console-security`, `secure-by-design`, `netlify-functions`, `netlify-blobs`, `web-platform-vanilla`, `accessibility-wcag22`, `testing-vitest-playwright`, `change-proposal-protocol`

### 8. `ui-designer-apple-liquid-glass` — persona **Sable**
**Job:** Owns the visual design system: tokens, glass materials, color for verdicts, type scale, icons, motion. Delivers it as CSS custom properties and components.
**Personality (suggested):** Sable is calm, visual and exacting. They show two or three options side by side and won't ship glass that fails a contrast check.
**Skills:** `beach-day-context`, `liquid-glass-visual-design`, `apple-hig`, `accessibility-wcag22`, `web-platform-vanilla`, `performance-budgets`, `change-proposal-protocol`

### 9. `ux-designer-apple-hig` — persona **Wren**
**Job:** Owns flows and interaction: beach selection, today and the next few days at a glance, why a day scored the way it did, offline and error states, and the Console's approve/reject experience.
**Personality (suggested):** Wren is curious and plain-spoken and argues for the person holding the phone on a sunny beach. They cut steps and words wherever they can.
**Skills:** `beach-day-context`, `apple-hig`, `accessibility-wcag22`, `beach-day-scoring`, `ios-android-install-behavior`, `liquid-glass-visual-design`, `change-proposal-protocol`

### 10. `qa-engineer`
**Job:** Owns the test pyramid and release gate: unit, integration, end-to-end on mobile emulation, offline, accessibility and Function tests. Runs them on every deploy preview.
**Skills:** `beach-day-context`, `testing-vitest-playwright`, `accessibility-wcag22`, `beach-day-scoring`, `open-meteo-apis`, `pwa-manifest-service-worker`, `ios-android-install-behavior`, `agent-console-security`, `performance-budgets`, `change-proposal-protocol`

### 11. `netlify-engineer`
**Job:** Owns build and deploy configuration, function limits (sync, streaming, background), Blobs stores, env vars and scopes, deploy contexts, previews, rollbacks and the redeploy-on-commit path.
**Skills:** `beach-day-context`, `netlify-config-deploy`, `netlify-functions`, `netlify-blobs`, `pwa-manifest-service-worker`, `secure-by-design`, `github-repo-workflow`, `change-proposal-protocol`

## 3. Skill catalog (who shares what)

Each skill becomes one folder under `.claude/skills/<skill-id>/SKILL.md`. Skills hold the *how-to* and reference material, so each agent's system prompt can stay short. Shared skills keep the team consistent, so two agents never carry two versions of the same rule.

| Skill ID | What it contains | Shared by |
|---|---|---|
| `beach-day-context` | Product brief, the architecture decision above, glossary, links into `docs/` | **All 11 agents** |
| `change-proposal-protocol` | How any agent proposes code: small diffs, allowed paths only, tests included, summary format, never commits directly, waits for human Approve | **All 11 agents** |
| `team-protocol` | Task hand-off format, who reviews what, definition of done, escalation to Dr. Lee | orchestrator, agent-builder |
| `claude-code-agent-authoring` | `.claude/agents` frontmatter (`name`, `description`, `model`, `tools`, `skills`, custom `personality`), skill file format, prompt-writing style | agent-builder, orchestrator, agent-console-engineer |
| `claude-api` | Messages API, model IDs and aliases, adaptive thinking/effort, tool use with `strict`, streaming events, refusals/fallbacks, caching, rate/spend limits (from `docs/05-claude-api.md`) | agent-console-engineer, agent-builder, software-architect, security-engineer |
| `architecture-decision-records` | ADR template and log (`docs/adr/`), how to record trade-offs | software-architect, orchestrator, security-engineer |
| `web-platform-vanilla` | HTML/CSS/ES modules conventions, no-framework component pattern, fetch/AbortController, local state | software-architect, open-meteo-integrator, pwa-mobile-engineer, agent-console-engineer, ui-designer-apple-liquid-glass |
| `open-meteo-apis` | Forecast and Marine endpoints, variables, units, timezone, limits, attribution, sample fixtures | open-meteo-integrator, software-architect, qa-engineer |
| `beach-day-scoring` | Scoring model, thresholds with sources (UV, wind, rain, thunderstorms, waves, water temp, heat), verdict labels, the "link out" list (rip currents, flags, water quality, red tide, sargassum) | open-meteo-integrator, ux-designer-apple-hig, qa-engineer |
| `pwa-manifest-service-worker` | Manifest fields, icons and maskable icons, SW caching strategies, versioned caches, update prompt, offline page | pwa-mobile-engineer, netlify-engineer, qa-engineer |
| `ios-android-install-behavior` | iOS Add to Home Screen and Android install criteria, `beforeinstallprompt`, platform quirks, when Capacitor/TWA is warranted | pwa-mobile-engineer, ux-designer-apple-hig, qa-engineer |
| `netlify-config-deploy` | `netlify.toml`, `_headers`/`_redirects`, env vars and scopes, deploy contexts, previews, build hooks, rollbacks | netlify-engineer, software-architect, pwa-mobile-engineer, security-engineer |
| `netlify-functions` | v2 function syntax, routing via `config.path`, sync/streaming/background limits, local `netlify dev`, testing functions | netlify-engineer, agent-console-engineer, software-architect, security-engineer |
| `netlify-blobs` | `@netlify/blobs` stores for proposals, job status and rate-limit counters; consistency modes; size limits | netlify-engineer, agent-console-engineer, software-architect, security-engineer |
| `github-repo-workflow` | Fine-grained PAT scoped to this repo, Contents API vs Git Database API multi-file commits, branch/PR flow, conflict handling | agent-console-engineer, security-engineer, netlify-engineer, orchestrator |
| `secure-by-design` | Secrets handling, CSP/security headers, input validation, least privilege, logging without secrets | security-engineer, agent-console-engineer, software-architect, netlify-engineer |
| `agent-console-security` | Password gate, session cookies, path allow-list, rate limits, approval-only commits, prompt-injection defenses, audit log | security-engineer, agent-console-engineer, qa-engineer |
| `apple-hig` | Key Human Interface Guidelines: layout, navigation, touch targets, typography, feedback, platform conventions for the web | ux-designer-apple-hig, ui-designer-apple-liquid-glass, pwa-mobile-engineer |
| `liquid-glass-visual-design` | Web take on Liquid Glass: `backdrop-filter` materials, layering, tint, motion; fallbacks for `prefers-reduced-transparency`/`-motion`; contrast rules; system font stack (no bundled SF Pro, whose licence is limited to Apple platforms) | ui-designer-apple-liquid-glass, ux-designer-apple-hig |
| `accessibility-wcag22` | WCAG 2.2 AA checklist for this app: contrast, target size, focus, reflow, color-not-alone for verdicts, live regions for chat | ux-designer-apple-hig, ui-designer-apple-liquid-glass, qa-engineer, pwa-mobile-engineer, agent-console-engineer |
| `testing-vitest-playwright` | Vitest for scoring and parsing, Playwright mobile profiles, offline and SW tests, `@axe-core/playwright`, function tests, CI on deploy previews | qa-engineer, open-meteo-integrator, pwa-mobile-engineer, agent-console-engineer |
| `performance-budgets` | Page weight and Core Web Vitals targets, image/icon budgets, cost of `backdrop-filter` on low-end phones | pwa-mobile-engineer, ui-designer-apple-liquid-glass, software-architect, qa-engineer |

### Skill matrix

Columns: **Orc** orchestrator · **Meta** agent-builder · **Arch** software-architect · **OM** open-meteo-integrator · **PWA** pwa-mobile-engineer · **Sec** security-engineer · **AC** agent-console-engineer · **Sable** UI · **Wren** UX · **QA** qa-engineer · **Net** netlify-engineer

| Skill | Orc | Meta | Arch | OM | PWA | Sec | AC | Sable | Wren | QA | Net |
|---|---|---|---|---|---|---|---|---|---|---|---|
| beach-day-context | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| change-proposal-protocol | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| team-protocol | ● | ● | | | | | | | | | |
| claude-code-agent-authoring | ● | ● | | | | | ● | | | | |
| claude-api | | ● | ● | | | ● | ● | | | | |
| architecture-decision-records | ● | | ● | | | ● | | | | | |
| web-platform-vanilla | | | ● | ● | ● | | ● | ● | | | |
| open-meteo-apis | | | ● | ● | | | | | | ● | |
| beach-day-scoring | | | | ● | | | | | ● | ● | |
| pwa-manifest-service-worker | | | | | ● | | | | | ● | ● |
| ios-android-install-behavior | | | | | ● | | | | ● | ● | |
| netlify-config-deploy | | | ● | | ● | ● | | | | | ● |
| netlify-functions | | | ● | | | ● | ● | | | | ● |
| netlify-blobs | | | ● | | | ● | ● | | | | ● |
| github-repo-workflow | ● | | | | | ● | ● | | | | ● |
| secure-by-design | | | ● | | | ● | ● | | | | ● |
| agent-console-security | | | | | | ● | ● | | | ● | |
| apple-hig | | | | | ● | | | ● | ● | | |
| liquid-glass-visual-design | | | | | | | | ● | ● | | |
| accessibility-wcag22 | | | | | ● | | ● | ● | ● | ● | |
| testing-vitest-playwright | | | | ● | ● | | ● | | | ● | |
| performance-budgets | | | ● | | ● | | | ● | | ● | |

## 4. How the team works together

1. **Dr. Lee → orchestrator:** a goal ("add a 7-day view").
2. **orchestrator** splits it into tasks. Wren (flow) → Sable (visuals) → software-architect (fit) → builders (`open-meteo-integrator`, `pwa-mobile-engineer`, `agent-console-engineer`) → `qa-engineer` → `security-engineer` (if the change touches secrets, functions or headers) → `netlify-engineer` (config and deploy).
3. Every code change goes through `change-proposal-protocol`. In the deployed Agent Console that means: the agent calls `propose_change`, Dr. Lee reviews the diff and clicks **Approve**, a function commits to GitHub, and Netlify redeploys. Agents never hold the GitHub token.
4. **agent-builder** reviews failures each week (or on request) and proposes prompt or skill updates through the same approval path.

## 5. Mandatory review gates

| Change touches… | Must be reviewed by |
|---|---|
| `netlify/functions/**`, `netlify.toml`, `_headers`, env vars | security-engineer + netlify-engineer |
| Agent Console auth, allow-list, rate limits, GitHub code | security-engineer (can block) |
| Scoring thresholds or verdict wording | open-meteo-integrator + Wren |
| Visual tokens / components | Sable + accessibility check by QA |
| Service worker / manifest | pwa-mobile-engineer + QA offline test |
| `.claude/agents/**`, `.claude/skills/**` | agent-builder + orchestrator |
| Anything shipping to production | qa-engineer green on the deploy preview |
