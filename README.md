# Beach Day

Beach Day is an installable web app (PWA). You pick a South Florida beach and it tells you whether today and the next few days are good beach days, and why. It uses the free, keyless Open-Meteo Forecast and Marine APIs. Verdicts are Great, Good, Fair or Skip it.

The deployed app also has an **Agents** page (the Agent Console, `/console`). A signed-in `super_admin` can chat with the project's Claude agents. An agent can propose a code change, and it is committed to `main` only after a human clicks **Approve**. Netlify then deploys it.

Beach Day is not a safety service. Always check the National Weather Service rip-current risk and posted beach flags. Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).

Status: built and tested locally with fakes. It has not been deployed. No Netlify site is linked yet, so a push to `main` costs 0 credits today. Everything marked UNVERIFIED below needs a real project to confirm.

## Architecture in five lines

1. A static front end on Netlify (`public/`). No framework, no bundler, ES modules.
2. The browser calls Open-Meteo directly. The beach app has no auth code.
3. Netlify Functions exist **only** for the Claude and GitHub calls (`netlify/functions/`). No other servers (ADR-0006).
4. The Console page signs in with Supabase Auth directly. Supabase holds only users and a `profiles` role table. Every function checks the Bearer token **and** `role = super_admin` on every request, and fails closed (401, 403, 503).
5. Approve commits to `main` as one atomic commit through the GitHub Git Database API (ADR-0003). Proposals, jobs, counters and the audit log live in Netlify Blobs.

Decisions are in `docs/adr/`. Start with `docs/README.md`.

## Repository layout

| Path | What it is |
|---|---|
| `public/` | The published site: pages, `js/`, `css/`, `icons/`, `manifest.webmanifest`, `sw.js`, `_headers`, `vendor/` (pinned Supabase auth bundle, Console only) |
| `public/generated/`, `public/version.json` | Build output, git-ignored |
| `netlify/functions/` | The eight function handlers (`agents`, `chat`, `jobs`, `job-run`, `job-status`, `proposal`, `approve`, `reject`) and `lib/` |
| `netlify/functions/lib/settings.mts` | Every pending decision and launch switch, in one file |
| `scripts/` | Build scripts (`build-agents`, `stamp-sw`, `gen-config`) and the post-deploy `smoke.mjs` |
| `supabase/` | The `profiles` migration, the manual promote script, and how the vendored auth bundle is built |
| `tests/` | `unit/`, `functions/`, `db/`, `contracts/`, `static/`, `e2e/`, plus `helpers/` (fakes) and `harness/` (local full-stack server) |
| `.claude/agents/`, `.claude/skills/` | The 12 agents and their skills |
| `knowledge/` | Each agent's reference notes and tested examples |
| `docs/` | Research, ADRs, design docs and `runbooks/rollback.md` |
| `netlify.toml` | Build command, publish directory, functions settings, the `ignore` rule |

## Local development

Needs Node 22 or newer. The root `.npmrc` sets `ignore-scripts=true`, so `npm ci` never runs a dependency's install script (supply-chain rule from security review). Netlify reads the same file during its install.

```bash
npm ci                 # exact versions from package-lock.json
npm test               # all Vitest tests (unit, functions, db, contracts, static)
npm run test:unit      # faster subset
npm run test:functions
npm run e2e            # Playwright, Chromium only; starts the harness on 127.0.0.1:4173
npm run serve:harness  # the harness alone (PORT=<n> to change the port)
npm run build:agents   # writes netlify/functions/lib/agents.json (git-ignored)
```

On a machine without a preinstalled browser, run `npx playwright install chromium` once before `npm run e2e`. The e2e "iPhone" project is Chromium with an iPhone 15 viewport and user agent. There is no WebKit run, so real iOS Safari behaviour needs a device check.

**The harness is the local proof.** `tests/harness/server.mjs` serves `public/` with the real `_headers` rules (so CSP violations show up), runs the real function code from `netlify/functions/`, and fakes Supabase, Anthropic and GitHub in-process. It never reaches a real host and reads no real secret. A route whose handler file is missing answers 501.

**Netlify CLI** (install it yourself; it is not a project dependency). Checked with netlify-cli 27.20.1 in a scratch site, on 2026-11-23:

| Command | Result |
|---|---|
| `netlify build --offline` | Works. Proves the build command and the esbuild bundling of `.mts` functions |
| `netlify functions:serve --offline --port 9780 --functions netlify/functions` | Works (unset `NODE_OPTIONS`, and pass `--functions`). Serves only `/.netlify/functions/<name>`; routes set by `config.path` such as `/api/chat` return 404 here |
| `netlify dev` | Did **not** work in the sandbox: it downloads the Edge Functions runtime, which the sandbox blocks. It may work on your machine, with `netlify link` first. UNVERIFIED for this repo |
| `netlify deploy` | Makes a draft only. **Never add `--prod`**: `main` deploys automatically |

