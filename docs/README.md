# Beach Day — research docs

Context for the Beach Day agent team. Beach Day is an installable PWA. You pick a South Florida beach and it tells you whether today and the next few days are good beach days, using the free, keyless Open-Meteo Forecast and Marine APIs. The deployed app also contains an **Agent Console**, where you chat with the project's Claude agents and approve the code changes they propose.

**Architecture decision (ADR-0006, which superseded ADR-0001):** a static front end on Netlify, plus Netlify Functions for the Claude and GitHub calls, and no other servers. The browser calls Open-Meteo directly. The Console page also calls **Supabase Auth** directly, for sign-in only; Supabase holds just the users and a `profiles` role table.

Researched 2026-11-23. Each doc cites its sources inline and marks unverified items **[UNVERIFIED]**.

| # | Doc | What's in it |
|---|---|---|
| 01 | [Use case & beach-day scoring](01-use-case-and-scoring.md) | User job and screens; Forecast and Marine API variables, limits, licence, gotchas; official thresholds (UV, lightning, wind, heat, rip currents, water quality, red tide, flags); the v1 scoring heuristic; beach list; hazards to link out to |
| 02 | [PWA installability](02-pwa-installability.md) | Manifest, icons, iOS and Android install behaviour, storage eviction, service worker caching and update flow, when to use Capacitor or a TWA instead |
| 03 | [Architecture on Netlify](03-architecture-netlify.md) | System diagram, repo layout, `netlify.toml`, Functions v2, limits (60 s sync/stream, 15 min background), env vars and secrets, Blobs, deploys and rollbacks, credit-based plans |
| 04 | [Agent Console](04-agent-console.md) | Flow, endpoints and shared contracts (IDs, proposal statuses, SSE events), threat model, Supabase Auth and roles, fine-grained PAT, the canonical path allow/deny list, atomic Git Database commit on Approve, long jobs within Netlify time limits, rate limits and the Approve cap |
| 05 | [Claude API](05-claude-api.md) | Models and IDs, mapping `.claude/agents` to API calls, Messages API, tool use (`propose_change`), streaming, refusals, errors, rate and spend limits |
| 06 | [Testing & accessibility](06-testing-accessibility.md) | Vitest and MSW, function tests, Playwright on mobile profiles and offline, axe, WCAG 2.2 AA for this app, ARIA for streaming chat, CI with Deploy Previews |
| — | [Expert roster](expert-roster.md) | The agents, their jobs, the shared skills and who shares them, review gates |

## Key findings at a glance

- **Call Open-Meteo from the browser.** It is keyless and supports CORS, and Open-Meteo warns that requests from Netlify-style hosts get rate-limited early. Free use means non-commercial and under 10k calls a day, with CC BY 4.0 attribution shown next to the data.
- **Marine data is offshore and coarse (about 8 km).** It can snap a beach out into the Gulf Stream. Use a hand-picked marine point for each beach, and label wave figures as offshore.
- **Some hazards aren't in Open-Meteo:** rip currents, beach flags, water quality, red tide, sargassum. The app should link out for these. NWS Miami publishes a beach-forecast GeoJSON, but whether the browser can fetch it (CORS) is unverified.
- **iOS has no install prompt,** so the app shows its own "Add to Home Screen" hint. Since iOS 26, every site added to the Home Screen opens as a web app. Chrome's automatic install prompt still wants a real `fetch` handler in the service worker.
- **Netlify Functions stop at 60 s,** for both sync and streaming responses. Background functions run up to 15 min and also work on the Free plan. Long agent jobs run in the background and the Console polls their status in Blobs.
- **Netlify's site password requires the Pro plan** and doesn't protect functions anyway. So the Console uses **Supabase Auth** (ADR-0006): every function verifies the caller's bearer token **and** checks `role = super_admin` on every request, and fails closed. Only the project URL and the publishable key are used; the secret/service_role key is used nowhere.
- **Free plan budget:** 300 credits a month, about 20 production deploys. Every approved change is a deploy, so each proposal is one atomic commit, Approve is capped site-wide at 14 per rolling 31 days and 5 per day (ADR-0008), and docs-only commits should skip deploys.
- **Fine-grained PATs can't be limited to file paths,** so the allow-list is enforced in the approve function, and the token gets no Workflows permission.
- **Claude API changes on current models:** `budget_tokens` and `thinking: disabled` are rejected, so is forced `tool_choice`, and assistant prefill is no longer allowed. Use adaptive thinking, an explicit effort level, `strict` tools, and handle refusals.
- **Accessibility:** verdicts never rely on colour alone. Tap targets are 44 px, text over glass is checked for contrast, and the chat log uses `role="log"` with `aria-busy` while a reply streams.

