---
name: netlify-config-deploy
description: Netlify build and deploy configuration for Beach Day — netlify.toml, _headers, environment variables and secrets on the Free plan, deploy contexts, previews, ignore builds, credits and rollbacks. Use when changing build, headers, env vars or deploy behavior.
---
# Netlify config & deploy (details: docs/03 §3, §6, §8, §9)

## netlify.toml
```toml
[build]
  command = "node scripts/build-agents.mjs"
  publish = "public"
  ignore  = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- public netlify scripts .claude netlify.toml package.json"
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  included_files = ["netlify/functions/lib/agents.json"]
```
- **The `ignore` command** exits 0 to skip a build. It runs with Bash or Node 18 and has no npm dependencies available. It saves credits on docs-only commits.
- **Context overrides:** `[context.production]`, `[context.deploy-preview]`, `[context.branch-deploy]`.
- **Env vars:** variables set in `netlify.toml` are **not** visible to functions. Set secrets in the UI or CLI.

## Headers
- Static headers go in `public/_headers` (or `[[headers]]` in the toml). Set CSP, `nosniff`, Referrer-Policy and Permissions-Policy, plus the `sw.js` no-cache and manifest content-type rules.
- **Custom headers do not apply to function responses.** Every function sets its own headers.
- The CSP `connect-src` must list `'self' https://api.open-meteo.com https://marine-api.open-meteo.com`.

## Env vars & secrets (Free plan — ADR-0004)
| Var | Notes |
|---|---|
| `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `CONSOLE_PASSWORD_HASH`, `SESSION_SECRET` | Mark **Contains secret values**. Set `GITHUB_TOKEN` in the **Production context only**. |
| `GITHUB_REPO=fenago/BeachDay` | Plain value |

- **CLI:** `netlify env:set NAME value --context production --secret`, `netlify env:list --context production`.
- **Free plan:** there are no scopes, so builds can see secret env vars. Build scripts must never print env.
- **Secret scanning** fails a build if a secret value appears in the repo or build output.

## Deploys
- **Pushing to `main`** creates a production deploy. Deploys are atomic, and Approve commits to `main` (ADR-0003).
- **Credits:** each production deploy costs **15 credits**. The Free plan has **300 per month**, a hard cap, and projects pause at 0. Track usage, and tell the orchestrator at about 70%.
- **Deploy Previews** are built for PRs (`deploy-preview-N--site.netlify.app`, noindex). Branch deploys are optional.
- **Rollback:** Deploys → pick the previous deploy → **Publish deploy**. It is instant and needs no rebuild. "Lock to stop auto publishing" freezes production.
- **Build hooks** (`POST https://api.netlify.com/build_hooks/<id>`) are for manual redeploys only.

## Local
- `netlify link`, then `netlify dev` (port 8888) for the site plus functions.
- `netlify deploy` creates a draft. `--prod` deploys to production; avoid it, because `main` deploys automatically.
