---
name: netlify-config-deploy
description: Netlify build and deploy configuration for Beach Day — netlify.toml, _headers, environment variables and secrets on the Free plan, deploy contexts, previews, ignore builds, the service-worker version stamp, credits and rollbacks. Use when changing build, headers, env vars or deploy behavior.
---
# Netlify config & deploy (details: docs/03 §3, §6, §8, §9, §10)

There is **no `netlify.toml` in the repo yet**. docs/03 §3 is the spec, with a tested copy in `knowledge/netlify-engineer/examples/02-netlify-toml-headers/`. `netlify.toml` and `scripts/**` are denied to agents, so a human adds them.

## netlify.toml
```toml
[build]
  command = "node scripts/build-agents.mjs && node scripts/stamp-sw.mjs && node scripts/gen-config.mjs"
  publish = "public"
  ignore = '[ -n "$CACHED_COMMIT_REF" ] && git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- public netlify netlify.toml package.json package-lock.json scripts .claude/agents || exit 1'
  [build.environment]
    NODE_VERSION = "22"
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  included_files = ["netlify/functions/lib/agents.json"]
```
- **The `ignore` command** exits 0 to skip a build and 1 to build. It runs under Bash with no npm dependencies. It is a **whitelist of what the build reads or publishes**: docs-only, knowledge-only, tests-only, skills-only and root-Markdown commits skip. A new top-level folder the build reads must be added to the list.
- **Keep the `-n` guard and `|| exit 1`.** Without them, an empty `CACHED_COMMIT_REF` makes git compare the working tree with `COMMIT_REF`, exit 0 and skip the first build.
- **A skipped build is expected to cost 0 credits. That is UNVERIFIED**; check the Usage page after the first skip.
- **No `vitest` in the build command.** On Free, builds see every secret, and `tests/**` is agent-writable. Tests run in QA's gate (docs/03 §9.4).
- **Env vars:** variables set in `netlify.toml` are **not** visible to functions. Set them in the UI or CLI.
- **Contexts** (`[context.production]`, `[context.deploy-preview]`, `[context.branch-deploy]`) exist but nothing needs them today.

## Build steps, the service worker and the browser config
- **`scripts/stamp-sw.mjs`** replaces every `__BUILD_VERSION__` in `public/sw.js` with the first 12 hex of `COMMIT_REF` (fallback: `git rev-parse HEAD`, then a timestamp) and writes `public/version.json` (`{version, commit, builtAt}`). Without it, sw.js never changes and phones never update.
- It prints **one line** and never prints env. It exits 1 if the placeholder is missing, and it refuses to run outside Netlify unless `--force`.
- **"Live"** in the Console = `/version.json.commit` equals the approved commit. The Console polls `/version.json` (`no-store`, never cached by the service worker). **There is no `deploy-succeeded` function** (ADR-0006 point 8). A build skipped by `ignore` never goes Live.
- **After each Approve deploy,** run the smoke test (`scripts/smoke.mjs`): sw.js has no placeholder and is no-cache, version matches, every `/api` route is 401 without a token. The service-worker kill switch is in docs/03 §9.3.
- **`scripts/gen-config.mjs`** (last step, ADR-0006) writes the **git-ignored** `public/generated/config.js` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `BUILD_VERSION`) from env vars read **by name**. It **fails the build unless the key starts with `sb_publishable_`** (this catches a pasted `sb_secret_` key and legacy JWT keys) and the URL is a bare https origin. It never echoes a rejected value. Tested copy: `knowledge/netlify-engineer/examples/04-sw-version-stamp/`. Previews and branch deploys need both variables too, or their builds fail (0 credits).
- **Whether secret scanning flags the publishable key in `config.js` is UNVERIFIED.** The first real deploy is the test. Fallback: `SECRETS_SCAN_OMIT_KEYS=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY`. Do not turn scanning off.
- **`.gitignore` must list** `public/generated/`, `public/version.json` and `netlify/functions/lib/agents.json` (all build output). Agents cannot edit `public/vendor/**`, `public/generated/**` or `public/version.json`.
- **`public/vendor/`** holds the vendored, pinned, auth-only `supabase-auth-js-<version>.mjs` (ADR-0006), committed by a human. It is covered by the `public` entry in `ignore`, and `script-src 'self'` needs no change.
- The three build scripts read only `COMMIT_REF`, `NETLIFY` and (gen-config) the two Supabase variables, and `build-agents.mjs` treats agent files as data (parse, never execute).

