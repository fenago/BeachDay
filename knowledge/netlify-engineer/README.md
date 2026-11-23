# netlify-engineer knowledge
Date: 2026-11-23. Notes are drawn from docs.netlify.com, cli.netlify.com and netlify.com/pricing (fetched earlier on 2026-11-23). **A later re-check the same day failed: docs.netlify.com did not resolve from the sandbox**, so anything added in the Supabase round is marked UNVERIFIED unless it is derived from the earlier fetch or from a run. The examples were run locally with Node 22.

Read everything here at the start of every task: this file first, then `docs/`, then `examples/`.

## docs/
| File | Covers | Read when |
|---|---|---|
| [docs/01-functions-v2-api-and-config.md](docs/01-functions-v2-api-and-config.md) | v2 handler signature, `Context` fields, `config` keys (`path`, `excludedPath`, `method`, `rateLimit`, `background`, `schedule`), default limits (60 s sync and stream, 30 s scheduled, 15 min background, 6 MB / 20 MB / 256 KB payloads), Node runtime, module format | Writing or reviewing any file in `netlify/functions/` |
| [docs/02-background-and-scheduled-functions.md](docs/02-background-and-scheduled-functions.md) | `202` plus discarded return value, retries after 1 and 2 min, idempotency, cron in UTC, published-deploys-only schedules, event functions | Long agent jobs (`/api/jobs-run`, which re-runs the bearer and role guard itself), pruning jobs, event functions (not used: no `deploy-succeeded`, ADR-0006) |
| [docs/03-netlify-blobs.md](docs/03-netlify-blobs.md) | `getStore`, eventual (≤60 s) vs strong consistency, exact method names and return shapes, `onlyIfNew` and `onlyIfMatch` compare-and-swap, key and store limits, local dev | Any server-side state: proposals, jobs, counters, audit |
| [docs/04-env-vars-and-secrets.md](docs/04-env-vars-and-secrets.md) | Function env rules (not from `netlify.toml`, snapshot at deploy), contexts, scopes (Pro+), Secrets Controller, secret scanning, `netlify env:set` flags, the Beach Day variable table (Supabase URL and publishable key are **not** secret), AI Gateway risk, **open question on per-context values on Free** | Env-var checklists, secret rotation, build-script reviews |
| [docs/05-netlify-toml-headers-ignore.md](docs/05-netlify-toml-headers-ignore.md) | `netlify.toml` keys and context precedence, `_headers` syntax and limits (not applied to functions), ignore-build exit codes | Changing `netlify.toml`, `public/_headers`, CSP, or skipping builds |
| [docs/06-rate-limiting.md](docs/06-rate-limiting.md) | `config.rateLimit` fields, 429 vs rewrite, 2 rules on Free, `windowSize` ≤ 180 s, about 10 s enforcement lag, deploy-log check | Adding or reviewing limits on `/api/chat` and `/api/jobs` (the two Free-plan rules) and the app counters |
| [docs/07-deploys-credits-rollbacks.md](docs/07-deploys-credits-rollbacks.md) | Credit costs (deploy 15, compute 10/GB-h, ...), the Free hard cap and site pause, rollback via Publish deploy, locking, retention, Free feature table | Credit monitoring, the rollback runbook, plan questions |

