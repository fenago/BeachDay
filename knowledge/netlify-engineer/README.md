# netlify-engineer knowledge
Date: 2026-11-23. Notes are drawn from docs.netlify.com, cli.netlify.com and netlify.com/pricing (fetched 2026-11-23). The examples were run locally with Node 22.

Read everything here at the start of every task: this file first, then `docs/`, then `examples/`.

## docs/
| File | Covers | Read when |
|---|---|---|
| [docs/01-functions-v2-api-and-config.md](docs/01-functions-v2-api-and-config.md) | v2 handler signature, `Context` fields, `config` keys (`path`, `excludedPath`, `method`, `rateLimit`, `background`, `schedule`), default limits (60 s sync and stream, 30 s scheduled, 15 min background, 6 MB / 20 MB / 256 KB payloads), Node runtime, module format | Writing or reviewing any file in `netlify/functions/` |
| [docs/02-background-and-scheduled-functions.md](docs/02-background-and-scheduled-functions.md) | `202` plus discarded return value, retries after 1 and 2 min, idempotency, cron in UTC, published-deploys-only schedules, event functions | Long agent jobs, pruning jobs, the `deploy-succeeded` handler |
| [docs/03-netlify-blobs.md](docs/03-netlify-blobs.md) | `getStore`, eventual (≤60 s) vs strong consistency, exact method names and return shapes, `onlyIfNew` and `onlyIfMatch` compare-and-swap, key and store limits, local dev | Any server-side state: proposals, jobs, counters, audit |
| [docs/04-env-vars-and-secrets.md](docs/04-env-vars-and-secrets.md) | Function env rules (not from `netlify.toml`, snapshot at deploy), contexts, scopes (Pro+), Secrets Controller, secret scanning, `netlify env:set` flags, **open question on per-context values on Free** | Env-var checklists, secret rotation, build-script reviews |
| [docs/05-netlify-toml-headers-ignore.md](docs/05-netlify-toml-headers-ignore.md) | `netlify.toml` keys and context precedence, `_headers` syntax and limits (not applied to functions), ignore-build exit codes | Changing `netlify.toml`, `public/_headers`, CSP, or skipping builds |
| [docs/06-rate-limiting.md](docs/06-rate-limiting.md) | `config.rateLimit` fields, 429 vs rewrite, 2 rules on Free, `windowSize` ≤ 180 s, about 10 s enforcement lag, deploy-log check | Adding or reviewing limits on `/api/login` and `/api/chat` |
| [docs/07-deploys-credits-rollbacks.md](docs/07-deploys-credits-rollbacks.md) | Credit costs (deploy 15, compute 10/GB-h, ...), the Free hard cap and site pause, rollback via Publish deploy, locking, retention, Free feature table | Credit monitoring, the rollback runbook, plan questions |

## examples/
| Folder | Shows | Status |
|---|---|---|
| [examples/01-functions-jobs-blobs/](examples/01-functions-jobs-blobs/) | `login.mjs` (path, method, rateLimit, own security headers, signed cookie); `job-run.mjs` background function plus `job-status.mjs`, with job state in Blobs and CAS idempotency; a fake Blobs store and fake context | Ran: 8/8 tests pass. A mutation check confirms the retry test catches missing CAS. |
| [examples/02-netlify-toml-headers/](examples/02-netlify-toml-headers/) | Complete Beach Day `netlify.toml` and `public/_headers`, plus `validate.mjs`, which parses both and runs the `ignore` command in a temporary git repo | Ran: all 32 checks pass. A negative check also works. |
| [examples/03-cas-rate-limit-counter/](examples/03-cas-rate-limit-counter/) | A daily per-session counter in Blobs with an `onlyIfNew`/`onlyIfMatch` retry loop, a concurrency test, and pruning | Ran: 5/5 pass. CAS admits exactly 20 of 50; the naive version admits 50 of 50. |

## Open items, marked [UNVERIFIED] in the notes
- **Per-context secret values on Free.** The pricing table says "scope environment variables per deploy context" is **not included** on Free. The Secrets Controller says secrets need explicit contexts, and ADR-0005 wants `GITHUB_TOKEN` in Production only. Test this on the real site and escalate to Dr. Lee if it fails (doc 04).
- **Blobs quota and price** on Free (doc 03).
- How two `_headers` rules that set the same header on one path are merged (doc 05). Our file avoids this case.
- How a third code-based rate-limit rule is handled on Free (doc 06).
- How to pin the build's Node version (doc 01).

## Corrections to the repo docs found while researching
- The `ignore` command in docs/03 §8 (`-- public netlify`) misses `.claude/agents`, `scripts`, `netlify.toml` and the package files. An agent-only change would be skipped, and the Console would keep showing stale agents. Use the command in example 02.
- Compute is not free. At 10 credits per GB-hour, long chat turns add up (doc 07 Beach Day notes), so keep the per-session daily caps.