`node scripts/build-agents.mjs` runs anywhere. `stamp-sw.mjs` and `gen-config.mjs` refuse to run outside Netlify unless you pass `--force`. `gen-config.mjs` fails until `public/_headers` names your real Supabase host (see Step 6).

Treat any agent-written test as untrusted code: run it in a shell with no real secrets in the environment.

## Deploy checklist (Dr. Lee, by hand)

No agent can do these steps; they hold credentials. Never paste a real value into the repo, an issue or a chat. Order matters.

### 1. Supabase project

1. Create a Supabase project (Free plan). Note the **project URL** and the **publishable** key (`sb_publishable_...`). **Do not copy the secret key or the legacy `service_role` key anywhere.** Beach Day uses neither.
2. Apply `supabase/migrations/20261123000000_profiles.sql` in the SQL editor, or with `supabase link --project-ref <project-ref>` then `supabase db push`. Try it on a throwaway project first: the SQL was tested in pglite, not on a real project. Details: `supabase/README.md`.
3. Dashboard, Advisors, Security Advisor: expect no warning on `public.profiles`. Create a test user and check that a row with `role = 'user'` appears.
4. Set the Auth settings below (docs/04 §4.5):

| Setting | Value |
|---|---|
| Confirm email | On |
| Confirm phone | On, even though phone sign-in stays off (stops "User already registered" account enumeration; hosted behaviour UNVERIFIED) |
| Custom SMTP | Required before launch. The built-in sender mails only your own team, about 2 an hour. The SMTP password lives in Supabase only |
| Email templates | Confirm signup and Reset password link to `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email` and `&type=recovery`. A query string, never a `#` fragment. Exact strings UNVERIFIED until tried |
| Password minimum length | 12. No character-class rules |
| Leaked-password protection | Pro plan and above only; not available on Free |
| Anonymous sign-ins | Off |
| Site URL | `https://<production host>/console` |
| Redirect URLs | Exactly `https://<production host>/console`. No `*`, no preview pattern, no `localhost` |
| JWT expiry | 600 seconds |
| Signing keys | Asymmetric. Confirm in the Dashboard |
| MFA (TOTP) | On. Recommended: enrol a factor on your own account |
| Auth rate limits | Keep the defaults |

### 2. Google sign-in

In Google Cloud, create an OAuth client of type **Web application**. Use the callback URL shown on Supabase's Google provider page as the authorised redirect URI, and the production origin as the authorised origin. Enable the Google provider in Supabase with the client ID and secret. **The Google client secret lives only in Supabase**, never in Netlify or the repo.

### 3. Make yourself super_admin

1. After the first deploy (or on a throwaway deploy), sign up in the Console and confirm your email, signing in the way you will normally sign in. Google and email accounts may be separate users (UNVERIFIED).
2. In the SQL editor, run STEP 1 of `supabase/manual/promote-super-admin.sql` with your address and read every check. Then run STEP 2 with the user id from STEP 1. Expect `1 row affected`.
3. Nobody else can set this role. The role is read on every request, so the next Console call sees it.

### 4. GitHub token and repository rules

1. Create a **fine-grained personal access token** (ADR-0005): resource owner `fenago`, **only** `fenago/BeachDay`, **Contents: Read and write**, nothing else. **No Workflows permission.** Expiry 90 days, then rotate. A token cannot be limited to paths, so the allow-list in code is the control.
2. Add a ruleset on `main` that blocks force pushes and blocks deletions (available on Free for public repos).

### 5. Anthropic

Create a dedicated workspace with a **low spend limit**, and an API key in it. After the first chat, Anthropic's console should show the spend, and Netlify's Usage page should show no AI-inference credits (UNVERIFIED: the AI Gateway may inject its own variables; the code passes the endpoint and key explicitly).

### 6. Put your Supabase host in `public/_headers`

`public/_headers` ships with `https://<project-ref>.supabase.co` in the CSP `connect-src`. A headers file cannot read environment variables, so a human replaces `<project-ref>` with the real host. The build then **fails on purpose** (0 credits, the previous deploy stays live) unless this host equals `SUPABASE_URL` exactly. Never use a wildcard. This change needs security review.

### 7. Netlify site and environment variables

1. Add the site from the GitHub repo. Netlify reads `netlify.toml` (publish `public`, functions `netlify/functions`, Node 22).
2. Set the variables (UI or CLI). **Never set the Supabase secret or `service_role` key.**