## Decisions (recorded in [adr/](adr/))

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-static-site-plus-functions.md) | Static front end + Netlify Functions for Claude and GitHub only; browser calls Open-Meteo directly | Superseded by 0006 |
| [0002](adr/0002-no-rip-current-proxy.md) | No rip-current proxy — link out to the National Weather Service | Accepted |
| [0003](adr/0003-approve-commits-to-main.md) | Approve commits straight to `main` (one atomic commit per proposal) | Accepted |
| [0004](adr/0004-netlify-free-plan.md) | Stay on the Netlify Free plan for now (its "password gate" consequence is outdated since 0006) | Accepted |
| [0005](adr/0005-fine-grained-pat.md) | GitHub access via a fine-grained personal access token scoped to this repo | Accepted |
| [0006](adr/0006-supabase-auth-for-console.md) | Supabase Auth for the Console: browser → Supabase Auth directly; every function checks Bearer token + `super_admin` role and fails closed; publishable key only; vendored `@supabase/auth-js`; restates the 0001 boundary | Accepted |
| [0007](adr/0007-agent-reads-from-github-main.md) | Agents' `read_file` / `list_files` read from GitHub `main`, pinned to one SHA per turn | Accepted |
| [0008](adr/0008-site-wide-approve-cap.md) | Approve cap, site-wide: 14 per rolling 31 days, 5 per day | Accepted |

## Build plan

Nothing is built yet. This round changed only docs, ADRs, agents, skills and knowledge. Each phase ends with QA green on the `main` deploy and a rollback ready (ADR-0003). Push in batches, because every push to `main` costs 15 credits.

**Phase 0: Dr. Lee, by hand (no agent can do these; they hold credentials)**
1. **Create the Supabase project** (Free plan; confirm limits and inactivity pausing on https://supabase.com/pricing **[UNVERIFIED]**). Note the project URL and the **publishable** key (`sb_publishable_…`). Do not copy the secret or service_role key anywhere.
2. **Google sign-in:** in Google Cloud, create an OAuth client (type "Web application") with the Supabase callback URL that the Google provider page shows as the authorised redirect URI. Then enable the Google provider in Supabase Auth with that client ID and secret. The Google client secret lives only in Supabase, never in Netlify or the repo.
3. **URLs:** set the Supabase Auth **Site URL** to the production URL. Add only the exact production Console URLs, such as `https://<site>.netlify.app/console`, to the **redirect URL allow-list**. Avoid broad wildcards; security-engineer sets the final list in docs/04 §4.
4. **Email:** turn on **email confirmation** and **leaked-password protection** (if the latter needs a paid plan, record that **[UNVERIFIED]**). Set the minimum password rules security-engineer specifies.
5. **Run the profiles SQL** from `knowledge/supabase-auth-engineer/`: the `profiles` table (`id` references `auth.users` on delete cascade, `role` defaults to `'user'`), the trigger that creates the row on sign-up, and RLS that lets a user read only their own row and never change `role`.
6. **Sign up once in the Console, then make yourself admin** in the Supabase SQL editor: `update public.profiles set role = 'super_admin' where id = '<your auth user id>';`. Nobody else can set this.
7. **Netlify env:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `GITHUB_REPO` as plain values. `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` as secrets (`GITHUB_TOKEN` Production-only if Free allows it; see docs/03). Delete the two old Console-password variables listed in ADR-0006 §7, if they were ever set.
8. Create the fine-grained PAT (ADR-0005), the Anthropic workspace with a spend limit, and the `main` ruleset (no force push, no deletion).

**Phase 1: platform skeleton** (netlify-engineer, then security-engineer review)
- `netlify.toml`, `public/_headers` (CSP including the Supabase origin for `connect-src`), and the `ignore` rule.
- The build script that writes `public/generated/config.js` and `public/generated/version.json`, stamps `sw.js`, and never prints env.
- The vendored `public/vendor/supabase-auth-js-<version>.mjs`, committed by a human.

**Phase 2: beach app, in parallel** (open-meteo-integrator, pwa-mobile-engineer, ui and ux designers)
- `public/js/app.js`, `api/openmeteo.js`, `score.js` and `score-config.js`, the views, the manifest and `sw.js`. No auth code.

**Phase 3: Console auth** (agent-console-engineer and supabase-auth-engineer; security-engineer can block)
- The sign-up, log-in, log-out, reset and Google flows in `console.html`.
- The shared `requireAuth` (token + role, fail closed) used first in every function.
- 401/403/503 tests on every function.

**Phase 4: Console features** (agent-console-engineer)
- `/api/agents`, `/api/chat` (SSE contract in docs/04 §2.1), `/api/jobs` + `/api/jobs-run`, the read tools from GitHub `main` (ADR-0007), proposals, and Approve with the cap (ADR-0008) and step-up.

**Phase 5: release gate** (qa-engineer, then security-engineer)
- The full test plan in docs/06, a post-deploy smoke test, and rollback rehearsed.
