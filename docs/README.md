# Beach Day — research docs

Context for the Beach Day agent team. Beach Day is an installable PWA. You pick a South Florida beach and it tells you whether today and the next few days are good beach days, using the free, keyless Open-Meteo Forecast and Marine APIs. The deployed app also contains an **Agent Console**, where you chat with the project's Claude agents and approve the code changes they propose.

**Architecture decision:** a static front end on Netlify, plus Netlify Functions for the Claude and GitHub calls, and no other servers. The browser calls Open-Meteo directly.

Researched 2026-11-23. Each doc cites its sources inline and marks unverified items **[UNVERIFIED]**.

| # | Doc | What's in it |
|---|---|---|
| 01 | [Use case & beach-day scoring](01-use-case-and-scoring.md) | User job and screens; Forecast and Marine API variables, limits, licence, gotchas; official thresholds (UV, lightning, wind, heat, rip currents, water quality, red tide, flags); the v1 scoring heuristic; beach list; hazards to link out to |
| 02 | [PWA installability](02-pwa-installability.md) | Manifest, icons, iOS and Android install behaviour, storage eviction, service worker caching and update flow, when to use Capacitor or a TWA instead |
| 03 | [Architecture on Netlify](03-architecture-netlify.md) | System diagram, repo layout, `netlify.toml`, Functions v2, limits (60 s sync/stream, 15 min background), env vars and secrets, Blobs, deploys and rollbacks, credit-based plans |
| 04 | [Agent Console](04-agent-console.md) | Flow and endpoints, threat model, password gate, fine-grained PAT, path allow-list, atomic Git Database commit on Approve, long jobs within Netlify time limits, rate limits |
| 05 | [Claude API](05-claude-api.md) | Models and IDs, mapping `.claude/agents` to API calls, Messages API, tool use (`propose_change`), streaming, refusals, errors, rate and spend limits |
| 06 | [Testing & accessibility](06-testing-accessibility.md) | Vitest and MSW, function tests, Playwright on mobile profiles and offline, axe, WCAG 2.2 AA for this app, ARIA for streaming chat, CI with Deploy Previews |
| — | [Expert roster](expert-roster.md) | The 11 agents, their jobs, the 22 shared skills and who shares them, review gates |

## Key findings at a glance

- **Call Open-Meteo from the browser.** It is keyless and supports CORS, and Open-Meteo warns that requests from Netlify-style hosts get rate-limited early. Free use means non-commercial and under 10k calls a day, with CC BY 4.0 attribution shown next to the data.
- **Marine data is offshore and coarse (about 8 km).** It can snap a beach out into the Gulf Stream. Use a hand-picked marine point for each beach, and label wave figures as offshore.
- **Some hazards aren't in Open-Meteo:** rip currents, beach flags, water quality, red tide, sargassum. The app should link out for these. NWS Miami publishes a beach-forecast GeoJSON, but whether the browser can fetch it (CORS) is unverified.
- **iOS has no install prompt,** so the app shows its own "Add to Home Screen" hint. Since iOS 26, every site added to the Home Screen opens as a web app. Chrome's automatic install prompt still wants a real `fetch` handler in the service worker.
- **Netlify Functions stop at 60 s,** for both sync and streaming responses. Background functions run up to 15 min and also work on the Free plan. Long agent jobs run in the background and the Console polls their status in Blobs.
- **Netlify's site password requires the Pro plan** and doesn't protect functions anyway, so the Console's password gate is checked inside the functions.
- **Free plan budget:** 300 credits a month, about 20 production deploys. Every approved change is a deploy, so the design bundles a change into one atomic commit and skips deploys for docs-only commits.
- **Fine-grained PATs can't be limited to file paths,** so the allow-list is enforced in the approve function, and the token gets no Workflows permission.
- **Claude API changes on current models:** `budget_tokens` and `thinking: disabled` are rejected, so is forced `tool_choice`, and assistant prefill is no longer allowed. Use adaptive thinking, an explicit effort level, `strict` tools, and handle refusals.
- **Accessibility:** verdicts never rely on colour alone. Tap targets are 44 px, text over glass is checked for contrast, and the chat log uses `role="log"` with `aria-busy` while a reply streams.

## Decisions (recorded in [adr/](adr/))

| ADR | Decision |
|---|---|
| [0001](adr/0001-static-site-plus-functions.md) | Static front end on Netlify + Netlify Functions for Claude and GitHub only; no other servers; browser calls Open-Meteo directly |
| [0002](adr/0002-no-rip-current-proxy.md) | No rip-current proxy — link out to the National Weather Service |
| [0003](adr/0003-approve-commits-to-main.md) | Approve commits straight to `main` (one atomic commit per proposal) |
| [0004](adr/0004-netlify-free-plan.md) | Stay on the Netlify Free plan for now |
| [0005](adr/0005-fine-grained-pat.md) | GitHub access via a fine-grained personal access token scoped to this repo |
