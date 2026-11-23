# 03 — Architecture: static Netlify site + Netlify Functions

> Decision on record: Beach Day is a PWA on Netlify — a static front end, Netlify Functions for the Claude and GitHub calls, and no other servers of ours. Since ADR-0006 the Console's sign-in is **Supabase Auth**, called directly from the browser (this supersedes ADR-0001's "browser talks only to Open-Meteo"; the wording of the supersession is Rowan's). Researched against docs.netlify.com on 2026-11-23 (credit-based plans, introduced 4 Sep 2025).
>
> **Verification status (read this first).** A re-check on 2026-11-23 later in the day failed: `docs.netlify.com` did not resolve from the sandbox (DNS failure), so nothing below was re-read in that round. Facts carried from the earlier fetch are cited. New or changed facts are marked **UNVERIFIED** and collected in §12. Nothing in this file was invented to fill a gap.
>
> Netlify engineer: Nell. Files that implement this spec do not exist yet: there is **no `netlify.toml`, `scripts/`, `netlify/` or `public/` in the repo** at the time of writing.

## 1. Big picture

```
 Phone (installed PWA)
 ├─ index.html / js/app.js / styles.css / sw.js / manifest.webmanifest   ← static, CDN
 ├─ fetch ──► api.open-meteo.com          (direct from browser, keyless, CORS)
 ├─ fetch ──► marine-api.open-meteo.com   (direct from browser)
 ├─ fetch ──► <project>.supabase.co       (Console sign-in only; ADR-0006)
 └─ /console  (Agent Console UI, static)
       │  fetch /api/*  (same origin, Authorization: Bearer <access token>)
       ▼
 Netlify Functions (Node, netlify/functions/)    every handler: token check + role check first, fail closed
 ├─ GET  /api/agents                        list agents (from build-time agents.json)
 ├─ POST /api/chat                          streaming proxy → Claude Messages API   (≤60 s, SDK timeout 50 s)
 ├─ POST /api/jobs                          sync wrapper: auth, limits, create job, start worker
 ├─ POST /api/jobs-run   (background)       long agent job → status in Blobs        (≤15 min)
 ├─ GET  /api/jobs/:id                      poll job status/output from Blobs
 ├─ GET  /api/proposals/:id                 read a proposal (diff) from Blobs
 ├─ POST /api/proposals/:id/approve         re-validate → commit to GitHub → Netlify auto-deploys
 └─ POST /api/proposals/:id/reject          mark rejected
       │                    │
       ▼                    ▼
 Netlify Blobs          api.github.com (fine-grained PAT, this repo only)
 (proposals, jobs,             │ push to main
  rate-limit counters,         ▼
  audit log)            Netlify continuous deployment → new atomic deploy
                               └─ build writes public/version.json → Console shows "Live" (§8.4)
```

* There is **no `/api/login` and no `/api/logout`**. Sign-up, sign-in, sign-out and password reset happen between the browser and Supabase. Functions only *check* the token and the role (§4.2). The auth design is owned by supabase-auth-engineer and security-engineer (docs/04).
* The approve route is `POST /api/proposals/:id/approve` (not `/api/approve`).
* `/api/jobs` (sync) and `/api/jobs-run` (background) are two functions, because a background function always answers `202` and cannot say `401` (§5). The worker sits at the sibling path `/api/jobs-run` (docs/04 §2, ADR-0006), so it never overlaps `GET /api/jobs/:id` and needs no `excludedPath`.

Why weather calls skip Functions: Open-Meteo is keyless and CORS-enabled, so a proxy adds latency, cost (credits) and a failure point for no security gain. The service worker caches responses instead (doc 02). A function proxy is only worth adding if we later need a shared cache or a commercial API key.

## 2. Repository layout (proposed)

```
/
├─ netlify.toml
├─ package.json            "type": "module"
├─ public/                 ← publish directory (static)
│  ├─ index.html, console.html
│  ├─ manifest.webmanifest, sw.js (has __BUILD_VERSION__), offline.html
│  ├─ version.json         ← written by the build, not committed (§9)
│  ├─ generated/config.js  ← written by the build (SUPABASE_URL, publishable key, BUILD_VERSION), not committed (§9.5)
│  ├─ vendor/              supabase-auth-js-<version>.mjs (vendored, pinned, auth only) and its MIT licence; committed by a human (ADR-0006)
│  ├─ icons/               192, 512, maskable, apple-touch-icon 180
│  ├─ js/  (ES modules: app.js, api/openmeteo.js, score.js, ui/*.js, console/*.js; the Console imports ../generated/config.js and ../vendor/supabase-auth-js-<version>.mjs)
│  ├─ css/
│  └─ _headers
├─ netlify/functions/      ← kept outside publish dir
│  ├─ agents.mts, chat.mts, jobs.mts, job-run.mts, job-status.mts, proposal.mts, approve.mts, reject.mts
│  └─ lib/ (guard.mts, ratelimit.mts, github.mts, claude.mts, allowlist.mts, deploys.mts ← DEPLOY_PATHS and deploysOnCommit() (docs/04 §1), agents.json ← generated)
├─ scripts/build-agents.mjs   parses .claude/agents/*.md → netlify/functions/lib/agents.json
├─ scripts/stamp-sw.mjs       stamps sw.js and writes version.json (§9)
├─ scripts/gen-config.mjs     writes public/generated/config.js; fails unless the key starts sb_publishable_ (§9.5)
├─ scripts/smoke.mjs          post-deploy checks (§9.3), run by hand or by QA
├─ .claude/agents/ , .claude/skills/
├─ tests/ (unit/, e2e/, fixtures/)
└─ docs/
```

`public/generated/`, `public/version.json` and `netlify/functions/lib/agents.json` are generated by the build, so all three must be in `.gitignore` (and the build must create `public/generated/` itself). `.gitignore` is outside netlify-engineer's scope; the need is listed in the HANDOFF. Agents cannot edit `public/vendor/**`, `public/generated/**` or `public/version.json` (docs/04 §6).