## Headers
- **One place: `public/_headers`.** No `[[headers]]` in `netlify.toml`. The merge rule for both is UNVERIFIED, so we never let two rules set the same header on one path.
- Set CSP (with `form-action 'self'`), `nosniff`, Referrer-Policy, Permissions-Policy, plus `/sw.js` no-cache, the manifest content type and `/version.json` no-store.
- `public/_headers` and `public/sw.js` are denied to agents. Changes need security-engineer review.
- **Custom headers do not apply to function responses.** Every function sets its own headers.
- **CSP:** `connect-src` lists `'self'`, the two Open-Meteo hosts, and (once the project exists) the Supabase project host. The final policy and how supabase-js is loaded are security-engineer's and software-architect's (ADR-0006).

## Env vars & secrets (Free plan, ADR-0004, ADR-0005)
| Var | Secret | Context |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Production |
| `GITHUB_TOKEN` | yes | **Production only** |
| `GITHUB_REPO=fenago/BeachDay` | no | all |
| `SUPABASE_URL` | **no** | all |
| `SUPABASE_PUBLISHABLE_KEY` | **no** | all |

- **Do not mark the two Supabase values secret.** They are public by design, and secret scanning would fail any build whose output contains them.
- **The Supabase secret / `service_role` key is used nowhere.** Never set it in Netlify.
- **CLI:** `netlify env:set NAME value --context production --secret`, `netlify env:list --context production`. Dr. Lee runs these; agents never see values.
- **Free plan:** there are no scopes (Pro+), so builds can see secret env vars. Build scripts must never print env, and nothing agent-writable runs during the build.
- **Per-context values on Free are UNVERIFIED.** Test with `env:set --context production`, then `env:list --context deploy-preview`. Fallback: turn off Deploy Previews and branch deploys.
- **Secret scanning** fails a build if a secret value appears in the repo or build output.
- **AI Gateway** may inject AI-provider variables. Pass `baseURL` and `apiKey` to the Anthropic SDK explicitly (UNVERIFIED opt-out).
- After rotating a secret, **trigger a new deploy**: functions keep the old value until then.

## Deploys
- **No Netlify site is linked yet** (Dr. Lee, 2026-11-23), so a push to `main` costs 0 credits for now. Everything below applies once a site is linked.
- **Pushing to `main`** creates a production deploy. Deploys are atomic, and Approve commits to `main` (ADR-0003).
- **Credits:** each successful production deploy costs **15**. The Free plan has **300 per month**, a hard cap, and projects pause at 0. The Approve cap (ADR-0008: 14 in a rolling 31 days, 5 a day) is at most 210 credits in any billing cycle, exactly 70%. Tell the orchestrator at about 70% and at 90%.
- **Deploy Previews** are built for PRs and cost 0. QA runs on the main deploy with a rollback ready (ADR-0003); previews are not on the Approve path.
- **Rollback:** Deploys → pick the previous deploy → **Publish deploy**. It is instant, needs no rebuild and costs 0. Then **Lock to stop auto publishing**, or the next push overwrites it.
- **Build hooks** (`POST https://api.netlify.com/build_hooks/<id>`) are for manual redeploys only.

## Local
- `netlify link`, then `netlify dev` (port 8888) for the site plus functions.
- `netlify deploy` creates a draft. **Never `--prod`**: `main` deploys automatically.