## examples/
| Folder | Shows | Status |
|---|---|---|
| [examples/01-functions-jobs-blobs/](examples/01-functions-jobs-blobs/) | `lib/guard.mjs` (bearer token + role check as the first line, 401/403/503, fail closed, stand-in verifier); `jobs.mjs` sync wrapper (guard, limits, `onlyIfNew`, one-time token hash); `job-run.mjs` background worker with CAS idempotency; `job-status.mjs`; a fake Blobs store and fake context | Ran: 14/14 pass (incl. a returned AuthRetryableFetchError maps to 503 via `adaptClaimsVerifier`). `job-run.mjs` now runs the guard itself (a background function cannot reject its caller) and checks job ownership; test 10 proves no write happens when the guard refuses. Mutation checks confirm the tests catch a missing guard, a missing role check and missing CAS. |
| [examples/02-netlify-toml-headers/](examples/02-netlify-toml-headers/) | Complete Beach Day `netlify.toml` (build = `build-agents`, `stamp-sw`, then `gen-config`, guarded `ignore`, Node pin) and `public/_headers`, plus `validate.mjs`, which parses both and runs the `ignore` command in a temporary git repo | Ran: all 57 checks pass (final CSP with the exact Supabase host placeholder and COOP), including a control that shows the naive `ignore` command skipping a first build. |
| [examples/03-cas-rate-limit-counter/](examples/03-cas-rate-limit-counter/) | Per-user daily counters in Blobs with an `onlyIfNew`/`onlyIfMatch` retry loop; `checkComputeBudget()`/`recordCompute()` for the site-wide compute budget, `checkApproveCap()` and `recordApproval()` for the ADR-0008 Approve cap (14 in a rolling 31 days, 5 per America/New_York day, one `site:approvals` record, CAS append, DST-safe day boundary); pruning | Ran: 19/19 pass (14 Approve-cap and counter tests, 5 for the site-wide compute budget `site:compute`, 180 min pending Dr. Lee). CAS admits exactly 20 of 50; the naive version admits 50 of 50; 30 parallel records lose none; the NY-day boundary is checked across both DST changes. A UTC-day mutation fails 2 tests. |
| [examples/04-sw-version-stamp/](examples/04-sw-version-stamp/) | `stamp-sw.mjs` (replaces `__BUILD_VERSION__` from `COMMIT_REF`, writes `version.json`, never prints env), `gen-config.mjs` (writes the git-ignored `public/generated/config.js`; fails the build unless the key starts with `sb_publishable_`; never echoes a value) and `smoke.mjs` (post-deploy checks, including "every sync `/api` route is 401 without a token"; `/api/jobs-run` is excluded because a background function always answers 202); gen-config also fails the build when the CSP host in `public/_headers` differs from `SUPABASE_URL`. Test fixtures build fake secrets at runtime | Ran: 12/12 pass. A mutation check (first match only) fails 4 stamp tests; removing the key checks fails a gen-config test. The smoke test ran against a local fake server only. |

## Open items, marked [UNVERIFIED] in the notes
All of these were re-checked on 2026-11-23 and **could not be settled**, because docs.netlify.com did not resolve from the sandbox (DNS failure). They are still open.
- **Per-context secret values on Free.** The pricing table says "scope environment variables per deploy context" is **not included** on Free. ADR-0005 wants `GITHUB_TOKEN` in Production only. Test on the real site (doc 04), and use "no Deploy Previews, no branch deploys" as the fallback.
- **Blobs on Free**, quota and price (doc 03).
- **Credit cost of a build skipped by `ignore`** (doc 05, doc 07). Expected 0.
- **AI Gateway** automatic provider variables and any opt-out (doc 04). Control: pass `baseURL` explicitly.
- **Fork and untrusted-deploy default** (doc 04).
- How `_headers` and `[[headers]]` merge when both set one header on one path (doc 05). Avoided by design.
- What `CACHED_COMMIT_REF` holds on a first build (doc 05). Handled by the guard.
- How a third code-based rate-limit rule is handled on Free (doc 06).
- The exact `NODE_VERSION` key (docs 01). The `deploy-succeeded` item is closed: that function is dropped (ADR-0006).
- **Whether Netlify secret scanning flags the non-secret Supabase publishable key** in `public/generated/config.js` (doc 04, example 04). Fallback: `SECRETS_SCAN_OMIT_KEYS`.

## Corrections to the repo docs found while researching
- The `ignore` command in the old docs/03 §8 (`-- public netlify`) missed `.claude/agents`, `scripts`, `netlify.toml` and the package files, **and** an unquoted `$CACHED_COMMIT_REF` skips a first build. docs/03 §3 now carries the guarded command from example 02.
- Compute is not free. At 10 credits per GB-hour, long chat turns add up (doc 07 Beach Day notes), so keep the per-user daily caps **and** the site-wide compute budget (`site:compute`, 180 function-minutes per rolling 31 days, number pending Dr. Lee).
- **Anything run in the build sees every secret on Free**, and `tests/**` is writable by agents, so `vitest` is kept out of the Netlify build command (docs/03 §9.4).
- The console password material (the login route, the password hash and cookie-signing variables, cookie sessions) was removed from these notes on 2026-11-23, when the Console moved to Supabase Auth (ADR-0006).