| Variable | Secret | Context | Used by |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Production only | `chat`, `job-run` |
| `GITHUB_TOKEN` | yes | Production only | `approve`; under ADR-0007 (current) also the read tools in `chat` and `job-run`, through a module with no write methods |
| `GITHUB_REPO` = `fenago/BeachDay` | no | all | GitHub calls |
| `SUPABASE_URL` | **no** | all | every function, and the build (`config.js`) |
| `SUPABASE_PUBLISHABLE_KEY` | **no** | all | every function, and the build (`config.js`) |
| `GITHUB_READ_TOKEN` | yes | Production only | **Do not create it.** ADR-0009 is Proposed. Create it only if Dr. Lee accepts ADR-0009 (see D2) |
| `SECRETS_SCAN_OMIT_KEYS` = `SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY` | no | all | **Only** as the documented fallback if Netlify's secret scan flags the publishable key in `config.js` (UNVERIFIED; the first deploy is the test). Do not turn scanning off |

```bash
netlify env:set ANTHROPIC_API_KEY <value> --context production --secret
netlify env:set GITHUB_TOKEN      <value> --context production --secret
netlify env:set GITHUB_REPO       fenago/BeachDay
netlify env:set SUPABASE_URL      https://<project-ref>.supabase.co
netlify env:set SUPABASE_PUBLISHABLE_KEY <publishable key>
netlify env:list --context production         # secrets stay masked
netlify env:list --context deploy-preview     # the two secrets must be ABSENT
```

The two Supabase values are public by design and reach the browser through the build-written `public/generated/config.js`. Do **not** mark them secret: secret scanning would then fail the build. The build fails unless the key starts with `sb_publishable_`, which catches a pasted secret key. After rotating any secret, **trigger a new deploy**: functions keep the old value until then.

3. **Turn OFF Deploy Previews and branch deploys.** This is required, not optional. Per-context secret values on the Free plan are UNVERIFIED, so with no non-production deploy no function outside Production can read a token. Keep "Build without sensitive variables" for builds from forks. Check the setting's name and its Free availability; if you cannot turn it off, tell the team, because the in-code production check is then the only barrier left.
4. Remember the four layers that keep secrets out of previews: Production-only values, previews off, a production-context check in code (503 `unavailable` otherwise), and nothing agent-writable running in the build.

### 8. First deploy, pre-launch tests, and turning Approve on

