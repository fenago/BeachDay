# 03 — Architecture: static Netlify site + Netlify Functions

> Decision on record: Beach Day is a PWA on Netlify — a static front end, Netlify Functions for the Claude and GitHub calls, and no other servers. Researched against docs.netlify.com on 2026-11-23 (credit-based plans, introduced 4 Sep 2025). Items marked **unverified** need a check before relying on them.

## 1. Big picture

```
 Phone (installed PWA)
 ├─ index.html / app.js / styles.css / sw.js / manifest.webmanifest   ← static, CDN
 ├─ fetch ──► api.open-meteo.com          (direct from browser, keyless, CORS)
 ├─ fetch ──► marine-api.open-meteo.com   (direct from browser)
 └─ /console  (Agent Console UI, static)
       │  fetch /api/*  (same origin, session cookie)
       ▼
 Netlify Functions (Node 24, netlify/functions/)
 ├─ /api/login            password gate → signed HttpOnly cookie
 ├─ /api/agents           list agents (from build-time agents.json)
 ├─ /api/chat             streaming proxy → Claude Messages API   (≤60 s)
 ├─ /api/jobs  (background) long agent jobs → status in Blobs     (≤15 min)
 ├─ /api/jobs/:id         poll job status/output from Blobs
 ├─ /api/proposals/:id    read a proposal (diff) from Blobs
 └─ /api/approve          re-validate → commit to GitHub → Netlify auto-deploys
       │                    │
       ▼                    ▼
 Netlify Blobs          api.github.com (fine-grained PAT, this repo only)
 (proposals, jobs,             │ push to main
  rate-limit counters,         ▼
  audit log)            Netlify continuous deployment → new atomic deploy
```

Why weather calls skip Functions: Open-Meteo is keyless and CORS-enabled, so a proxy adds latency, cost (credits) and a failure point for no security gain. The service worker caches responses instead (doc 02). A function proxy is only worth adding if we later need a shared cache or a commercial API key.

## 2. Repository layout (proposed)

```
/
├─ netlify.toml
├─ package.json            "type": "module"
├─ public/                 ← publish directory (static)
│  ├─ index.html, console.html
│  ├─ manifest.webmanifest, sw.js, offline.html
│  ├─ icons/               192, 512, maskable, apple-touch-icon 180
│  ├─ js/  (ES modules: api/openmeteo.js, score.js, ui/*.js, console/*.js)
│  ├─ css/
│  └─ _headers
├─ netlify/functions/      ← kept outside publish dir
│  ├─ login.mts, agents.mts, chat.mts, jobs.mts, job-status.mts, approve.mts
│  └─ lib/ (auth.mts, ratelimit.mts, github.mts, claude.mts, allowlist.mts)
├─ scripts/build-agents.mjs   parses .claude/agents/*.md → netlify/functions/lib/agents.json
├─ .claude/agents/ , .claude/skills/
├─ tests/ (unit/, e2e/, fixtures/)
└─ docs/
```

No framework is required; plain ES modules keep the bundle tiny and the service worker simple. A build step exists only to generate `agents.json` and, optionally, a cache-busting version for the service worker.

## 3. `netlify.toml` sketch

```toml
[build]
  command = "node scripts/build-agents.mjs"
  publish = "public"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  included_files = ["netlify/functions/lib/agents.json"]

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/manifest.webmanifest"
  [headers.values]
    Content-Type = "application/manifest+json"

[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(self), camera=(), microphone=()"
```

Notes:

* Custom headers (`_headers` / `[[headers]]`) apply only to static files Netlify serves — **not** to function responses. Each function must set its own security headers (`Cache-Control: no-store`, `Content-Type`, etc.). [headers docs](https://docs.netlify.com/manage/routing/headers/)
* Variables declared in `netlify.toml` are **not** available to functions — set secrets in the UI/CLI. [functions env vars](https://docs.netlify.com/build/functions/environment-variables/)
* Per-context overrides: `[context.production]`, `[context.deploy-preview]`, `[context.branch-deploy]`. [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)

## 4. Netlify Functions (modern syntax)

```ts
// netlify/functions/chat.mts
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  // auth + rate limit + validate, then stream (see doc 04)
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
};

export const config: Config = {
  path: "/api/chat",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
```

* Config fields: `path` (URLPattern, named groups in `context.params`), `excludedPath`, `method`, `preferStatic`, `background`, `schedule`, `rateLimit`, `region`, `memory`, `vcpu`. A custom `path` removes the default `/.netlify/functions/<name>` URL. [API reference](https://docs.netlify.com/build/functions/api/)
* `context` gives `ip`, `geo`, `cookies` (get/set/delete), `deploy`, `site`, `requestId`, `params`, `waitUntil()`.
* Runtime: the build's Node version if it is a valid Lambda runtime, else **Node.js 24**. `.mts` = ESM; TypeScript works without a separate build step. [configuration](https://docs.netlify.com/build/functions/configuration/)
* Default region `cmh` (Ohio); changing it is Pro+.

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

1. **Chat turns** → `/api/chat`, a synchronous streaming function. Set the Anthropic SDK `timeout` to ~55 s and cap `max_tokens` / tool rounds so a turn finishes inside 60 s. If it can't, the function emits a "continuing in background" event and hands off.
2. **Long jobs** (multi-file proposals, many tool rounds) → `/api/jobs` background function (15 min). It writes progress events and the final proposal to Blobs; the UI polls `/api/jobs/:id` every 2–3 s.
3. Edge Functions are **not** used for the Claude proxy: streaming duration for edge is undocumented (**unverified**) and env/headers behave differently; the serverless 60 s stream is the documented path.

## 6. Environment variables & secrets

| Variable | Scope | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Functions | Mark **Contains secret values**. Dedicated Anthropic workspace + low spend limit (doc 05). |
| `GITHUB_TOKEN` | Functions | Fine-grained PAT, this repo only, Contents R/W (doc 04). Secret. |
| `GITHUB_REPO` | Functions | `fenago/BeachDay`; not secret. |
| `CONSOLE_PASSWORD_HASH` | Functions | Hash (scrypt/argon2), never the raw password. Secret. |
| `SESSION_SECRET` | Functions | HMAC key for session cookies. Secret. |

* Set via UI or CLI: `netlify env:set GITHUB_TOKEN <value> --context production --secret`. [CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)
* **Secrets Controller**: secret values are write-only, need explicit contexts/scopes, can't use post-processing scope; secret scanning fails a build if a secret value appears in the repo or build output (`SECRETS_SCAN_ENABLED` default true). [secrets controller](https://docs.netlify.com/build/environment-variables/secrets-controller/)
* Choosing **scopes** (Builds/Functions/Runtime/Post-processing) is Pro+. On Free, variables are visible to builds too — another reason to keep the build script from ever printing env.
* Limits: key ≤255 chars, value ≤5,000 chars. The 4 KB total limit applies only in Lambda-compat mode.
* Read in functions with `process.env.X` (or `Netlify.env.get("X")`).
* Give **Deploy Preview** and **branch** contexts *different* (or no) GitHub token so a preview build can never commit to main.

## 7. Netlify Blobs — the app's only state

```ts
import { getStore } from "@netlify/blobs";
const proposals = getStore({ name: "proposals", consistency: "strong" });
await proposals.setJSON(id, proposal, { onlyIfNew: true });
const { etag } = await proposals.getWithMetadata(id, { type: "json" });
await proposals.setJSON(id, { ...p, status: "approved" }, { onlyIfMatch: etag }); // compare-and-swap
```

| Store | Key | Contents |
|---|---|---|
| `proposals` | proposal ID | agent, summary, files (path + new content + base SHA), status (`pending/approved/rejected/committed/failed`), timestamps |
| `jobs` | job ID | status, progress events, result proposal ID, error |
| `ratelimit` | `user:<id>:<window>` | counters (use `onlyIfMatch` CAS) |
| `audit` | ISO timestamp + ID | who approved what, commit SHA |

* `getStore` is site-wide and survives deploys (use it, not `getDeployStore`). Default consistency is **eventual (≤60 s propagation)** — use `strong` for approval state and counters.
* Limits: object ≤5 GB, key ≤600 bytes, store name ≤64 bytes (no `/` or `:`), metadata ≤2 KB. Last write wins unless you use `onlyIfMatch`/`onlyIfNew`. [Blobs docs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
* Plan availability and Blobs pricing: **unverified** — check the pricing page before launch.

## 8. Deploys

* **Continuous deployment:** every push/merge to the production branch (`main`) triggers a production deploy. Deploys are atomic — nothing goes live until everything is uploaded. [deploy overview](https://docs.netlify.com/deploy/deploy-overview/)
* **Rollback:** "Publish deploy" on any older deploy — instant, no rebuild. "Lock to stop auto publishing" pauses production. Deploys retained 30 days (90 on paid).
* **Deploy Previews** for PRs (`deploy-preview-N--site.netlify.app`) and branch deploys (`branch--site.netlify.app`) — QA runs against these (doc 06).
* **Build hooks:** `POST https://api.netlify.com/build_hooks/<id>` — not needed for the approve flow (the commit itself triggers the deploy), but useful as a manual "redeploy" button.
* **Ignore builds:** `[build] ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- public netlify"` to skip deploys for docs-only commits (exit 0 = skip). This saves credits.
* Event functions (e.g. `deploy-succeeded`) can record "your approved change is live" in Blobs for the Console to show. [trigger on events](https://docs.netlify.com/build/functions/trigger-on-events/)

## 9. Plans & cost (credit-based, since 4 Sep 2025)

| Plan | Price | Credits/month |
|---|---|---|
| Free | $0 | 300 (hard cap — projects pause when exhausted) |
| Personal | $9/mo | 1,000 |
| Pro | $20/mo | 3,000+ |

Credit costs: **production deploy 15**, compute 10 / GB-hour, bandwidth 20 / GB, web requests 2 / 10k. [pricing](https://www.netlify.com/pricing/), [how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)

**Important:** on Free, 300 credits ≈ **20 production deploys/month** with nothing else used. Every approved Agent Console change is a production deploy. Mitigations: batch several file changes into one commit (Git Database API, doc 04), use the ignore command for docs-only commits, consider Personal ($9) once the Console is in regular use, and enable auto-recharge or watch usage so the site doesn't pause.

| Feature | Free | Pro+ |
|---|---|---|
| Functions, background & scheduled functions, Blobs (**unverified**), Identity, Secrets Controller, code-based rate limits (2 rules), basic firewall (2 rules) | ✓ | ✓ (more rules) |
| Site password / Basic-Auth via `_headers` | ✗ | ✓ |
| Env-var scopes, function region, custom memory | ✗ | ✓ |

Because Netlify's site password is Pro-only and does not protect functions anyway, the Agent Console uses an **app-level password gate in the functions** (doc 04).

## 10. Local development

* `npm i -g netlify-cli`, `netlify link`, then `netlify dev` — static site + functions at `http://localhost:8888`, with local env (Local development context) and a sandboxed local Blobs store.
* `netlify functions:serve` (port 9999) to run only functions; `netlify functions:invoke <name> --payload '{...}'`.
* `netlify deploy` (draft) / `netlify deploy --prod`.
