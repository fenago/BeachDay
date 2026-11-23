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

ADR-0001: functions exist **only** for the Claude API and GitHub calls behind the Agent Console. That includes the Console's own login, job and proposal endpoints, and Blobs state.

| Route (docs/04 §2) | Kind | Talks to | Contract |
|---|---|---|---|
| `POST /api/login`, `POST /api/logout` | sync | Blobs (throttle) | cookie in, cookie out |
| `GET /api/agents` | sync | bundled `agents.json` | agent list (no prompts) |
| `POST /api/chat` | sync, streaming | Claude | SSE union (`examples/02-interface-contracts/schemas/sse-event.schema.json`) |
| `POST /api/jobs` → background | background | Claude, Blobs | `202`; job record in Blobs |
| `GET /api/jobs/:id` | sync | Blobs | job events |
| `GET /api/proposals/:id` | sync | Blobs | Proposal record (`proposal.schema.json`) |
| `POST /api/proposals/:id/approve` | sync | Blobs, GitHub | re-validate → atomic commit (ADR-0003) |
| `POST /api/proposals/:id/reject` | sync | Blobs | status → rejected |

**Never on the server side:**

- Open-Meteo calls. The browser calls Open-Meteo directly; Open-Meteo rate-limits shared hosts early.
- Scoring or normalisation, a weather cache, or an NWS proxy (ADR-0002).

Any of these needs a new ADR that supersedes ADR-0001.

Design rules that follow:

1. **One contract, two sides.** Request and response shapes for each route are JSON Schemas in a shared module. The function validates input before doing work; the client validates output before rendering. See the ajv example.
2. **Every function begins `requireSession()`** (docs/04 §4), except `login`. Background functions can't answer the caller, so the sync `/api/jobs` wrapper authenticates, then hands off.
3. **Idempotent background work.** Key by job ID, check status first, write with `onlyIfNew` (Blobs), never commit from a job. Commits happen only in approve.
4. **Time budget inside 60 s.** The chat function hands off to a job at about 45 s by emitting `handoff`.
5. **Event functions** (`deploySucceeded`) may write deploy status to Blobs for the Console's "Live" state. That is Console plumbing, so it stays within ADR-0001's spirit; note it in the design doc.
6. **Immutable deploys:** a Deploy Preview runs that commit's function code. Production secrets (`GITHUB_TOKEN`) exist only in the Production context (ADR-0005), so preview functions can't commit.
7. Any new route, store or external call is a **trust-boundary change**. It needs security-engineer + netlify-engineer review and, if it changes ADR-0001's scope, a Proposed ADR.
