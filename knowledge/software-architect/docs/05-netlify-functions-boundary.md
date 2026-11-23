# Netlify Functions: the server-side boundary
Source: https://docs.netlify.com/build/functions/overview/ ; https://docs.netlify.com/build/functions/get-started/ ; limits as cited in docs/03-architecture-netlify.md (https://docs.netlify.com/build/functions/configuration/#default-values, https://docs.netlify.com/build/functions/background-functions/)
Retrieved: 2026-11-23

## What a function is

From [Functions overview](https://docs.netlify.com/build/functions/overview/):

- "A function is a file in your project that contains server-side code for responding to an event." Netlify runs it "in an ephemeral runtime environment" and scales it automatically.
- **Web requests:** the function "receives a `Request` and a `Context`, and returns a `Response`". A `config` object sets "the URL paths that the function runs on or the HTTP method it responds to".

```ts
import type { Config, Context } from "@netlify/functions"
export default async (req: Request, context: Context) => new Response("Hello, world!")
export const config: Config = { path: "/hello" }   // also: method: "POST"
```

- Alternative "Fetchable module" shape: `export default { fetch(req, context) {...}, config: {...} } satisfies NetlifyFunction`.
- **Platform events:** the same default-export object can carry named handlers such as `deploySucceeded(event)`, which "Runs after every successful deploy".
- "Functions deployed from Netlify are immutable". A production update doesn't change functions in earlier branch deploys or Deploy Previews. Functions are "version-controlled, built, and deployed along with the rest of your Netlify site" and get instant rollbacks.

## Files and routes

From [Get started](https://docs.netlify.com/build/functions/get-started/):

- The functions directory "defaults to `netlify/functions/`". `netlify/functions/hello.mts`, `hello/hello.mts` or `hello/index.mts` all create the function `hello`.
- With `config.path: "/hello"` the function is at `https://<domain>/hello`. The repo's docs/03 adds that a custom `path` removes the default `/.netlify/functions/<name>` URL; that wasn't re-read here.

## Limits (as recorded in docs/03, from Netlify docs; not re-read in this retrieval)

| Kind | Limit |
|---|---|
| Synchronous | **60 s** |
| Streaming response | **60 s**, **20 MB** |
| Background (`config.background: true`) | **15 min**; 256 KB request; returns `202` immediately; retried after 1 and 2 min on failure; can't stream; return value discarded |
| `config.rateLimit` rules on Free | 2 (ADR-0004) |

## Beach Day notes: the boundary as a contract

ADR-0006 (which superseded and restated ADR-0001): functions exist **only** for the Claude API and GitHub calls behind the Agent Console, plus the Console's agent-list, job and proposal endpoints and Blobs state. Sign-in is **not** a function: the Console page calls Supabase Auth directly, and every function verifies the Bearer token and `super_admin` role (fail closed).

| Route (docs/04 §2) | Kind | Talks to | Contract |
|---|---|---|---|
| `GET /api/agents` | sync | bundled `agents.json` | agent list (no prompts); `403` tells the UI "no access" |
| `POST /api/chat` | sync, streaming | Claude, GitHub (GET at pinned `main`, ADR-0007) | SSE union (`examples/02-interface-contracts/schemas/sse-event.schema.json`) |
| `POST /api/jobs` | sync | Blobs | `202 {jobId}`; creates `j_…` + single-use nonce, calls `jobs-run` |
| `POST /api/jobs-run` | background | Claude, GitHub (GET), Blobs | re-checks Bearer + role, consumes nonce (CAS) |
| `GET /api/jobs/:id` | sync | Blobs | job events |
| `GET /api/proposals/:id` | sync | Blobs | Proposal record (`proposal.schema.json`) |
| `POST /api/proposals/:id/approve` | sync | Blobs, GitHub | step-up, re-validate, cap (ADR-0008) → atomic commit (ADR-0003) |
| `POST /api/proposals/:id/reject` | sync | Blobs | status → rejected |

**Never on the server side:**

- Open-Meteo calls. The browser calls Open-Meteo directly; Open-Meteo rate-limits shared hosts early.
- Scoring or normalisation, a weather cache, or an NWS proxy (ADR-0002).

Every route above first calls Supabase (verify the token; read `profiles.role` as the caller) and fails closed: 401 / 403 / 503.

Any of these needs a new ADR that supersedes ADR-0006.

Design rules that follow:

1. **One contract, two sides.** Request and response shapes for each route are JSON Schemas in a shared module. The function validates input before doing work; the client validates output before rendering. See the ajv example.
2. **Every function begins `requireAuth()`** (token + `super_admin` role, docs/04 §4, ADR-0006). There are no exceptions and no unauthenticated functions. Background functions can't answer the caller, so the sync `/api/jobs` wrapper authenticates first, and `jobs-run` authenticates again and consumes a single-use nonce.
3. **Idempotent background work.** Key by job ID, check status first, write with `onlyIfNew` (Blobs), never commit from a job. Commits happen only in approve.
4. **Time budget inside 60 s.** The chat function hands off to a job at about 45 s by emitting `handoff`.
5. **No event functions.** `deploySucceeded` was dropped (ADR-0006 §8) because it can't carry a Bearer token. The Console's "Live" state comes from polling `/version.json`.
6. **Immutable deploys:** a Deploy Preview runs that commit's function code. Production secrets (`GITHUB_TOKEN`) are meant to exist only in the Production context (ADR-0005), so preview functions can't commit or read GitHub. Whether Free can scope env per context is [UNVERIFIED]; see docs/03.
7. Any new route, store or external call is a **trust-boundary change**. It needs security-engineer + netlify-engineer review and, if it changes ADR-0006's scope, a Proposed ADR. Auth changes also need supabase-auth-engineer.
