# netlify.toml, custom headers (`_headers`) and ignore builds
Source: https://docs.netlify.com/build/configure-builds/file-based-configuration/ , https://docs.netlify.com/manage/routing/headers/ , https://docs.netlify.com/build/configure-builds/ignore-builds/
Retrieved: 2026-11-23

## netlify.toml basics
- It normally lives at the **repo root**. All paths in it are relative to the **base directory**, which is `/` by default. [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- "settings specified in `netlify.toml` override any corresponding settings in the Netlify UI." [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- **`[build]` keys:**
  - `base`, `publish`, `command`
  - `environment` (build variables only)
  - `processing`
  - `ignore`
  - [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- **`[functions]` keys:**
  - `directory`, which applies to all functions.
  - JS/TS only: `node_bundler` (`esbuild` or `zisi`), `external_node_modules` and `included_files`.
  - These keys can be set per function with `[functions.name]` or with globs such as `[functions."api_*"]`. When several blocks match a function, their values are **concatenated**.
  - [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- **Environment variables in the file:** using environment variables directly as values in `netlify.toml` isn't supported. A build command can rewrite `[[headers]]` and `[[redirects]]` only, because those are read after the build. [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)

## Deploy contexts
- `[build]` and `[[plugins]]` are context-aware. `[[redirects]]` and `[[headers]]` are **not**. [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- **Precedence, from least to most specific:**
  1. Base `[build]` values.
  2. `[context.production]`, `[context.deploy-preview]`, `[context.branch-deploy]` and `[context.dev]` (Netlify Dev).
  3. `[context.<branchname>]`, the most specific.
- **The contexts:**
  - **production** = the production branch.
  - **deploy-preview** = a pull or merge request.
  - **branch-deploy** = any other branch.
- [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- `[dev]` holds local `command`, `port`, `targetPort`, `functionsPort`, `publish` and `framework`, but has no `environment` key. Use `[context.dev]` for local variables. [file-based config](https://docs.netlify.com/build/configure-builds/file-based-configuration/)

## Ignore builds
- **Exit codes:** "An exit code of `1` indicates the contents have changed and the build process continues as usual. An exit code of `0` indicates that there are no changes and the build should stop." [ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)
- **Example from the docs:** `[build] ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF"`. [ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)
- The command can use the Git metadata variables plus `CI` and `NETLIFY`, and it runs even without a base directory. [ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)
- **Default behaviour:** Netlify cancels the build if nothing changed in the base directory. [ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)
- What `$CACHED_COMMIT_REF` holds on a very first build or after a cache clear was not stated on the page read **[UNVERIFIED]**.

## Custom headers
- There are two ways to set them: a `_headers` file in the **publish directory**, or `[[headers]]` tables in `netlify.toml`. [headers](https://docs.netlify.com/manage/routing/headers/)
- **Limitations** ([headers](https://docs.netlify.com/manage/routing/headers/)):
  - They apply **only to files Netlify serves from its backing store**. URLs handled by a **function**, an edge function or a proxy don't get them; "the function should return any required headers instead".
  - They are **global for all deploy contexts**. The workaround is to copy a context-specific file to `_headers` in that context's build command.
  - Netlify ignores these header names when set as custom headers:
    - `Accept-Ranges`, `Age`, `Allow`, `Alt-Svc`, `Connection`
    - `Content-Encoding`, `Content-Length`, `Content-Range`, `Date`
    - `Location` (use redirects instead)
    - `Server`
    - `Set-Cookie` ("may be overridden by Netlify cookie handling")
    - `Trailer`, `Transfer-Encoding`, `Upgrade`
- **`_headers` syntax** ([headers § syntax](https://docs.netlify.com/manage/routing/headers/#syntax-for-the-headers-file)):
  - A path line, followed by **indented** `Name: value` lines.
  - A line beginning with `#` is a comment.
  - Header names are case-insensitive.
  ```
  /*
    X-Frame-Options: DENY
  /templates/index.html
    X-Frame-Options: SAMEORIGIN
  ```
- **TOML syntax:**
  ```toml
  [[headers]]
    for = "/*"
    [headers.values]
      X-Frame-Options = "DENY"
  ```
- **Wildcards and placeholders:**
  - `*` can appear anywhere in a segment.
  - `:placeholder` must be at the **start** of a segment.
  - The two can't be combined in one segment, so `/templates/:p*` and `/templates/*:p` are both invalid.
  - [headers](https://docs.netlify.com/manage/routing/headers/)
- **Multi-value headers:**
  - In `_headers`, repeat the name. In TOML, use a multi-line string.
  - Both collapse to one comma-joined header, for example `cache-control: max-age=0,no-cache,no-store,must-revalidate`.
  - [headers](https://docs.netlify.com/manage/routing/headers/)
- **Basic-auth headers** are **Pro and Enterprise** only. [headers](https://docs.netlify.com/manage/routing/headers/)
- **Cross-subdomain cookies:** they can't be set across `*.netlify.app` subdomains (Public Suffix List). That needs a custom domain. [headers](https://docs.netlify.com/manage/routing/headers/)
- When two different path rules both match a URL and set the **same** header name, the docs don't say how they are merged **[UNVERIFIED]**. Avoid it.

## Beach Day notes
- **Use one headers source: `public/_headers`.** Example 02 has the file and a validator.
  - **CSP:** `default-src 'self'`, and `connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com`. That is ADR-0001: the browser calls Open-Meteo directly, while Claude and GitHub are reached only from functions.
  - Also: no `unsafe-inline`, and `frame-ancestors 'none'`.
  - `/sw.js` gets `Cache-Control: no-cache`, and `/manifest.webmanifest` gets `Content-Type: application/manifest+json`.
- **`/api/*` responses get none of these.** Every function sets `cache-control: no-store` and its own headers (example 01).
- **Ignore command:**
  - The sketch in docs/03, `-- public netlify`, is **too narrow**. The build command reads `.claude/agents` and `scripts`, and dependency or `netlify.toml` changes also matter.
  - Use: `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- public netlify netlify.toml package.json package-lock.json scripts .claude/agents`.
  - Example 02 proves the exit codes in a temporary git repo.
  - Every skipped docs-only build saves 15 credits (ADR-0004).
- Header changes, `netlify.toml` changes and env changes need a **security-engineer** review (agent rules).
- Don't use basic-auth headers or a site password. Both are Pro-only, and they wouldn't protect functions anyway. The Console gate lives in the functions.