No framework is required; plain ES modules keep the bundle tiny and the service worker simple. The build exists to generate `agents.json` and to stamp the service worker version.

## 3. `netlify.toml` and `public/_headers` (the spec)

Working copies, validated by a script that runs the `ignore` command in a throwaway git repo: `knowledge/netlify-engineer/examples/02-netlify-toml-headers/`. **There is no `netlify.toml` in the repo yet**; a human adds it (`netlify.toml` and `scripts/**` are on the agents' deny list).

### 3.1 `netlify.toml`

```toml
[build]
  command = "node scripts/build-agents.mjs && node scripts/stamp-sw.mjs && node scripts/gen-config.mjs"
  publish = "public"
  ignore = '[ -n "$CACHED_COMMIT_REF" ] && git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- public netlify netlify.toml package.json package-lock.json scripts .claude/agents || exit 1'

  [build.environment]
    NODE_VERSION = "22"          # build variables only; never a secret; functions cannot see it

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  included_files = ["netlify/functions/lib/agents.json"]
```

Why each line:

* **`command`** runs three small scripts that use only Node built-ins. None may print environment variables (§6). `gen-config.mjs` runs last and fails the build if the Supabase key is not a publishable key, or if the Supabase host in the CSP in `public/_headers` differs from `SUPABASE_URL` (§9.5). It does **not** run `vitest` or any test runner (§9.4, decided).
* **`ignore`** — Netlify treats exit `0` as "skip this build" and exit `1` as "build" ([ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)). Three details, each proven in the example:
  * It lists what the build **reads or publishes**, as a whitelist (`public` covers `public/vendor/`; `public/generated/` is git-ignored, so it never appears in a diff): `public`, `netlify`, `netlify.toml`, `package.json`, `package-lock.json`, `scripts`, `.claude/agents` (agents.json is generated from it). Commits that touch only `docs/`, `knowledge/`, `tests/`, `.claude/skills/` or root Markdown are skipped. Of the paths the Console may write, exactly `docs/**`, `tests/**` and `.claude/skills/**` skip; `public/**` and `.claude/agents/*.md` deploy (matches Remy's `DEPLOY_PATHS`, docs/04 §1). `knowledge/` and root Markdown also skip but are not agent-writable. **A new top-level folder the build reads must be added to the list.**
  * `[ -n "$CACHED_COMMIT_REF" ]` — if that variable is empty (what it holds on a first build or after a cache clear is **UNVERIFIED**), an unquoted `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- …` loses an argument, compares the working tree with `COMMIT_REF`, finds nothing and exits `0`: the first build would be **skipped**. The example reproduces it.
  * `|| exit 1` turns every failure (for example git exit code 128 when the cached commit is missing from the clone) into the documented "build" code.
  * It runs under Bash with no npm dependencies available, so it can only use git and shell.
  * Skipped builds are **expected** to cost 0 credits; this is **UNVERIFIED** (§12).
* **`NODE_VERSION`** — pins the build's Node. Functions use the build's Node when it is a valid Lambda runtime, else Node 24 ([configuration](https://docs.netlify.com/build/functions/configuration/#nodejs-version-for-runtime)). The key name is **UNVERIFIED** here; check the deploy log's first lines.
* **`[functions]`** — `directory` stays outside `publish`. `included_files` ships `agents.json`, which is read at runtime.
* **No `[[headers]]`, no `rateLimit`, no secrets** in this file: headers live in `_headers`; function rate limits can only be set in code; variables declared here are invisible to functions ([functions env](https://docs.netlify.com/build/functions/environment-variables/)).
* **Contexts.** `[context.production]`, `[context.deploy-preview]` and `[context.branch-deploy]` exist ([file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)). We need none today. `[[headers]]` and `[[redirects]]` are not context-aware.

### 3.2 `public/_headers` — the single home of security headers

Dr. Lee's decision (Kai's call 2026-11-23): headers live **only** in `public/_headers`, and `public/_headers` is on the agents' deny list (decision 7).

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com https://<project-ref>.supabase.co; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self), camera=(), microphone=()
  Strict-Transport-Security: max-age=31536000
  Cross-Origin-Opener-Policy: same-origin

/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Content-Type: application/manifest+json

/version.json
  Cache-Control: no-store

/console
  X-Robots-Tag: noindex
  Cache-Control: no-store
/console.html
  X-Robots-Tag: noindex
  Cache-Control: no-store
```

* **Single location, and why.** How Netlify merges `_headers` with `[[headers]]` when both set the same header on one path is **not stated** in the pages read **[UNVERIFIED]** (re-check blocked today). So no path may get one header name from two rules, and `netlify.toml` has no `[[headers]]`. The validator enforces both. That makes the merge rule irrelevant, and I do not object to Kai's call. Each header is set once per path, so no response carries two CSPs.
* **`form-action 'self'`** is included, as Kai asked. It limits where forms may submit; it is not what governs a JavaScript-initiated redirect to Google, which is a top-level navigation. That reading is from the CSP specification, not from Netlify; Vera confirms.
* **The CSP is security-engineer's final policy** (docs/04 §10), adopted unchanged: one site-wide policy, no `unsafe-inline`, no `unsafe-eval`, no CDN. `script-src 'self'` holds because the Supabase auth client is the vendored, pinned `public/vendor/supabase-auth-js-<ver>.mjs` (ADR-0006). The Supabase host in `connect-src` is **exact, never `*.supabase.co`**, and site-wide (a Console-only rule would need a second CSP rule on `/console`, and the merge rule is UNVERIFIED). `<project-ref>` is a placeholder: a human replaces it with the real host when Dr. Lee creates the project, because `_headers` cannot read environment variables. **The build compares it with `SUPABASE_URL` and fails on any difference** (`gen-config.mjs`, §9.5; tested in example 04). Google sign-in needs no CSP entry (a top-level navigation).
* **`Cross-Origin-Opener-Policy: same-origin`** is security-engineer's recommendation, adopted. Sign-in uses redirects, not pop-ups, so it is safe. Checked by the smoke test.
* **Function responses get none of these.** Custom headers apply only to files Netlify serves from its store; "the function should return any required headers instead" ([headers](https://docs.netlify.com/manage/routing/headers/)). Every function sets its own: `cache-control: no-store`, `content-type`, `x-content-type-options: nosniff`, and a locked-down CSP (§4.3).
* `Set-Cookie`, `Location` and a few more header names are ignored by Netlify as custom headers. The validator rejects them.
* Header changes, `netlify.toml` changes and env changes need security-engineer review.

## 4. Netlify Functions (modern syntax)

### 4.1 Shape

```ts
// netlify/functions/chat.mts
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  // 1. guard(req)  →  401 / 403 / 503 and return, BEFORE reading the body (§4.2)
  // 2. validate method, content-type, size, shape
  // 3. stream, with its own headers
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
};

export const config: Config = {
  path: "/api/chat",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
```

* Config fields: `path` (URLPattern, named groups in `context.params`), `excludedPath`, `method`, `preferStatic`, `background`, `schedule`, `rateLimit`, `region`, `memory`, `vcpu`. A custom `path` removes the default `/.netlify/functions/<name>` URL. [API reference](https://docs.netlify.com/build/functions/api/)
* `context` gives `ip`, `geo`, `deploy`, `site`, `requestId`, `params`, `waitUntil()` (and cookie helpers, which we do not use).
* Runtime: the build's Node version if it is a valid Lambda runtime, else **Node.js 24**. `.mts` = ESM; TypeScript works without a separate build step. [configuration](https://docs.netlify.com/build/functions/configuration/)
* Default region `cmh` (Ohio); changing it is Pro+. `region`, `memory`, `vcpu` are Pro-only; do not use them.

### 4.2 The auth check is the first line of every `/api/*` function

Pattern (prose; the verifier itself is supabase-auth-engineer's, reviewed by security-engineer; a runnable shape with tests is `examples/01-functions-jobs-blobs/netlify/functions/lib/guard.mjs`):

1. Read `Authorization: Bearer <access token>`. Missing or malformed: **401**, `www-authenticate: Bearer`.
2. Verify the token with Supabase (the project's own issuer, `SUPABASE_URL`; the method, `getClaims()` or `getUser()`, is decided in the supabase-auth-engineer notes; the current choice is `getClaims`). Invalid, expired or wrong project: **401**. **A network or 5xx failure is not an invalid token:** Supabase auth-js does not throw on it, it **returns** an error (`AuthRetryableFetchError`, test with `isAuthRetryableFetchError`). The adapter must map a returned retryable error to **503**, never to 401 (UNVERIFIED against the hosted service; the shape is from the auth-js docs).
3. Look up the role. Anything other than `super_admin`: **403**.
4. If the verifier or its configuration is unavailable: **503**. **Fail closed**: never fall through to "allowed", and never echo the underlying error.
5. **Production-context check** (for `chat`, `jobs-run`, `approve` and `GET /api/proposals/:id`, the functions that read a secret or call GitHub; the proposal GET uses only the read-only GitHub module): if `context.deploy.context !== "production"`, answer **503 `unavailable`** before reading the secret (§6, layer 3).
6. Only then read the body, count limits, or touch Blobs, GitHub or Claude.

`/api/jobs-run` runs the same steps 1 to 5 on the bearer token forwarded by `/api/jobs`, but because a background function always answers `202`, a refusal can only return silently (no read, no write).

No cookies, no session secret, no `Set-Cookie`. The only keys the functions use are the project URL and the **publishable** key; the Supabase secret / `service_role` key is used nowhere.

### 4.3 Headers every function sets itself

`cache-control: no-store`, an explicit `content-type`, `x-content-type-options: nosniff`, and for JSON a `content-security-policy: default-src 'none'; frame-ancestors 'none'`. This includes the 401, 403 and 503 answers. Never echo env vars, tokens or stack traces; log `requestId`, route, status and duration only. Wrong method: **405** with `allow`.

## 5. Limits that shape the design

| Limit | Value | Changeable? | Source |
|---|---|---|---|
| Synchronous function execution | **60 s** | No | [config defaults](https://docs.netlify.com/build/functions/configuration/#default-values) |
| Streaming response | **60 s**, 20 MB | No | [streaming](https://docs.netlify.com/build/functions/api/#streaming-responses) |
| Background function | **15 min**, 256 KB request, returns `202` immediately; retried after 1 and 2 min on failure | No | [background functions](https://docs.netlify.com/build/functions/background-functions/) |
| Scheduled function | 30 s, cron in UTC, published deploys only | No | [scheduled](https://docs.netlify.com/build/functions/scheduled-functions/) |
| Buffered request/response | 6 MB | No | config defaults |
| Memory | 1024 MB (Pro+: up to 4096 MB / vCPU 0.5–2) | Pro+ | config defaults |
| Edge Functions | 50 ms CPU/request (I/O wait excluded), 40 s header timeout | — | [edge limits](https://docs.netlify.com/build/edge-functions/limits/) |

Background functions are available on the **Free** plan (credit-based Free, Personal, Pro). Enable with `config.background: true` (the `-background` filename suffix still works). They cannot stream and their return value is discarded — they must write results to Blobs, and they must be **idempotent** because of the automatic retries.

**Design consequence for agent jobs** (detail in doc 04):

1. **Chat turns** → `POST /api/chat`, a synchronous streaming function. **Set the Anthropic SDK `timeout` to 50 s** (Kai's call; 10 s of headroom under the 60 s limit for the final SSE events and the hand-off write) and cap `max_tokens` / tool rounds so a turn finishes inside it. If it can't, the function saves state to Blobs and emits a hand-off event naming a job ID.
2. **Long jobs** (multi-file proposals, many tool rounds) → `POST /api/jobs` (sync: auth, limits, create the record with `onlyIfNew`, store only the **hash** of a random one-time nonce) then `POST /api/jobs-run` (background, 15 min). The worker runs the same guard **as its first line** on the forwarded bearer token and role (a refusal returns silently, with no Blobs read or write: a background function always answers 202 and cannot say 401), checks that the user owns the job, then consumes a random single-use nonce with a compare-and-swap on the job record (ADR-0006 points 5 and 7), so a retry does nothing. It writes progress events and the final proposal to Blobs; the UI polls `GET /api/jobs/:id` every 2–3 s. **Never commit from a job**; only the sync approve function commits (ADR-0003). Stop at about 14 min and mark the job `paused`.
3. Edge Functions are **not** used for the Claude proxy: streaming duration for edge is undocumented (**unverified**) and env/headers behave differently; the serverless 60 s stream is the documented path.
4. **Pass the endpoint explicitly.** The chat function creates the SDK client with `baseURL: "https://api.anthropic.com"` and `apiKey: process.env.ANTHROPIC_API_KEY`, so an automatically injected AI-Gateway variable can never reroute the calls through Netlify's billing (§6).

**Rate limits (two rules on Free, code-based only):** `/api/chat` 20 per 60 s and `/api/jobs` 10 per 60 s, `aggregateBy: ["ip","domain"]`. **Decided by security-engineer (docs/04 §9); `/api/login` no longer exists, so its rule moved.** Approve needs no Netlify rule: it is capped by `site:approvals` and serialised by the approve lock. Per-user and site-wide limits are Blobs counters (§7), including the **site-wide compute budget** (`site:compute`: 180 function-minutes of chat plus job wall time per rolling 31 days, about 30 credits; **the number is pending Dr. Lee**). Without it, the per-user limits cannot bound credits: one 15-minute job is about 2.5 credits, so 20 jobs a day would be about 50 credits a day. Before a chat turn the function requires at least 60 s of budget left, before a job at least 5 min, and the job's wall clock is min(14 min, remaining); over it, `429 budget_exhausted`. Netlify validates rules in post-processing and a bad rule does **not** fail the deploy: check the deploy log after the first deploy ([rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)).

## 6. Environment variables & secrets

| Variable | Secret? | Context | Read by | Notes |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | Production | `chat`, `jobs-run` | Mark **Contains secret values**. Dedicated Anthropic workspace + low spend limit (doc 05). |
| `GITHUB_TOKEN` | **yes** | **Production only** | `approve` (writes); under ADR-0007 as it stands also the read tools in `chat` and `jobs-run`, through a read-only module | Fine-grained PAT, this repo only, Contents R/W (ADR-0005). See the Free-plan rules below. |
| `GITHUB_READ_TOKEN` | **yes** | Production only | `chat`, `jobs-run` | **Proposed, not decided.** security-engineer recommends a separate token for public-repo reads with no permissions, so only `approve` loads the write token (docs/04 §4.6). It is **ADR-0009 (Proposed)** and needs Dr. Lee's acceptance. **Do not create it until he does;** until then ADR-0007 stands. |
| `GITHUB_REPO` | no | all | approve | `fenago/BeachDay` |
| `SUPABASE_URL` | **no** | all | auth check in every function | The project URL. Public by design. |
| `SUPABASE_PUBLISHABLE_KEY` | **no** | all | auth check in every function | The publishable key. Public by design. **Do not mark it secret**: secret scanning would then fail any build whose output contains it. |

Removed on 2026-11-23 (decision 9): the two old Console-password variables (names beginning `CONSOLE_` and `SESSION_`). If they exist in the Netlify UI, delete them. The Supabase secret / `service_role` key must **never** be set in Netlify.

Dr. Lee runs these; agents never see or set real values:

```bash
netlify env:set ANTHROPIC_API_KEY <value> --context production --secret
netlify env:set GITHUB_TOKEN      <value> --context production --secret
netlify env:set GITHUB_REPO       fenago/BeachDay
netlify env:set SUPABASE_URL      https://<project-ref>.supabase.co
netlify env:set SUPABASE_PUBLISHABLE_KEY <publishable key>
netlify env:list --context production        # secrets stay masked
```

* **How the browser gets the two Supabase values** is decided (ADR-0006 point 3): the build step `scripts/gen-config.mjs` writes the git-ignored `public/generated/config.js` from exactly those variables and fails unless the key starts with `sb_publishable_` (§9.5). The project host must still appear as a literal in the CSP, because `_headers` cannot read environment variables (security-engineer's policy, §3.2).
* **Set via UI or CLI** ([CLI](https://cli.netlify.com/commands/env/)); the full flag list is in `knowledge/netlify-engineer/docs/04-env-vars-and-secrets.md`.
* **Secrets Controller** (listed as included on Free): secret values are write-only, need explicit contexts, can't use the post-processing scope; secret scanning fails a build if a secret value appears in the repo or build output (`SECRETS_SCAN_ENABLED` default true). [secrets controller](https://docs.netlify.com/build/environment-variables/secrets-controller/)
* **Scopes** (Builds/Functions/Runtime/Post-processing) are **Pro+**. The old "Functions" scope row is gone from this table for that reason. On Free every variable is visible to builds too, **including the secrets**. Therefore: build scripts never print env, and **nothing agent-writable runs during the build** (§9.4).
* **Production-only secrets on Free: four layers** (security-engineer, docs/04 §4.6). Per-context values on Free are **UNVERIFIED**: the pricing table lists "scope environment variables per deploy context" as not included on Free, while ADR-0005 needs `GITHUB_TOKEN` in Production only. So none of the layers is optional:
  1. **Set the secrets with `--context production --secret`**, then run `netlify env:list --context deploy-preview` and confirm they are absent. If Netlify refuses, tell Dr. Lee.
  2. **Turn off Deploy Previews and branch deploys. This is REQUIRED, not a fallback** (the setting's exact name and Free availability are **UNVERIFIED**). ADR-0003 commits straight to `main` and QA runs on the main deploy, so previews are unused, and with no non-production deploy no non-production function can read a token. Keep "Build without sensitive variables" for fork builds.
  3. **In code: every function that calls GitHub or Claude (`chat`, `jobs-run`, `approve`, `GET /api/proposals/:id`) returns `503 unavailable` unless `context.deploy.context === "production"`**, checked before it reads the secret. It sits right after the auth guard and is tested (docs/04 §12).
  4. **Nothing agent-writable runs during the build**, and build scripts never print env (§9.4).
* **Forks.** The repo is public. Keep the "Build without sensitive variables" policy for untrusted (fork) builds ([get started](https://docs.netlify.com/build/environment-variables/get-started/)). The default is **UNVERIFIED**; Dr. Lee checks the setting once.
* **AI Gateway.** On credit-based plans Netlify may set AI-provider variables automatically unless you bring your own keys ([functions env](https://docs.netlify.com/build/functions/environment-variables/)). Which ones, and whether Free can opt out, are **UNVERIFIED**. The control that needs no verification is §5 item 4 (explicit `baseURL` and key). After the first chat, Anthropic's console should show the spend and Netlify's Usage page should show **no** AI-inference credits.
* Limits: key ≤255 chars, value ≤5,000 chars. The 4 KB total limit applies only in Lambda-compat mode.
* Read in functions with `process.env.X` (or `Netlify.env.get("X")`). Values are a snapshot taken at deploy time: after changing or rotating one, **trigger a new deploy**.

## 7. Netlify Blobs — the app's only state

```ts
import { getStore } from "@netlify/blobs";
const proposals = getStore({ name: "proposals", consistency: "strong" });
await proposals.setJSON(id, proposal, { onlyIfNew: true });
const { etag } = await proposals.getWithMetadata(id, { type: "json" });
await proposals.setJSON(id, { ...p, status: "committing" }, { onlyIfMatch: etag }); // compare-and-swap
```

| Store | Key | Contents |
|---|---|---|
| `proposals` | `p_<ULID>` | agent, summary, files (path + new content + base SHA), content hash, status, timestamps, `commitSha?`, `error?` |
| `jobs` | `j_<ULID>` | status (`queued/running/done/failed/paused`), progress events, owner user id, token hash, result proposal ID, error |
| `ratelimit` | `<action>/<user id>/<YYYY-MM-DD>`; `site:approvals`; `site:compute` | per-user counters; the approve record is `{ times: [<ISO-8601 UTC>, ...] }`, pruned to the last 31 days on every write (ADR-0008); the compute record is `{ days: { "<New York YYYY-MM-DD>": <ms>, ... } }`, at most 32 buckets, pruned on every write; `checkComputeBudget` derives the `budget_exhausted` `retryAt` from the oldest buckets (example 03, test 15), so no `{at, seconds}` entries are needed. All use `onlyIfMatch` CAS (`onlyIfNew` the first time). |
| `audit` | `<ISO timestamp>_<id>` | who approved what, commit SHA |

* **Proposal status set:** `pending → committing → committed | failed | stale`, and `pending → rejected`. Every transition is a compare-and-swap; only the request that wins `pending → committing` calls GitHub.
* **ID prefixes:** `p_` for proposals, `j_` for jobs; the rest is a ULID (26 characters, `[0-9A-Z]`). Validate with `^[pj]_[0-9A-Z]{26}$` before any lookup. (The knowledge example uses shorter test IDs; real code uses ULIDs.)
* **Approve cap, site-wide (ADR-0008): at most 14 committed approvals in any rolling 31 days, and at most 5 per calendar day in America/New_York.** One record, key `site:approvals` in `ratelimit`. `checkApproveCap()` is read-only and runs inside the single approve lock before any GitHub call; `recordApproval()` is a CAS append that runs only when the proposal reaches `committed`, so `failed`, `stale` and `rejected` never count and nothing needs refunding. Over the cap the function answers `429 approve_cap` with `retryAt`, and the proposal stays `pending`. The rolling window (not the calendar month) is what keeps any billing cycle of 31 days or less at or under 14 x 15 = 210 credits. Approve slots count only at `committed`; a record reconciled from `committing` to `committed`, and a ref update whose outcome was unknown but whose re-read of `main` shows the new commit, are recorded too (docs/04 §9). Tested, DST boundaries included: `knowledge/netlify-engineer/examples/03-cas-rate-limit-counter/` (19 tests, the Approve cap and the compute budget).
* **Compute budget, site-wide: `site:compute`, 180 function-minutes per rolling 31 days (number pending Dr. Lee).** `checkComputeBudget()` is read-only and runs before a chat turn (needs 60 s left) or a job (needs 5 min left); `recordCompute()` is a CAS add of the elapsed milliseconds when the turn or job ends and at each job progress write. Day buckets (New York days, window rounded outwards) keep the record small and slightly conservative. Over: `429 budget_exhausted`. The `jobs` and per-user counters do not replace it.
* `getStore` is site-wide and survives deploys (use it, not `getDeployStore`). Default consistency is **eventual (≤60 s propagation)** — use `strong` for approval state and counters.
* Limits: object ≤5 GB, key ≤600 bytes, store name ≤64 bytes (no `/` or `:`), metadata ≤2 KB. Last write wins unless you use `onlyIfMatch`/`onlyIfNew`. [Blobs docs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
* **Retention:** there is no automatic expiry. A daily scheduled function (`@daily`, 30 s limit, published deploys only) deletes jobs older than 7 days and counter keys older than their window; the audit log is kept.
* Never store secrets, tokens, or raw request headers.
* **Plan availability of Blobs on Free and any quota or price are UNVERIFIED** (re-check blocked today). Our volume is a few KB per record. First-deploy test: a function that writes one blob; if Free refuses, ask Dr. Lee before anything paid.

## 8. Deploys

### 8.1 Continuous deployment

Every push/merge to the production branch (`main`) triggers a production deploy. Deploys are atomic — nothing goes live until everything is uploaded. [deploy overview](https://docs.netlify.com/deploy/deploy-overview/) Never run `netlify deploy --prod` by hand.

### 8.2 Build skipping and credits

The `ignore` command in §3.1 skips commits that change nothing shipped. A skipped build is **expected** to cost 0 credits (the credits page lists only *successful* production deploys at 15, and failed deploys and rollbacks at 0); the skipped case is **UNVERIFIED**. Check the Usage page after the first skip.

### 8.3 Rollback

"Publish deploy" on any older successful deploy — instant, no rebuild, 0 credits. **Lock to stop auto publishing** pins production, so the next Approve does not overwrite the rollback; without the lock, the next Git-triggered deploy does. Deploys are retained 30 days (90 on paid); the published and the latest successful production deploy are kept. The step-by-step runbook is `docs/runbooks/rollback.md` (rollback, kill switch, secret leak, compromised super_admin). A rollback restores the older `sw.js` bytes, which differ from the bad one, so installed phones update back to it (§9.3).

### 8.4 "Live" in the Console

* **Primary signal: `/version.json`.** The build writes `{version, commit, builtAt}` (§9). Because deploys are atomic, a deploy's `version.json` is served only once that deploy is published. The Console polls `GET /version.json` (no-store) and shows **Live** when `commit` equals the approved commit SHA. It needs no function and costs no compute credits. `/version.json` must be network-only in the service worker (Pip).
* **Skipped builds never go "Live".** If an approved commit only touches skipped paths, no deploy happens and `version.json` does not change. The approve function should decide "no deploy needed" from the changed paths (the same list as the `ignore` command) and show "Committed, no deploy needed". Remy owns the wording; keep the two lists in step.
* **No `deploy-succeeded` function** (ADR-0006 point 8). It would be an unauthenticated function and would cost compute credits; polling `/version.json` is enough. `/version.json` is served `no-store` and must never be cached by the service worker.

### 8.5 Other

* **Deploy Previews** for PRs (`deploy-preview-N--site.netlify.app`) and branch deploys cost 0 credits. QA now runs on the main deploy with a rollback ready (ADR-0003, Dr. Lee's decision), not on previews. **Turning Deploy Previews and branch deploys off is required** (§6, layer 2), so no non-production deploy can run a function that holds a secret.
* **Build hooks:** `POST https://api.netlify.com/build_hooks/<id>` — not needed for the approve flow (the commit itself triggers the deploy), but useful as a manual "redeploy" button.

## 9. The service-worker version stamp (build step)

### 9.1 Problem

`sw.js` must keep one stable URL, and browsers update a service worker only when its **bytes** change. If `sw.js` is identical on every deploy, installed phones never get a new worker, so they keep the old app shell. (Pip's finding.) `sw.js` therefore contains `const VERSION = "__BUILD_VERSION__";` and the build replaces the placeholder on every deploy. `public/sw.js` is on the agents' deny list (decision 7), together with every file it imports, so an Approve cannot change it; but any approved change to `public/**` triggers a build that re-stamps it, so phones update.

### 9.2 Design: `scripts/stamp-sw.mjs`

Specified here, not built in this round. A working, tested copy is in `knowledge/netlify-engineer/examples/04-sw-version-stamp/` (12 tests pass, with `gen-config` and the smoke test). Run as the second step of the build command (§3.1), before `gen-config.mjs`.

| Rule | Detail |
|---|---|
| Input | `public/sw.js` with one or more `__BUILD_VERSION__` placeholders |
| Version | first 12 hex characters of `COMMIT_REF` (must be 40 hex, else ignored) → else `git rev-parse HEAD` → else timestamp `tYYYYMMDDhhmmss`. A fallback is used only so the bytes still change. |
| Output | `public/sw.js` with **every** placeholder replaced; `public/version.json` = `{version, commit, builtAt}` (`commit` is null for the timestamp fallback) |
| Log | **exactly one line**: `stamp-sw: version=<12 hex> source=<COMMIT_REF|git|timestamp> file=<path>`. It never prints `process.env`, and never reads variables other than `COMMIT_REF` and `NETLIFY`. |
| Fail loudly | exit 1 if the file is missing, the placeholder is missing (already stamped or removed), or the version is not `[A-Za-z0-9._-]{1,64}`. A failed build costs 0 credits and leaves the previous deploy live. |
| Local safety | refuses to edit unless `NETLIFY=true` or `--force`, so a local run cannot corrupt the tracked `sw.js` |
| Cache names | `beachday-shell-${VERSION}` (Pip, doc 02); old shell caches are deleted on `activate` |

`COMMIT_REF` and `NETLIFY=true` being set in the build are from the ignore-builds page read earlier (which names the Git metadata variables and `NETLIFY`); they were not re-read today (**UNVERIFIED here**). A missing `COMMIT_REF` falls back; a missing `NETLIFY=true` fails the build, which is the safe direction.

### 9.3 Post-deploy smoke test and the kill switch

* **Smoke test** (`scripts/smoke.mjs`, run by hand or by QA after each Approve deploy; example 04, tested against a local fake): `/sw.js` is 200 with no `__BUILD_VERSION__` left and `Cache-Control: no-cache`; it contains the version from `/version.json`; `/version.json.commit` equals the approved commit; the manifest has `application/manifest+json`; `/` carries the CSP with `form-action`; `Cross-Origin-Opener-Policy: same-origin`; and **every sync `/api` route (`agents`, `chat`, `jobs`, `jobs/:id`, `proposals/:id`, `reject`, `approve`) answers 401 with `cache-control: no-store` when sent no token** (a fail-closed check). **`/api/jobs-run` is deliberately excluded**: a background function always answers `202`, so it can never say 401 and a smoke check there would be meaningless; its guard is a unit test (example 01, test 10). Usage: `BASE_URL=https://<site> EXPECT_COMMIT=<sha> node scripts/smoke.mjs`. It never sends credentials. A role check (403 for a non-admin) needs a test account and belongs to QA's suite, not the smoke test.
* **Installed phones after a rollback.** Browsers compare bytes, not version numbers. Publishing an older deploy puts an older `sw.js` in place, which differs from the bad one, so phones update to it. Locking auto-publishing (§8.3) stops the next Approve from replacing it.
* **Kill switch** (for a service worker that breaks the app shell). A human ships a replacement `public/sw.js` that, on `activate`, deletes every cache, calls `self.registration.unregister()` and navigates open clients to reload. The tested file is in `docs/runbooks/rollback.md` §2a (steps in §2); it is not kept in `public/`. It must carry a `// kill-switch __BUILD_VERSION__` line so `stamp-sw.mjs` does not exit 1. Because `sw.js` is deny-listed, only a human commit can ship it, which is the point. Browsers re-check `sw.js` on navigation, and `Cache-Control: no-cache` keeps the CDN from serving a stale copy; the 24-hour re-check bound is general web-platform behaviour, not a Netlify fact.

### 9.4 No test runner in the build (decided)

**Decision (security-engineer, docs/04 §4.7): the Netlify build never runs `vitest` or any test runner.** Kai's brief had suggested `vitest run && ...`; that is not adopted.

* On Free there are no env-var scopes, so **everything executed during the build sees every secret**, including `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`.
* `tests/**` is on the **allow** list for agents, and stays there (agents writing tests is how the gates stay green). A proposed test file would run as code at build time with those secrets. A human approves the diff, but a test is exactly where a one-line `fetch(...process.env...)` is easy to miss.
* Secret scanning looks for secret values in the repo and the **build output** ([secrets controller](https://docs.netlify.com/build/environment-variables/secrets-controller/)); whether it also reads the build *log*, and whether it catches a value sent over the network, is **UNVERIFIED**, so it is a backstop, not a control.
* **Tests run in GitHub Actions** with `permissions: contents: read`, no repository secrets, no `pull_request_target` and actions pinned by SHA; `.github/**` is denied to agents. QA reads the result on the main deploy with a rollback ready (ADR-0003). Humans running an agent-written test locally treat it as untrusted code and use a shell without real secrets.

The same reasoning is why `scripts/build-agents.mjs` must treat `.claude/agents/*.md` as **data**: parse the front matter, never `eval`, `import` or execute anything from it.

### 9.5 Design: `scripts/gen-config.mjs` (browser config, ADR-0006 point 3)

Specified here, not built in this round. A working, tested copy is `gen-config.mjs` in `knowledge/netlify-engineer/examples/04-sw-version-stamp/` (5 tests, re-run in wave 3, with fixtures built at runtime). It is the last build step (§3.1).

| Rule | Detail |
|---|---|
| Input | exactly three variables, read by name: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `COMMIT_REF`, plus the file `public/_headers`. It never iterates over `process.env`. |
| Output | `public/generated/config.js`, which exports `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `BUILD_VERSION` (the same 12-hex version as `sw.js`). The build creates the folder. The file is **git-ignored**, like `public/version.json`. |
| Fails the build | exit 1 unless the key starts with `sb_publishable_` (and has the expected shape), and unless the URL is a bare `https` origin. This catches a pasted `sb_secret_` key and the legacy JWT-style `anon` / `service_role` keys. **Also exit 1 if the CSP `connect-src` in `public/_headers` does not list exactly the `SUPABASE_URL` origin, names any other `supabase.co` host, uses a wildcard, or still holds the `<project-ref>` placeholder** (docs/04 §10; a missing `_headers` fails closed too). A failed build costs 0 credits and leaves the previous deploy live. |
| Log | one line, `gen-config: wrote <path> (version source=<...>)`. **A rejected value is never echoed**, because it might be a secret key. |
| Local safety | refuses to write unless `NETLIFY=true` or `--force`. |
| Contexts | Deploy Previews and branch deploys also need both variables (§6 sets them for all contexts), or those builds fail. That costs 0 credits. |

* **Not a secret.** Both values are public by design. They ship in `config.js` to every Console visitor, so they are not marked secret (§6).
* **Secret scanning [UNVERIFIED].** Netlify scans build output for secret values; these two are not secret, so `config.js` should pass. Whether the scan also looks at non-secret values by default could not be re-read (docs.netlify.com did not resolve from the sandbox). The first real deploy is the test. If the scan fails the build on `public/generated/config.js`, set `SECRETS_SCAN_OMIT_KEYS=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY` in the UI. Do not turn scanning off (register item 13).
* **Headers.** `config.js` is a static file under `public/`, so `_headers` applies to it. Whether it needs its own cache rule is security-engineer's call (CSP and headers are not changed here).
* **Not edited by agents.** `public/generated/**`, `public/vendor/**` and `public/version.json` are on the Console deny list (docs/04 §6).

## 10. Plans & cost (credit-based, since 4 Sep 2025)

| Plan | Price | Credits/month |
|---|---|---|
| Free | $0 | 300 (hard cap — projects pause when exhausted) |
| Personal | $9/mo | 1,000 |
| Pro | $20/mo | 3,000+ |

Credit costs: **production deploy 15** (successful only), failed deploys and rollbacks 0, Deploy Previews and branch deploys 0, compute 10 / GB-hour, bandwidth 20 / GB, web requests 2 / 10k. [pricing](https://www.netlify.com/pricing/), [how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)

**Decided (ADR-0004): stay on the Free plan for now.** Revisit when the 300-credit cap gets close. Upgrading is Dr. Lee's decision, with an ADR.

**Budget.** 300 ÷ 15 = 20 production deploys a month if nothing else is used. The **Approve cap of 14 in a rolling 31 days (ADR-0008) costs at most 210 credits in any billing cycle, which is exactly 70%**. Proposed split (netlify-engineer's proposal, not a decision): 210 Approves, 45 for human pushes (3 deploys), 45 for compute, bandwidth and requests. Compute is bounded by the **site-wide compute budget** (180 function-minutes per rolling 31 days, about 30 credits at 1024 MB; **number pending Dr. Lee**; billed duration **UNVERIFIED**), which leaves about 15 for bandwidth and requests. Warnings to Dr. Lee: **70% (210)** and **90% (270)**, read from the Usage page. The 70% mark is reached by Approves alone, so the useful early signal is spend that is *not* Approve deploys. Community reports (titles only, not read) mention Free-plan production deploys paused while credits appeared to remain; trust the Usage page over arithmetic **[UNVERIFIED]**.

**Credit impact of the docs-only push planned for this round.** **Update (Dr. Lee, 2026-11-23): no Netlify site is linked yet, so a push to `main` costs 0 credits for now.** The paragraph below is what happens once a site is linked. There is no `netlify.toml` and no `ignore` rule in the repo yet. If a Netlify site is linked to `fenago/BeachDay`, Netlify's default is to cancel the build only when nothing changed in the base directory ([ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)); a docs change is a change, so that push would run a production deploy: **15 credits (5% of 300)**, and every earlier push did the same. If no site is linked, the cost is **0**. I cannot tell which: the GitHub API shows no check runs, statuses or deployments on `main`, which weakly suggests no linked site, and nothing in the repo says otherwise. Also unknown: the site's publish directory setting; with no `netlify.toml`, a blank setting would publish the repo root (docs, knowledge and `.claude` as static files). The repo is public, so nothing secret is exposed, but the site would be wrong. Dr. Lee: check the site's Deploys page and settings before this push. **One push, not several.** The later commit that adds `netlify.toml` will itself build once (15 credits), because `netlify.toml` is on the watch list.

**Mitigations for the Approve volume:** batch several file changes into one commit (Git Database API, doc 04), keep the `ignore` command, count Approves in Blobs (§7), and consider Personal ($9) once the Console is in regular use.

| Feature | Free | Pro+ |
|---|---|---|
| Functions, background & scheduled functions, Blobs (**unverified**), Secrets Controller, code-based rate limits (2 rules), basic firewall (2 rules) | ✓ | ✓ (more rules) |
| Site password / Basic-Auth via `_headers` | ✗ | ✓ |
| Env-var scopes, per-context scoping (**unverified** on Free), function region, custom memory | ✗ | ✓ |

Netlify's site password is Pro-only and does not protect functions anyway; the Console's gate is Supabase Auth plus the token and role check in every function (docs/04).

## 11. Local development

* `npm i -g netlify-cli`, `netlify link`, then `netlify dev` — static site + functions at `http://localhost:8888`, with local env (Local development context) and a sandboxed local Blobs store (it cannot read production data).
* `netlify functions:serve` (port 9999) to run only functions; `netlify functions:invoke <name> --payload '{...}'`.
* `netlify deploy` creates a **draft** only. **Never `netlify deploy --prod`**: `main` auto-deploys.
* Running `node scripts/stamp-sw.mjs` locally is refused unless `--force`; use a copy of `sw.js` when you try it.

## 12. UNVERIFIED register (2026-11-23)

`docs.netlify.com` did not resolve from the sandbox during this round (DNS failure), and one web search turned up nothing on these points. Each item has a cheap real-world test.

| # | Item | What I assumed | Test |
|---|---|---|---|
| 1 | Per-context env values on Free | Secret can be set `--context production` | `env:set` then `env:list --context deploy-preview`; fallback: no previews |
| 2 | Blobs on Free, quota | Available, tiny volume | first deploy writes a blob |
| 3 | Credit cost of a build skipped by `ignore` | 0 | Usage page after the first skip |
| 4 | AI Gateway opt-out and injected variables | Unknown | explicit `baseURL`; compare Anthropic vs Netlify usage |
| 5 | Fork / untrusted deploy default | Unknown | Dr. Lee checks the setting |
| 6 | `_headers` + `[[headers]]` merge | Avoided | validator enforces one source |
| 7 | `CACHED_COMMIT_REF` on a first build | Possibly empty | guarded `ignore` |
| 8 | `NODE_VERSION` key; `COMMIT_REF` and `NETLIFY` in builds | As documented earlier | deploy log, first lines |
| 9 | `deploy-succeeded` function name and payload | **Closed:** the function is dropped (ADR-0006 point 8); the Console polls `/version.json` | none |
| 10 | Whether `Strict-Transport-Security` is already added by Netlify | Setting it is harmless | `curl -I` |
| 11 | Third code-based rate-limit rule on Free | Do not add one | deploy log |
| 12 | Whether this site is linked, and its publish directory | Dr. Lee says **not linked yet** (0 credits per push); publish directory unknown until it is | when linking: set publish to `public`, add `netlify.toml` first |
| 13 | Netlify secret scanning and the non-secret publishable key in `public/generated/config.js` | Passes (not a secret) | first real deploy; fallback `SECRETS_SCAN_OMIT_KEYS` |
| 14 | Billed function duration, so what 180 function-minutes cost | About 30 credits at 1024 MB (10 credits per GB-hour) | Usage page after the first week of chat; adjust `site:compute` with Dr. Lee |
| 15 | Whether Deploy Previews and branch deploys can be turned off on Free, and the setting's name | Yes (now **required**, §6 layer 2) | Site settings, build and deploy; if not available, tell Dr. Lee: the production-context check in code is then the only barrier left |
