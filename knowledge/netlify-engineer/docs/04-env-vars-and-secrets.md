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
- **[UNVERIFIED]** Whether a Free-plan site can set `--context production` for a secret was not tested here, because no Netlify account was used. Run `netlify env:set GITHUB_TOKEN <value> --context production --secret` once on the real site. If it is refused, raise it with Dr. Lee. A Deploy Preview with the production token is exactly what ADR-0005 wants to avoid, and the fallback would be a separate, read-only or empty token for other contexts. That fallback might itself be impossible on Free.

## Beach Day notes
| Variable | Secret | Context | Read by |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Production (and Deploy Previews only if the Console must work there) | chat and jobs functions |
| `GITHUB_TOKEN` | yes | **Production only** (ADR-0005) | approve function |
| `CONSOLE_PASSWORD_HASH` | yes | Production | login function |
| `SESSION_SECRET` | yes | Production | every `/api/*` function |
| `GITHUB_REPO` | no (`fenago/BeachDay`) | all | approve function |

- netlify-engineer writes this checklist and the commands. **Dr. Lee runs them.** Agents never see or set real values.
- Never put any of these in `netlify.toml` or `[build.environment]`. Functions can't see those values anyway, and the repo is shared.
- Builds can read every variable on Free, so `scripts/build-agents.mjs` must never log `process.env`. Secret scanning fails a build if a secret value lands in `public/` or another build output, which is a useful backstop.
- After rotating `GITHUB_TOKEN` (90 days, ADR-0005), **trigger a new deploy**. Functions keep the old value until then.
- Use obviously fake values in tests (`sk-ant-EXAMPLE`, `github_pat_EXAMPLE`), so secret scanning and push protection never trip.