- Every push to `main` is a production deploy and costs **15 of 300 Free credits a month** (ADR-0004), about 20 deploys. Batch changes. A failed build costs 0. A build skipped by the `ignore` rule is expected to cost 0 (UNVERIFIED; check the Usage page after the first skip). The site-wide Approve cap (ADR-0008) holds approvals to at most 210 credits in any cycle, which is 70%. Warn at about 70% and at 90% of 300.
- **Approve starts OFF** (D10). `approveEnabled` is `false` in `netlify/functions/lib/settings.mts`; `GET /api/proposals/:id` reports it and `approve` answers 503 `unavailable`. Reject still works.
- Run the **pre-launch tests (a) to (i)** on the real Supabase project and record the results. The canonical list is docs/04 §4.2 (the build plan's "(a)-(g)" is the older, shorter list):

| Test | What it checks |
|---|---|
| a | The `amr` timestamp for `password` or `oauth` keeps the sign-in time across a token refresh |
| b | A new sign-in in the same browser gives a new, current timestamp |
| c | `last_sign_in_at` changes on password and Google sign-in, not on refresh |
| d | `getUser` after `signOut({scope:'local'})`. If it still works, a signed-out token lives until it expires. Accepted at 10 minutes; record it |
| e | A TOTP verify yields `aal2` |
| f | A real access token's header has `alg` `ES256` or `RS256` and a `kid`. Only then switch `jwtHeaderPrecheck` on (D12) |
| g | With Supabase unreachable from the function, Approve answers 503, not 401 |
| h | Netlify secret scanning does not flag the `sb_publishable_` key in `config.js` (fallback above) |
| i | The Security Advisor shows no `profiles` warning, and a second throwaway user cannot read another row or change their own `role` through the REST API |

- Approve is switched on only after (a) to (e), (g) and (i) pass: a human edits `approveEnabled` to `true` (D10), security review, then push (15 credits).
- **Post-deploy smoke test** after each deploy that builds (run by hand or by QA):

```bash
BASE_URL=https://<site>.netlify.app EXPECT_COMMIT=<full commit sha> node scripts/smoke.mjs
```

It checks that `sw.js` is stamped and `no-cache`, that `/version.json` matches, the manifest type, the CSP and COOP headers, and that every sync `/api` route answers 401 without a token. It does not test `/api/jobs-run`, because a background function always answers 202. "Live" in the Console means `/version.json` carries the approved commit.
- **Rollback:** `docs/runbooks/rollback.md`. In short: Deploys, pick the last good deploy, **Publish deploy** (instant, 0 credits), then **Lock to stop auto publishing**, or the next push overwrites it. Fix forward with `git revert` and unlock.

### 9. Add the CI workflow (D11)

The tests are not in the Netlify build on purpose (on Free the build can see every secret, and agents can write to `tests/`). They run in GitHub Actions instead. The workflow is **not added in this push**, because agents cannot write `.github/**` and the token has no Workflows permission, so a human adds it:

1. Copy `knowledge/qa-engineer/examples/06-github-actions-no-secrets/tests.yml` to `.github/workflows/tests.yml`.
2. Replace every `<PIN-SHA>` with the full 40-character commit SHA of the action release named in the comment next to it. Do not guess the SHAs; look them up on GitHub.
3. Set a repository **variable** (not a secret) named `SITE_URL`.
4. Keep `permissions: contents: read`, no secrets, and no `pull_request_target`. Copy `workflow-lint.test.mjs` from that folder to `tests/unit/workflow.test.js`, point it at the new file with `strict: true`, and run it.
5. Add `npm audit` to the workflow when you do.

## Decisions waiting for Dr. Lee, and where each is changed

Each is one value in one place. Change the value, not the code, then get security review for anything under `netlify/` or `netlify.toml`.

| # | Decision | Built as | Where to change it |
|---|---|---|---|
| D1 | Compute budget | 180 function-minutes per rolling 31 days (about 30 credits at 1024 MB, UNVERIFIED) | `netlify/functions/lib/settings.mts` `computeBudgetMinutes` |
| D2 | ADR-0009: separate public-read token (**Proposed**) | Not accepted. Read tools use `GITHUB_TOKEN` through a read-only module | `settings.mts` `githubReadTokenEnv`: `"GITHUB_TOKEN"` to `"GITHUB_READ_TOKEN"` (fails closed, no fallback), then create that secret |
| D3 | Positive reasons on good days | Off | `public/js/score-config.js` `SCORE_CONFIG.reasons.positiveOnGoodDays` |
| D4 | Heading when the account is not allowed | "This account can't use Agents" | copy id `console.noaccess.title` in `public/js/copy/copy-deck.js` |
| D5 | Server-side refusal fallback | None | `settings.mts` `serverRefusalFallback` |
| D6 | Deny the Console UI files to agents | Not denied | `settings.mts` `denyConsoleUi` (read by `allowlist.mts`) |
| D7 | Approve cap (ADR-0008) | 14 per rolling 31 days, 5 per New York day | `settings.mts` `approveCap` |
| D8 | What counts as measurable rain | Over 0.02 in | `public/js/score-config.js` `rain.amountInchOver` |
| D9 | Knowledge and skills are bundled into each agent's prompt, so changes to them deploy (**confirmed by Dr. Lee**) | On: `knowledge` and `.claude/skills` are in the `ignore` list | `netlify.toml` `ignore` and `DEPLOY_PATHS` in `netlify/functions/lib/deploys.mts` (a test keeps the two equal). Changes to either deploy at 15 credits |
| D10 | Approve pre-launch switch (**confirmed by Dr. Lee**) | `approveEnabled: false` until the pre-launch tests pass | `settings.mts` `approveEnabled` |
| D11 | GitHub Actions workflow (**confirmed by Dr. Lee**) | Not added in this push | Step 9 above |
| D12 | JWT header pre-check | Off until test (f) | `settings.mts` `jwtHeaderPrecheck` |
| D13 | The `/guide/` page | Built as `public/guide/index.html` | that file |

Also awaiting Dr. Lee: **ADR-0010** (Proposed) keeps two added packages, pinned exactly: `diff@9.0.0` (runtime, used only by `lib/diff.mts`) and `smol-toml@1.9.1` (dev, tests only). Both have no dependencies and no install scripts.

## Ground rules

- Never put a secret in the repo, the browser, logs, test fixtures or prompts. Placeholders look like `sk-ant-EXAMPLE`.
- Never run `netlify deploy --prod`. `main` deploys on its own.
- Agents propose; a human approves. Agents cannot change `netlify/**`, `netlify.toml`, `public/_headers`, `public/sw.js`, `public/vendor/**`, `scripts/**`, `.github/**` or `package*.json`. A human makes those changes through normal git, with security review.
- Verdicts never rely on colour alone. The Open-Meteo attribution and the NWS rip-current and flags line stay on screen.

## Known unknowns

Netlify's and Supabase's documentation could not be reached while this was written, so these are marked UNVERIFIED and have a cheap real-world test: per-context secret values on Free; Blobs on Free and any quota; the credit cost of a skipped build; whether previews can be turned off on Free; secret scanning versus the publishable key; AI Gateway variables; and the hosted Supabase behaviours listed in the tests above. The register is in `docs/03-architecture-netlify.md` §12.
