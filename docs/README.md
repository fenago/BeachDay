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
| [0009](adr/0009-public-read-token-for-agent-reads.md) | Agent read tools use a separate public-read token, `GITHUB_READ_TOKEN`; only Approve loads the write token (would supersede 0007) | **Proposed**, awaiting Dr. Lee |
| [0010](adr/0010-diff-and-smol-toml-dependencies.md) | Two new npm dependencies: `diff` (runtime, proposal diffs) and `smol-toml` (dev, tests only), pinned exactly | **Proposed**, awaiting Dr. Lee |

## Build plan

**Status (2026-11-23, commit b828c82): v1 is built and tested locally. It is not deployed, and Approve is switched off.** Waves W0–W2 built the beach app, the How it works, Resources and Guide pages, the Agents page (Agent Console), the eight functions, the Supabase migration, `netlify.toml`, `_headers` and the build scripts. Each wave was reviewed. The seams between modules are pinned in [design/build-contracts.md](design/build-contracts.md) and machine-checked in `tests/contracts/`. How to run it, deploy it and roll it back is in the root `README.md` and [runbooks/rollback.md](runbooks/rollback.md).

**What is built** (all agent work; no agent holds a credential):

| Area | Where | Notes |
|---|---|---|
| Beach app | `public/index.html`, `public/js/{app,forecast,score,score-config}.js`, `js/api/`, `js/data/`, `js/ui/`, `js/copy/` | Calls Open-Meteo directly; no auth code (import-graph test) |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, `public/icons/`, `public/offline.html` | `sw.js` is version-stamped at build; it never caches `/api/*`, `/console`, `/vendor/*`, `/generated/*` or Supabase |
| Content pages | `public/how-it-works/`, `public/resources/`, `public/guide/` | Header and footer on every page, including the NWS line and the Open-Meteo attribution |
| Agents page | `public/console.html`, `public/js/console/*`, `public/vendor/supabase-auth-js-2.119.2.mjs` | Sign in (email or Google), TOTP, step-up, chat, jobs, proposal card, Approve sheet |
| Functions | `netlify/functions/{agents,chat,jobs,job-run,job-status,proposal,approve,reject}.mts` + `lib/` | Token and `super_admin` check first on every function; production-only for the four that read secrets |
| Supabase | `supabase/migrations/20261123000000_profiles.sql`, `supabase/manual/promote-super-admin.sql`, `supabase/README.md` | `profiles` with RLS; role changes only in the SQL editor |
| Netlify | `netlify.toml`, `public/_headers`, `scripts/{build-agents,stamp-sw,gen-config,smoke}.mjs` | No test runner in the build; the `ignore` list equals `DEPLOY_PATHS` (nine paths, D9) |

**What remains for Dr. Lee, in order:**
1. **Phase 0, by hand (credentials).** The step-by-step is in the root `README.md`:
   - **Supabase:** create the project (Free; limits and pausing **[UNVERIFIED]**). Apply the migration. Set Confirm email **and** Confirm phone on, minimum password length 12, **custom SMTP** (required: the built-in sender only mails your own team), JWT expiry 600 s, the exact Site URL and redirect URLs (docs/04 §4.5), and the Google provider with its OAuth client. Leaked-password protection is Pro-only, so it is skipped on Free.
   - **Make yourself admin:** sign up once in the Console, confirm the email, then run `supabase/manual/promote-super-admin.sql`.
   - **GitHub and Anthropic:** the fine-grained PAT (ADR-0005), the `main` ruleset (no force push, no deletion), and an Anthropic workspace with a spend limit.
   - **Netlify:** link the site. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as plain values (`GITHUB_REPO` is optional; no code reads it), and `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` as Production-only secrets. Replace `<project-ref>` in `public/_headers` (the build fails until it matches). **Turn off Deploy Previews and branch deploys.**
2. **First deploy** (15 credits), then the smoke test (`scripts/smoke.mjs`) and a rollback rehearsal.
3. **Pre-launch tests (a)–(i)** on the real project (docs/04 §4.2). Approve stays off (`approveEnabled: false`, D10) until (a)–(e), (g) and (i) pass. Switch the JWT header pre-check on (D12) only after (f).
4. **Turn Approve on:** a human edits `approveEnabled` to `true`, security-engineer reviews it, then push (15 credits).
5. **Add the CI workflow** (D11): a human copies the template named in the root `README.md` into `.github/workflows/`, with actions pinned by SHA.

**Open decisions for Dr. Lee** (each is one value in one file; see [design/build-contracts.md](design/build-contracts.md) §9):

| Decision | Built default | Where |
|---|---|---|
| ADR-0009: separate public-read token for agent reads | Not accepted; reads use `GITHUB_TOKEN` through a read-only module | `netlify/functions/lib/settings.mts` `githubReadTokenEnv` |
| ADR-0010: `diff` and `smol-toml` dependencies | Installed, pinned | `package.json` |
| D1 compute budget | 180 function-minutes per rolling 31 days (about 30 credits) | `settings.mts` `computeBudgetMinutes` |
| D4 the 403 heading | "This account can't use Agents" | `public/js/copy/copy-deck.js` id `console.noaccess.title` |
| Mandatory TOTP for `super_admin` | Recommended, not enforced (step-up requires `aal2` only if a factor exists) | Your Supabase account; enforcing it would be a `stepup.mts` change |
| D6 deny the Console UI files to agents | Not denied | `settings.mts` `denyConsoleUi` |
| Approve cap window | Rolling 31 days (ADR-0008, accepted), not the calendar month | `settings.mts` `approveCap`; a calendar month would need an ADR superseding 0008 |
| D8 measurable rain | More than 0.02 in | `public/js/score-config.js` `rain.amountInchOver` |
| D5 server-side refusal fallback model | None | `settings.mts` `serverRefusalFallback` |
| Custom SMTP provider | Required before launch; you pick the provider | Supabase dashboard |
| D3 positive reasons on good days | Off, so a Great day shows no reasons (ux-designer R16-11 recommends turning it on) | `score-config.js` `SCORE_CONFIG.reasons.positiveOnGoodDays` |
