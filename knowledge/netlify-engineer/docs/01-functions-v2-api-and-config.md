# Netlify Functions v2: API, config object, routing and limits
Source: https://docs.netlify.com/build/functions/api/ , https://docs.netlify.com/build/functions/configuration/
Retrieved: 2026-11-23

## Handler signature (web requests)
- A function file's **default export** receives a web `Request` and a Netlify `Context`, and returns a web `Response`. [api](https://docs.netlify.com/build/functions/api/)
  ```js
  export default async (req, context) => new Response("Hello, world!");
  export const config = { path: "/hello" };
  ```
- An equivalent "Fetchable module" form exists: `export default { fetch(req, context) { ... } }`. Its config goes in the `config` property of that default export. [api](https://docs.netlify.com/build/functions/api/)
- Platform-event handlers, such as `deploySucceeded(event)`, are exported as named methods of the default object. They **always run in the background**, and no response goes to a client. Types: `DeploySucceededEvent`, `DeployFailedEvent` and others from `@netlify/functions`. [api](https://docs.netlify.com/build/functions/api/)

## Streaming
- Return a `ReadableStream` as the `Response` body to stream.
- Streaming has a **60-second execution limit** and a **20 MB response size limit**. [api](https://docs.netlify.com/build/functions/api/)
- An upstream `res.body` can be passed straight through: `new Response(res.body, { headers: { "content-type": "text/event-stream" } })`. [api](https://docs.netlify.com/build/functions/api/)

## `Context` object (fields we use)
| Field | Meaning |
|---|---|
| `cookies.get(name)` / `cookies.set(options)` / `cookies.delete(name \| options)` | Read request cookies and set or delete response cookies. The `set` options follow `CookieStore.set`. |
| `ip` | Client IP string |
| `params` | Named groups from `config.path`. For example, `/pets/:name` gives `{ name: "boo" }`. Read the query string from `req.url`. |
| `requestId` | Netlify request ID |
| `deploy.context`, `deploy.id`, `deploy.published` | Deploy context, deploy ID, and whether this is the published deploy |
| `site.id`, `site.name`, `site.url` | Site metadata |
| `geo`, `server.region`, `account.id` | Geolocation, region and team |
| `waitUntil(promise)` | Keep running after the response is sent. Still bounded by the execution limit, and billed for the full duration. |
| `user` | The Netlify user, only for private or team-login-protected projects. `undefined` with basic password protection. Not available in the local CLI. |

Source for all rows: [api § Context](https://docs.netlify.com/build/functions/api/#context-object).

Cookie options in the installed types (`@netlify/types` 1.x, read locally) are `name`, `value`, `expires`, `maxAge` (seconds), `domain`, `path`, `secure`, `httpOnly`, `sameSite: 'Strict' | 'Lax' | 'None'`. Cookies cannot be shared across `*.netlify.app` subdomains, because `netlify.app` is on the Public Suffix List. [api](https://docs.netlify.com/build/functions/api/)

## `config` export
| Key | Type | Notes |
|---|---|---|
| `path` | `string \| string[]` | Must start with `/`. URLPattern syntax (`*`, `:name`). A custom path **removes** the default `/.netlify/functions/<name>` URL. Mutually exclusive with `schedule`. |
| `excludedPath` | `string \| string[]` | Carve-outs from `path`. |
| `method` | `'GET'\|'POST'\|'PUT'\|'PATCH'\|'DELETE'\|'OPTIONS'` or an array | Default: all methods. |
| `preferStatic` | `boolean` | Run only when no static file matches. |
| `rateLimit` | `{ windowLimit, windowSize, aggregateBy, action?, to? }` | See doc 06. Requires `path`. |
| `background` | `boolean` | Background mode: the client gets `202` and the return value is discarded. See doc 02. |
| `schedule` | cron string | See doc 02. |
| `region` | airport code | **Pro and Enterprise** only. |
| `memory` (1024–4096 MB) / `vcpu` (0.5–2) | number | **Credit-based Pro and Enterprise only.** Mutually exclusive. |

Sources: [api § Config](https://docs.netlify.com/build/functions/api/#config-object), [configuration](https://docs.netlify.com/build/functions/configuration/)

## Default limits ("Configurable? No" for us)
| Setting | Default |
|---|---|
| Region | `cmh` (US East, Ohio) |
| Memory | 1024 MB |
| Synchronous execution | **60 seconds** |
| Scheduled execution | **30 seconds** |
| Background execution | **15 minutes** |
| Buffered request/response payload | **6 MB** (binary bodies are Base64-encoded, so about 4.5 MB effective) |
| Streamed response payload | **20 MB** |
| Background request/response payload | **256 KB** |

Source: [configuration § Default values](https://docs.netlify.com/build/functions/configuration/#default-values)

## Directory, bundling, runtime, module format
- Default directory: `<base>/netlify/functions`. It can be overridden by `[functions] directory` in `netlify.toml`, which **overrides the UI**. Keep it **outside the publish directory**. [configuration](https://docs.netlify.com/build/functions/configuration/)
- `[functions] node_bundler = "esbuild"`, `external_node_modules`, and `included_files` (globs; `!` excludes). TypeScript always uses esbuild. [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- **Node runtime:**
  - Functions use the **build's Node version** if it is a valid AWS Lambda runtime that isn't due for deprecation in the next two months. Otherwise they fall back to **Node.js 24**.
  - To override it, set `AWS_LAMBDA_JS_RUNTIME` (for example `nodejs24.x`) in the UI, CLI or API, **not** in `netlify.toml`, then redeploy.
  - [configuration](https://docs.netlify.com/build/functions/configuration/#nodejs-version-for-runtime)
- **Module format:**
  - `.mts`/`.mjs` files are always ESM, and `.cts`/`.cjs` files are always CJS.
  - `.ts`/`.js` files follow `"type"` in the nearest `package.json`.
  - In ESM, use `import.meta.url` instead of `__dirname`, and import CommonJS packages with a default import.
  - [configuration § Module format](https://docs.netlify.com/build/functions/configuration/#module-format)

## Helpers
- `npm install @netlify/functions` provides the types (`Config`, `Context`, event types) and `getContext()`, which throws when called outside a request. [api](https://docs.netlify.com/build/functions/api/)
- `@netlify/aws-lambda-compat` `withLambda()` wraps old Lambda-style handlers. Beach Day doesn't need it. [api](https://docs.netlify.com/build/functions/api/)

## Beach Day notes
- Every Console endpoint (`/api/agents`, `/api/chat`, `/api/jobs`, `/api/jobs/run`, `/api/jobs/:id`, `/api/proposals/:id`, `/api/proposals/:id/approve`, `/api/proposals/:id/reject`) gets a `config.path` and a `config.method`. There is **no `/api/login`**: sign-in is Supabase Auth, called from the browser (ADR-0006). Every `/api/*` handler starts with a bearer-token check and a role check that fail closed (401, 403, 503); see example 01, `lib/guard.mjs`. With custom paths, the `/.netlify/functions/*` URLs disappear, which shrinks the attack surface.
- **Functions set their own headers.** `_headers` does not reach function responses. Use `cache-control: no-store`, `x-content-type-options: nosniff` and a JSON or SSE content type. See example 01, `lib/http.mjs`.
- **Time budget:**
  - `/api/chat` streams and must finish within **60 s**. Set the Anthropic SDK timeout to **50 s** (Kai's call, 2026-11-23).
  - Long work goes to a background function (**15 min**) with progress in Blobs.
  - The background request payload is only **256 KB**, so pass a job ID, not the conversation.
- `region`, `memory` and `vcpu` are Pro-only. Don't use them (ADR-0004). The default `cmh` region is fine.
- Use `.mjs`/`.mts` so ESM is unambiguous. Pin Node 22 for builds so functions don't silently change runtime. The spec uses `[build.environment] NODE_VERSION = "22"`; the key name is widely documented but was **not** re-read on the docs page here **[UNVERIFIED]**. Check the deploy log's first lines for the Node version after the first build.
- `context.waitUntil` work still counts against the 60 s limit and toward compute credits.
