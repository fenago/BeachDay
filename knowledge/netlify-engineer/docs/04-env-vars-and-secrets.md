# Environment variables, contexts and the Secrets Controller
Source: https://docs.netlify.com/build/functions/environment-variables/ , https://docs.netlify.com/build/environment-variables/overview/ , https://docs.netlify.com/build/environment-variables/get-started/ , https://docs.netlify.com/build/environment-variables/secrets-controller/ , https://cli.netlify.com/commands/env/ , https://www.netlify.com/pricing/
Retrieved: 2026-11-23

## Variables in functions
- Read them with `process.env.NAME`. [functions env](https://docs.netlify.com/build/functions/environment-variables/)
- **Variables declared in `netlify.toml` are not available to serverless functions.** Set function variables in the UI, CLI or API. [functions env](https://docs.netlify.com/build/functions/environment-variables/)
- **Deploy-time snapshot:** "Each deploy ... uses the environment variable values that were set at the time of deployment. To apply updated environment variable values, create a new deploy." [functions env](https://docs.netlify.com/build/functions/environment-variables/)
- **Read-only variables at function runtime:** only `URL`, `SITE_NAME` and `SITE_ID`. They are reserved and can't be overridden. [functions env](https://docs.netlify.com/build/functions/environment-variables/)
- **Lambda compatibility mode only:** the total size of all variables must be under **4 KB**. Modern v2 functions don't have this limit. [functions env](https://docs.netlify.com/build/functions/environment-variables/)
- **AI Gateway:** on credit-based plans, variables for common AI providers are set automatically unless you bring your own keys. [functions env](https://docs.netlify.com/build/functions/environment-variables/)

## Keys, values, precedence
- **Keys:**
  - Letters, digits and `_` only, and they must start with a letter.
  - At most **255 characters**.
- **Values:** at most **5,000 characters**.
- [overview § limitations](https://docs.netlify.com/build/environment-variables/overview/)
- **Precedence:**
  - `netlify.toml` values override UI, CLI and API values with the same key.
  - Site variables override shared (team) variables.
  - Between deploy contexts, the context precedence rules apply.
  - [overview § overrides](https://docs.netlify.com/build/environment-variables/overview/)

## Deploy contexts for values
`Production`, `Deploy Previews`, `Branch deploys`, `Preview server`, `Local development`, plus a `Branch` value for a named branch (wildcard suffix allowed, for example `release/*`). [overview](https://docs.netlify.com/build/environment-variables/overview/)

## Scopes (Pro and Enterprise only)
- Scopes are **Builds**, **Functions**, **Runtime** (forms and signed proxy redirects) and **Post processing** (snippet injection).
- By default a variable applies to all scopes.
- [overview § scopes](https://docs.netlify.com/build/environment-variables/overview/#scopes)
- On **Free**, you can't choose scopes, so every variable is also visible to the build. [pricing](https://www.netlify.com/pricing/)

## Secrets Controller
- **Plans:** the pricing page lists "Secrets controller" as Included on **Free**, Personal, Pro and Enterprise. [pricing](https://www.netlify.com/pricing/)
- **Policy for secret variables** ([secrets controller](https://docs.netlify.com/build/environment-variables/secrets-controller/)):
  - Values are **write-only**. Once set, you can't read them back in a readable form.
  - They "must be set to explicit deploy contexts and scopes".
  - The secret flag **can't be removed** once set.
  - They can't have the **post processing** scope.
  - Only code running on Netlify (functions, edge functions, builds) sees the unmasked value. The UI, CLI and API return unmasked values only for the `dev` context. `netlify build` run locally does not receive them.
  - The `Local development` context values cannot be marked secret. [overview](https://docs.netlify.com/build/environment-variables/overview/)
- **How to mark a secret:** tick **Contains secret values** in the UI, or use the CLI `--secret` flag. [secrets controller](https://docs.netlify.com/build/environment-variables/secrets-controller/)
- **Secret scanning** ([secrets controller](https://docs.netlify.com/build/environment-variables/secrets-controller/)):
  - Netlify scans repository code **and build output** for the values of secret variables before publishing.
  - A match **fails the build**, and the deploy log shows where it was found.
  - Only values longer than 4 characters that aren't booleans are scanned.
  - Tuning variables:
    - `SECRETS_SCAN_ENABLED` (default `true`)
    - `SECRETS_SCAN_OMIT_KEYS`
    - `SECRETS_SCAN_OMIT_PATHS`
  - **Smart detection** finds secrets that aren't in your variables. It runs on Personal, Pro and Enterprise only, **not Free** ([pricing](https://www.netlify.com/pricing/)). Its controls are `SECRETS_SCAN_SMART_DETECTION_ENABLED` and `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES`.
- **Untrusted deploys** (public repos, forks): the "Build without sensitive variables" policy withholds secret variables, plus variables auto-detected as sensitive by name (`PASSWORD`, `TOKEN`, `SECRET`, `API_KEY`) or by value. [get started](https://docs.netlify.com/build/environment-variables/get-started/)

## CLI (`netlify env:*`)
From the [CLI reference](https://cli.netlify.com/commands/env/):
```bash
netlify env:set VAR_NAME value                         # all contexts and scopes
netlify env:set VAR_NAME value --context production
netlify env:set VAR_NAME value --context production deploy-preview
netlify env:set VAR_NAME value --context branch:feat/x
netlify env:set VAR_NAME value --context production --secret
netlify env:set VAR_NAME value --scope builds functions  # scopes: Pro+
netlify env:set VAR_NAME --secret                        # convert existing var to secret
netlify env:unset VAR_NAME --context production
netlify env:list --plain --context production            # .env format; secrets stay masked
```
- `--context` takes `production`, `deploy-preview`, `branch-deploy`, `dev` or `branch:<name>`. The default is all contexts.
- `--scope` takes `builds`, `functions`, `post-processing` or `runtime`. The default is all scopes.

## Conflict to resolve: per-context values on Free
- The pricing table marks **"Scope environment variables per deploy context … i.e. staging vs. production"** as **Not included** on Free and Personal. [pricing](https://www.netlify.com/pricing/)
- The Secrets Controller, which is included on Free, says secret values **must** be set to explicit deploy contexts. ADR-0005 asks for `GITHUB_TOKEN` in **Production only**.
- **[UNVERIFIED, still open on 2026-11-23]** Whether a Free-plan site can set `--context production` for a secret. Re-check attempted today; docs.netlify.com was unreachable from the sandbox, and no Netlify account is used here, so it was not tested. Run `netlify env:set GITHUB_TOKEN <value> --context production --secret` once on the real site, then `netlify env:list --context deploy-preview` and confirm the token is absent. If it is refused, raise it with Dr. Lee.
- **Required, not just a fallback** (decided by security-engineer, docs/04 §4.6; the setting's name and Free availability are **[UNVERIFIED]**): in the site's build settings, set Deploy Previews and Branch deploys to **none**. ADR-0003 commits straight to `main` and QA now runs on the main deploy, so previews are not used. With no non-production deploy, no non-production function can read the token. The setting's name and location were not re-read.
- **Untrusted deploys** (forks of a public repo; this repo is public): keep the "Build without sensitive variables" policy so a fork's pull request build never gets secrets. The default for a new site is **[UNVERIFIED]**; Dr. Lee should look at the setting once.

## AI Gateway can set Anthropic variables by itself
- The functions env page says that on credit-based plans, variables for common AI providers are set automatically unless you bring your own keys ([functions env](https://docs.netlify.com/build/functions/environment-variables/)).
- Risk: an automatic `ANTHROPIC_BASE_URL` (the Anthropic SDK reads it from the environment) would route Claude calls through Netlify's gateway and bill credits ($1 = 180 credits) instead of using Dr. Lee's key and spend limit. Which variables Netlify injects, and whether Free has an opt-out, are **[UNVERIFIED]**.
- **Control that needs no verification:** the chat function passes `baseURL: "https://api.anthropic.com"` and `apiKey: process.env.ANTHROPIC_API_KEY` to the SDK explicitly, and never lets the environment choose the endpoint. Set `ANTHROPIC_API_KEY` ourselves (the page says own keys are respected). After the first chat, compare the Anthropic console's usage with Netlify's usage page: they should show Anthropic spend and **no** AI-inference credits.

## Beach Day notes
| Variable | Secret | Context | Read by |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Production | `chat` and `jobs-run` (the two functions that call Claude) |
| `GITHUB_TOKEN` | yes | **Production only** (ADR-0005) | `approve` (writes). Under ADR-0007 as it stands, the read tools in `chat` and `jobs-run` also use it, through a read-only module |
| `GITHUB_READ_TOKEN` | yes | Production only | **Proposed, not decided.** security-engineer recommends a separate public-repo-read token with no permissions, so only `approve` loads the write token (docs/04 §4.6). It needs an ADR that Dr. Lee accepts first; do not create it until then |
| `GITHUB_REPO` | no (`fenago/BeachDay`) | all | approve function |
| `SUPABASE_URL` | **no** | all | auth guard in every `/api/*` function (and the browser config, see docs/03 §6) |
| `SUPABASE_PUBLISHABLE_KEY` | **no** | all | auth guard (and the browser config) |

- The two Supabase values are public by design (they ship to every browser). **Do not tick "Contains secret values" for them**: secret scanning would then fail the build whenever the value appears in `public/`. Auto-detection by name (`KEY`) on untrusted builds is **[UNVERIFIED]** for `PUBLISHABLE_KEY`. The build writes both values into the git-ignored `public/generated/config.js` (ADR-0006 point 3), and fails unless the key starts with `sb_publishable_`. Whether Netlify's scan also looks for non-secret values in build output is **[UNVERIFIED]**; if a build fails with a scan hit on that file, add `SECRETS_SCAN_OMIT_KEYS=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY` rather than disabling scanning. All builds (including previews) need both variables, or the build fails.
- **Dropped on 2026-11-23** (Dr. Lee's decision 9, Console password replaced by Supabase Auth): the two old Console-password variables (names beginning `CONSOLE_` and `SESSION_`). If they exist in the Netlify UI, delete them. The Supabase **secret / `service_role` key is used nowhere** and must never be set in Netlify.
- netlify-engineer writes this checklist and the commands. **Dr. Lee runs them.** Agents never see or set real values.
- Never put any of these in `netlify.toml` or `[build.environment]`. Functions can't see those values anyway, and the repo is shared.
- Builds can read every variable on Free, **including secrets**, so `scripts/build-agents.mjs`, `scripts/stamp-sw.mjs` and `scripts/gen-config.mjs` must never log `process.env`. `gen-config.mjs` reads exactly three variables by name (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `COMMIT_REF`), and its rejection messages never echo a value (example 04). Secret scanning fails a build if a secret value lands in `public/` or another build output, which is a useful backstop.
- **Anything executed during the build sees every secret on Free.** `tests/**` is writable by agents, so the build does **not** run `vitest` (docs/03 §9.4). Tests run in QA's own gate.
- After rotating `GITHUB_TOKEN` (90 days, ADR-0005), **trigger a new deploy**. Functions keep the old value until then.
- **Fake secrets in tests are built at runtime, not written as literals** (Vera rejects an "EXAMPLE" exemption). Assemble them from parts plus random bytes, for example `["sb", "secret", randomBytes(12).toString("hex")].join("_")`, so no committed file contains something a scanner or push protection would flag. Example 04's `gen-config.test.mjs` does this. Never write a real-looking `NAME=value` assignment for a secret variable in a test, README or fixture.
- **Production-only secrets on Free are enforced in four layers** (docs/04 §4.6), because per-context values are **[UNVERIFIED]** on Free: (1) set the two secrets with `--context production --secret` and read back `netlify env:list --context deploy-preview`; (2) **turn off Deploy Previews and branch deploys: this is REQUIRED, not a fallback**; keep "Build without sensitive variables" for fork builds; (3) **in code, every function that calls GitHub or Claude returns `503 unavailable` unless `context.deploy.context === "production"`, before it reads the secret**; (4) nothing agent-writable runs in the build, and build scripts never print env.
