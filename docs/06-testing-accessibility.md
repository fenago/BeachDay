# 06 — Testing and accessibility

> Researched 2026-11-23 (Vitest, Playwright, axe-core, W3C WCAG 2.2 / WAI-ARIA 1.2). Updated the same day for ADR-0006 (Supabase Auth), ADR-0007 (reads from `main`), ADR-0008 (Approve cap), ADR-0003 (QA on the main deploy) and security-engineer's CI rules (docs/04 §4.7, §12). Owner: `qa-engineer`, with Wren/Sable for accessibility design.
>
> **How to read the status marks.** "Example NN" means a runnable example in `knowledge/qa-engineer/examples/` that was run on 2026-11-23 (output in its README). Everything else here is a **test plan for code that does not exist yet**: nothing in `tests/` has been written because the app has not been built. **UNVERIFIED** means not confirmed against a primary source or by running it.

## 1. Test pyramid

| Layer | Tool | What | Runs |
|---|---|---|---|
| Unit | **Vitest** (node env) | Scoring and its boundary list, Open-Meteo parsing, allow-list, secret scan, step-up rule, Origin check, approve-cap arithmetic, SSE formatter, `stamp-sw` and `gen-config` scripts, `_headers` and manifest validators | Every push (GitHub Actions) |
| Function integration | Vitest + **MSW** + fakes | Import each Netlify function and call `handler(new Request(...), ctx)`. MSW fakes `api.anthropic.com` and `api.github.com`; a fake `fetch` plays Supabase (JWKS, PostgREST, `getUser`); a fake Blobs store honours `onlyIfNew` / `onlyIfMatch` | Every push |
| Database | Vitest + **pglite** | `profiles` RLS, grants and the sign-up trigger (supabase-auth-engineer's example 02, promoted to `tests/functions/`) | Every push |
| End-to-end | **Playwright** (iPhone + Pixel profiles; offline spec on Chromium) | Beach picker, verdicts, offline, install hint, Console sign-in → chat → proposal → step-up → approve. Open-Meteo, `/api/*` **and Supabase** are mocked | Every push (local static server) and, read-only, after each production deploy |
| Accessibility | **@axe-core/playwright** + manual | WCAG 2.2 AA rules on every screen in §5 + the manual checklist | Same as e2e |
| Performance | **Lighthouse CI** | Performance ≥ 0.9, accessibility = 1.0 against the **production URL** after a deploy (there are no Deploy Previews, §6) | After each production deploy / weekly |
| Real devices | iPhone (Safari) + Android (Chrome) | Install, standalone launch, offline, glass rendering, VoiceOver/TalkBack, password-manager fill | Before each release |

**Retired with ADR-0006:** every test of the shared Console password, the signed session cookie and the CSRF token header. None of those exist any more. Their replacements are §3.1 to §3.4.

## 2. Unit tests (Vitest)

### 2.1 Scoring (docs/01 §5)

* Keep scoring **pure**: `scoreHour(hour, config)` and `scoreDay(hours, config)`. No fetch, no DOM, no clock except an injected `now`.
* **The boundary list is docs/01 §5.6** (Dewey). Do not copy its numbers into a second place: import the table (`BOUNDARIES`, reference: `knowledge/open-meteo-integrator/examples/04-score-config/score.test.mjs`, 65 tests) and drive `it.each` from it. Every factor is tested on **both sides of every edge and on the edge**. The half-open rule means the edge value belongs to the **upper** band (wind 12.9 → 0, 13 → −10; UV 5.9 moderate, 6.0 high; feels-like 77.9 → −10, 78 → 0, 90.9 → 0, 91 → −10; waves 2.9 → −10, 3 → −20, 5 → −35; water 77.9 → −5, 78 → 0). Rain amount is the one strict `>` (0.02 → 0, 0.021 → −15).
* **Structural tests on the config** (no number appears twice): every band list starts at `-Infinity`, is strictly ascending, and `pick(bands, x)` returns a band for `-Infinity`, `0`, each edge, each edge minus 1e-9 and `+Infinity`. This is what makes gaps and overlaps impossible, and it is a different test from the boundary rows.
* **Behaviour tests** beyond bands: thunder codes 94 → no, 95/96/97 → yes, 98 → no, 99 → yes; the hour after thunder is `thunder_wait`; thunder in the hour before the window blocks the first window hour; a window with a hard-stopped or unscorable hour is ineligible; ties go to the earliest window; the average is rounded to an integer **before** banding (79.5 → 80 → Great, `Math.round`); 1–2 hour windows are capped at Good with `short_window`; no usable hour → no verdict; the **preceding-hour shift** (slot 13:00 reads `precipitation`, `precipitation_probability`, `wind_gusts_10m`, `uv_index` from row 14:00); a null core field makes the hour unscorable (never "fine"); an unknown weather code (62, 64, 94) gets no penalty and is **never "clear"**; rain family counted once and capped at −60; confidence (day index 2 → high, 3 → outlook; marine missing → medium + `marine_missing`).
* **Heat index:** 102.9 → no stop, 103 → stop; air 75 °F / 40 % RH stays on the simple formula; it is computed from `temperature_2m` + RH, not from `apparent_temperature`. The NWS band edges are **UNVERIFIED** in docs/01, so these tests pin our reading, not the NWS's.
* **Reason and advice snapshots:** one `toMatchInlineSnapshot` of `reasons` + `advice` per fixture. The copy deck (`knowledge/ux-designer-apple-hig/examples/02-copy-deck/copy-deck.json`) is tested separately; the unit test checks **codes**, so a copy edit never breaks scoring.
* **Fixtures** are real Open-Meteo responses in `tests/fixtures/openmeteo/`: calm sunny, thunderstorm afternoon, windy front, high UV, rough seas, multi-location array (comma-separated lat/lon returns a JSON **array**, `location_id` on later elements), plus a Marine point whose returned lat/lon must be within about 5 km of the requested marine point (grid snapping near Palm Beach and Jupiter).
* **Time:** `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(new Date("2026-07-04T12:00:00-04:00"))`; `vi.useRealTimers()` in `afterEach`. Add a test per day type: a normal day, **2027-03-14 (23-hour day)** and **2026-11-01 (25-hour day)**. Open-Meteo ignores DST inside the requested range (open-meteo-apis skill), so assert the beach window is built from the returned local timestamps, not from `start + n × 3600 s`.
* Runner timezone must not matter. Run the date-sensitive files once under `TZ=Pacific/Auckland` and `TZ=UTC` (example 04 does: 23/23 pass in each).

### 2.2 Other units

| Unit | Cases that must exist |
|---|---|
| **Allow-list** (`allowlist.mts`, docs/04 §6; reference `knowledge/security-engineer/examples/02-path-allowlist/`) | A table of paths → allow/deny for the **whole canonical list**, including each of: `public/_headers`, `public/_redirects`, `public/sw.js`, `public/sw/x.js`, `public/vendor/x.mjs`, `public/generated/config.js`, `public/version.json`, `netlify/functions/a.mts`, `netlify.toml`, `.github/workflows/x.yml`, `package.json`, `package-lock.json`, `scripts/x.mjs`, `.env`, `a/.env.local`, `.git/config`, `.gitmodules`, `.claude/settings.json`, `.claude/settings.local.json`, `x.pem`, `x.key`. Allowed: `public/js/a.js`, `tests/unit/a.test.js`, `docs/a.md`, `.claude/agents/a.md`, `.claude/skills/s/SKILL.md`. Traversal and shape: `..`, `./`, absolute, backslash, empty segment, trailing dot, a leading `/`, characters outside `[A-Za-z0-9._-/]`. **Case:** `Netlify.toml`, `public/_Headers`, `PUBLIC/SW.JS` are denied; allow is exact-case. Mode `120000` (symlink) and a submodule entry are rejected. 20 files OK / 21 refused; 200 KB OK / 200 KB + 1 refused; a NUL byte or invalid UTF-8 refused; case-insensitive duplicates refused; a non-text extension under `public/` refused. DENY wins when both match. **The check runs again at approve time** (a test mutates the stored proposal and expects the refusal). Pending Dr. Lee's ruling: `public/console.html` and `public/js/console/**` are allowed with a warning today; the test is written both ways and the unused one is skipped with a reason. |
| **Secret scan** (agent-console-security; reference `…/03-secret-scan-and-review/`) | Positives: `sk-ant-…` (20+ chars), `github_pat_…`, `ghp_…` and the other `gh[pousr]_` forms (30+), `sb_secret_…`, a full three-part JWT, a PEM private-key header, assignments to `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_READ_TOKEN`, a 40+ character high-entropy string next to `key`/`token`/`secret`. Negatives that must stay quiet: the bare word `service_role` in prose, a lower-case slash path of 40+ characters, a 39-character string, `sk-ant` with a short tail, two-part `eyJ…` strings. Findings are redacted to 6 characters plus the length. **Fake secrets are assembled at runtime** (`["sb_secret", "_", "x".repeat(24)].join("")`), never typed as literals and never marked "EXAMPLE" (security-engineer's rule), so the repo grep in §3.8 cannot match the tests themselves. |
| **Step-up** (`stepup.mjs`; reference `…/01-bearer-step-up-and-origin/`) | Exactly 600 s old passes; 601 s fails; `token_refresh`, `recovery`, `otp`, `magiclink` never count; a fresh `totp` with a stale sign-in fails (a token thief can enrol a factor); verified factor with `aal1` fails, with `aal2` passes; unverified factor only passes at `aal1`; `last_sign_in_at` stale or missing fails; `amr` missing, malformed or with string timestamps fails; array order not trusted; a timestamp 30 s in the future passes, 2 min fails; banned user fails. |
| **Origin check** | `Sec-Fetch-Site`: `same-origin` ok; `cross-site`, `same-site`, `none`-with-Origin-mismatch → 403. `Origin`: site origin ok; foreign, `null`, scheme or port mismatch → 403. Both absent passes (server to server). GET is never blocked by it. |
| **Approve-cap arithmetic** (`limits.mts`; Example 04) | See §3.5. |
| **`stamp-sw` / `gen-config`** (docs/03 §9; reference `knowledge/netlify-engineer/examples/04-sw-version-stamp/`, 11 tests) | Every `__BUILD_VERSION__` is replaced; two different `COMMIT_REF`s give two different `sw.js` byte strings; `version.json` = `{version, commit, builtAt}` with `commit` null on the timestamp fallback; fallback order `COMMIT_REF` (40 hex) → `git rev-parse HEAD` → timestamp; **exactly one log line**; plant a fake secret in the environment and assert it appears in neither stdout nor stderr; refuses without `NETLIFY=true` or `--force`; exits 1 when the file or the placeholder is missing or the version is not `[A-Za-z0-9._-]{1,64}`. `gen-config` exits 1 unless the key starts `sb_publishable_` (a `sb_secret_` key, a legacy JWT `anon`/`service_role` key, an empty value), never echoes a rejected value, reads only three variables, and its output is git-ignored. |
| **Static invariants** | `public/sw.js` imports only from `public/sw/**` (grep every `importScripts` / `import`); `public/_headers` sets no header name twice for one path and `netlify.toml` has no `[[headers]]` (docs/03 §3.2); the CSP in `public/_headers` equals docs/04 §10 **exactly**, apart from the Supabase host; the host in `_headers` equals the host of `SUPABASE_URL` (the build also fails on a mismatch); the vendored file name's `@supabase/auth-js` version equals the version in `package.json` (ADR-0006 point 4); `netlify.toml`'s build `command` contains no `vitest`/`jest`/`playwright`/`npm test` (docs/03 §9.4); `.gitignore` lists `public/generated/`, `public/version.json`, `netlify/functions/lib/agents.json`; the repo contains no `.github/workflows/*.yml` that fails the §6.2 lint. |
| **Manifest** (reference `knowledge/pwa-mobile-engineer/examples/01-manifest-validator/`) | Required fields; `id: "/"`, `scope: "/"`, `start_url: "/?source=pwa"`; icons `/icons/icon-192.png` and `/icons/icon-512.png` with `purpose: any` **plus** a separate `/icons/icon-maskable-512.png`; apple-touch icon `/icons/apple-touch-icon-180.png`; one `narrow` screenshot `/screenshots/today-narrow-1080x2340.png` declared `1080x2340` with a `label`; `theme_color` equals `background_color` equals `#0b3b5c` and equals the page's `<meta name="theme-color">`; **no `shortcuts` key and no string `console` anywhere in the manifest** (decision 6); `prefer_related_applications` absent or false. Every referenced file exists and has the declared pixel size. |
| **SSE formatter** | One `event:` line plus one `data:` JSON line per message; the stream ends with exactly one `done` or one `error`; a `text` delta containing newlines or `</script>` stays one JSON string; `error.code` is from the docs/04 §2.1 list; `tool.summary` ≤ 200 chars and never raw input. |
| **Reasoning fields** | The browser-bound proposal and chat payloads never contain `tool_use`, `tool_result` or `thinking` blocks (agent-console-security). |

### 2.3 Mocks and fixtures

* Network: **MSW** (`setupServer`, `onUnhandledRequest: "error"`, `resetHandlers()` after each test). Or `vi.stubGlobal("fetch", …)` with `vi.unstubAllGlobals()`. Never real Claude, GitHub, Supabase or Open-Meteo.
* Fake Supabase: a `fetch` fake that serves a JWKS (a key pair minted in the test, ES256), PostgREST `profiles`, and `getUser`, and **counts every call**; any other host throws. Reference: supabase-auth-engineer's example 01 (real supabase-js with a minted key) and Example 05 (a no-dependency stand-in).
* Fake Blobs store with `onlyIfNew` and `onlyIfMatch` (etag) semantics, with an `await tick()` in every call so parallel callers interleave (netlify-engineer example 03). Strong consistency is assumed.
* Snapshots: in CI (`CI=true`) Vitest does not write snapshots, and missing, obsolete or mismatched ones fail.

## 3. Function tests

Functions use the web `Request → Response` signature, so tests import and call them directly (inferred from the signature, [get started](https://docs.netlify.com/build/functions/get-started/)):

```ts
import approve from "../../netlify/functions/approve.mts";
const res = await approve(new Request("https://site.example/api/proposals/p_…/approve", { method: "POST", headers, body }), ctx);
```

Every test also asserts `cache-control: no-store`, the explicit `content-type`, `x-content-type-options: nosniff`, and **no** `Access-Control-Allow-*` and **no** `Set-Cookie` on every status.

### 3.1 Auth on every function (ADR-0006, docs/04 §4.1 and §12)

**Registry rule.** A test lists the function files and the route table in docs/04 §2 and fails if they differ, or if a function has no row in the matrix. A new route cannot ship untested. Example 05 reads the doc's table and asserts 8 routes.

**The matrix** is *every route × every case*; each cell asserts the status, the error body shape, the headers, and that **nothing downstream was touched**: no Blobs read or write, no GitHub call, no Claude call, and no Supabase call beyond JWKS and the one profile read.

| Case | Status | Notes |
|---|---|---|
| No `Authorization` header; `Basic …`; `Bearer` with garbage; three garbage parts | **401** + `www-authenticate: Bearer` | No network call at all for the first one |
| Expired (`exp` one second ago) | 401 | `allowExpired` is never used |
| Bad signature (right `kid`, payload edited) | 401 | The edited payload names a real `super_admin`, so a skipped check would let it through |
| Signed by another project's key (unknown `kid`) | 401 | |
| Wrong project: valid signature but `iss` points elsewhere | 401 | `getClaims` does not compare `iss`; our code must |
| Wrong `aud`; `is_anonymous: true`; no `sub` | 401 | |
| PostgREST itself answers 401 to the caller's token | 401 | |
| Role `user`; no `profiles` row | **403** | |
| `role: "super_admin"` inside the JWT or `user_metadata`, but `profiles.role = 'user'` | 403 | The role is never read from the token |
| Role changed from `super_admin` to `user` between two requests | 200 then 403 | The role is not cached |
| `profiles` answers 500, 502 or any other non-2xx (404); answers 200 with a **non-JSON** body; **hangs past 5 s** (fake timers: the call is aborted, not awaited); network error on the profile read; **JWKS unreachable on a cold instance**; JWKS fetch answers 502 | **503** `unavailable` | Never 401/403, never allow. auth-js caches the JWKS per project URL module-wide, so the "JWKS down" case needs a **cold** URL or a fresh module (supabase-auth-engineer's finding) |

Then, per route, a **positive control**: a valid `super_admin` gets 2xx (so the matrix cannot pass by refusing everything), and the **mutants**: a route that skips the guard, one that touches a store before it, a build that skips the signature check, and one that trusts a role claim must each make the matrix fail. Example 05 does all four: 8 routes × 20 cases = 160 checks pass (the 5 s hang is not in the example yet), and the mutants give 65, 18, 31 and 23 failures.

Route-specific extras:
* **`POST /api/jobs-run`** (background: a real caller always sees `202`, so Netlify hides the handler's status, docs/03 §9.3): the same matrix called directly, asserting the handler's own status **and**, above all, that for every rejected case **no job record is read or written and no work starts**. The forwarded token is re-verified. A wrong, reused or missing nonce does nothing; the nonce is consumed by one CAS; the job record holds only the **SHA-256** of the nonce (the test reads the store and searches for the raw nonce). The caller's token being **expired by the time the background function starts** (the hand-off from a 59 s chat turn) means no work. An idempotent retry (same `jobId`, nonce already consumed) is a no-op.
* **IDs:** `GET /api/jobs/x`, `/api/proposals/p_lowercase`, a 25-character id, a `j_` id on a proposal route, a path with `%2e%2e` → **400 `invalid_request`** before any Blobs call. Unknown but well-formed → 404.
* **`GET /api/agents`:** the response has no system prompts, and a `403` is what the Console renders as "no access".

### 3.2 Origin, headers, CORS

For every `POST` route with a valid `super_admin`: `Sec-Fetch-Site: cross-site`, `same-site`, `Origin: https://evil.example` and `Origin: null` → 403 (nothing touched); `same-origin` and both-absent → allowed. No `Access-Control-Allow-*`, no `Set-Cookie` on **any** response, errors included. `OPTIONS` gets no CORS headers. A request with `?approve=1` or a hash fragment on any route changes no state. Function error bodies never contain the token, the `apikey`, an env value, a stack trace or an upstream body.

### 3.3 Role and RLS

* **App level:** Example 05 covers role `user` and no row on every function. Add: two users, the `super_admin` and a `user`, calling the same proposal; the audit record carries the Supabase user id (`sub`), never the email or the token.
* **Database level, run in CI with pglite** (supabase-auth-engineer's example 02, copied to `tests/functions/profiles.test.mjs`; stubs for `auth.users`, `auth.uid()` and the `anon`/`authenticated` roles): the trigger creates a row with role `user` and ignores `raw_user_meta_data`; a user reads **only their own row**; `anon` reads nothing; **a user cannot update their own `role`** (privilege denied, not a policy); a user cannot insert or delete a profile; the `role` check constraint rejects unknown values; the trigger function is not executable by API roles; Dr. Lee's by-hand promotion works and checks `email_confirmed_at is not null`; deleting the auth user cascades. **Not covered by pglite:** Supabase's real default grants, the Security Advisor and the managed `auth.users` trigger. Those are the pre-launch checks on a throwaway project (§3.4 and docs/04 §4.5).
* **Promotion SQL:** Dr. Lee's by-hand promotion for a user whose `email_confirmed_at` is null must change **0 rows**; for a confirmed user, 1 row.
* **Static:** no source file, env table, `config.js` template or fixture mentions a `service_role` or `sb_secret_` value; the only Supabase values used are the URL and the `sb_publishable_` key.

### 3.4 Approve (docs/04 §4.2, §7, §9)

| Group | Cases |
|---|---|
| **Step-up** (Example 05, wired through the handler) | Primary sign-in 601 s old → 401 `step_up_required`; only `token_refresh` fresh → 401; fresh `totp` with a stale sign-in → 401; verified factor with `aal1` → 401; fresh `amr` but stale `last_sign_in_at` → 401; exactly 600 s → passes; `aal2` with a verified factor → passes. **Every refusal leaves the proposal `pending` and GitHub untouched.** `getUser` network failure → 503; a **retryable** `getUser` error that supabase-js *returns* instead of throwing (`AuthRetryableFetchError`) → **503**, not 401 (test both the thrown and the returned form); `getUser` error or empty user → 401 `unauthorized`; `getUser` returns a different id than `sub`, or a banned user → 401. |
| **Integrity** | `contentHash` mismatch → 409 `conflict`, nothing written; double approve → one 200 and one 409 (GitHub touched once); two **concurrent** approves → one winner; approve on `committed`, `failed`, `stale`, `rejected` → 409. A proposal edited in the store after creation (hash recomputed differs) → 409. |
| **Re-validation at approve time** | Allow-list, size, text-only and secret scan run again on the **stored** contents. Mutate the stored record to contain a denied path, a 201 KB file, a NUL byte and a secret in turn; each is refused and nothing reaches GitHub. |
| **Commit sequence** (MSW as GitHub, assert the **order and bodies**) | `GET ref` → `GET commit` → `POST tree` **with `base_tree`** → `POST commit` (message ends with the `Beach-Day-Proposal: p_…` trailer; parent is `headSha`) → `PATCH ref` with `force: false`. Requests are serial. Mode is always `100644`. Base moved and a file's blob SHA differs → `stale`, 409, nothing recorded. Base moved but every file unchanged → proceeds on the new head. **422 on the ref update** → one retry, then `stale`. |
| **Unknown outcome on the ref update** | Timeout or 5xx on `PATCH ref`, then: `GET ref` equals `commitSha` → `committed` and **counted**; re-read succeeded and differs → `failed`, **not** counted; every re-read fails → stays `committing`, the lock is released, answer 502 `upstream`. |
| **Reconciler** | A record `committing` for > 120 s: `main` has a commit whose message has the exact trailer line → recorded in `site:approvals` and `committed`; a near-miss trailer (`Beach-Day-Proposal: p_other`, or the text in the middle of a line) does not match; re-read ok and not found → `failed`, nothing counted; GitHub down → still `committing`. The lock is taken, and a held lock makes the reconciler skip. |
| **`committed ⇒ counted`** | Crash points: after the ref update and before `recordApproval` (reconciler repairs it); `recordApproval` succeeds and the status CAS fails (reconciler counts it **again**: an overcount of one, asserted as the accepted direction); never an undercount. Step 7 failing after retries still answers 200 `committed` with `commitSha`. |
| **Lock** | `onlyIfNew` lock; a lock younger than 90 s blocks; older than 90 s is taken over with `onlyIfMatch`; released on every exit path, including a thrown error (try/finally test). |
| **Payload** | `GET /api/proposals/:id` returns `approvals`, `deploys` and `approveEnabled`; `approvals` is `null` (and Approve is not blocked) when the Blobs read fails; `deploys` equals `deploysOnCommit(paths)`; a **drift test** feeds `DEPLOY_PATHS` and the `ignore` command in `netlify.toml` the same 12 paths and requires the same answer; a no-deploy approval **still counts** toward the cap. `approveEnabled: false` → approve answers 503 `unavailable` until the §4.2 a–e pre-launch tests have passed (the switch is data, tested both ways). |
| **Client branching** (e2e, §4.4) | `401 step_up_required` reopens "Confirm it's you"; any **other** 401 refreshes the session once and retries once, then shows "session ended"; the Approve request is **never resent automatically**. `502 upstream` from approve shows "Couldn't confirm the commit yet" and sends **no second approve** (count requests) |
| **Audit** | Every proposal, approve, step-up failure, reject and commit result writes a record with actor = user id and without bodies, tokens or env. |

### 3.5 Limits (docs/04 §9, ADR-0008)

**Approve cap — Example 04** (23 tests against netlify-engineer's `ratelimit.mjs`; point the import at `netlify/functions/lib/limits.mts` once it exists). All numbers site-wide, only `committed` counts, nothing is refunded:

| Boundary | Test |
|---|---|
| **5th / 6th in a day** | 4 used → allowed; 5 used → refused, `reason: "day"`, `429 approve_cap`, `retryAt` = next New York midnight, proposal stays `pending` |
| **14th / 15th in 31 days** | 13 used (on distinct days, so the day cap cannot be what refuses) → allowed; 14 used → refused, `reason: "month"`, `retryAt` = oldest of the last 14 + 31 days; both caps hit → the later `retryAt` and `reason: "month"` |
| **New York midnight, to the millisecond** | 23:59:59.999 EST still the same day, 00:00:00.000 a new day; 8 pm EST is already "tomorrow" in UTC but is still today; the answer is the same when the **test runner** runs in `TZ=Pacific/Auckland` or `UTC` |
| **DST 1: spring forward, Sunday 2027-03-14** | The day is **23 hours** (05:00Z → 04:00Z), so midnight is 04:00Z, not 05:00Z; approvals either side of the missing 02:00 hour are the same day |
| **DST 2: fall back, Sunday 2026-11-01** | The day is **25 hours** (04:00Z → 05:00Z), midnight is 05:00Z; the repeated 01:30 (05:30Z EDT and 06:30Z EST) is one day, so 3 + 2 = 5 refuses the 6th |
| **The rolling window** | A record exactly 31 × 24 h old has expired; one millisecond younger still counts. It is **744 h, not 31 calendar days**: across the March change the two differ by an hour, and the test sits in that hour |
| **Concurrency** | 50 parallel `recordApproval` calls keep every timestamp (CAS retries); contention beyond the retry limit fails closed |
| **Mutants** | The table is run against four plausible bugs: UTC day instead of New York day, an inclusive window edge, calendar-day instead of 744 h window, and a cap of 6. Each is caught by at least one case |

Display: `approvals` in the proposal payload and in a `429 approve_cap` body is `{used31, usedToday, per31Days: 14, perDay: 5, retryAt}`; Wren's copy ("14 of 14 approvals used in the last 31 days. Next slot frees Dec 4.", "5 of 5 approvals used today. More open up at midnight Eastern.") is checked in e2e (§4.4), not here.

**Per-user and per-turn limits:** 200 chat turns and 20 jobs per **New York** day per user id (key `<action>/<user id>/<YYYY-MM-DD>`), counted at **start** and **never refunded** (a failing retry loop still uses the budget). Boundary pairs: 200th turn allowed, 201st → `429 rate_limited`; 20th job allowed, 21st refused. Day rolls at New York midnight on both DST days. Counters are per user id, so a second `super_admin` has their own. A **15th** tool round runs, a 16th stops with `done.stopReason: "tool_rounds_exhausted"`; tokens are the **sum** of `input`, `cache_creation_input`, `cache_read_input` and `output` over all rounds, stop at 1,000,000 (999,999 continues); `max_tokens` is capped on every call; a 32 KB user message passes and 32 KB + 1 → 400 `invalid_request`; a job stops at 14 min. **Per-turn deadline:** a chat turn stops itself at 55 s (fake timers) with a hand-off or a `timeout` error, before Netlify's 60 s (the Anthropic client timeout is 50 s). **Model allow-list:** an agent file whose `model:` is not on the allow-list makes `build-agents.mjs` exit non-zero and name the file.

**Site-wide compute budget `site:compute`** (180 function-minutes of chat + jobs-run per rolling 31 days; **the number awaits Dr. Lee**, so the test reads it from the constant): before a chat turn at least 60 s must be left; before a job at least 5 min; the job's wall-clock limit is `min(14 min, remaining)`; elapsed time is recorded when the turn or job ends **and** at each job progress write (a job killed at 15 min still left its progress records); over budget → `429 budget_exhausted` with `retryAt`, **before** any Claude call; the window is rolling and CAS-written. A chat `handoff` that cannot start its job answers `budget_exhausted` too.

**Netlify's own rules** (`/api/chat` 20 per 60 s, `/api/jobs` 10 per 60 s, `aggregateBy: ["ip","domain"]`): a unit test reads each function's exported `config` and asserts the numbers, and that there are exactly two rules (Free plan limit). Netlify enforces them, not our code; the deploy log must be read after the first deploy because a bad rule does not fail the deploy (docs/03 §5). The client treats any 429 without our JSON body as `rate_limited`.

### 3.6 Environments and secrets

* Functions that call GitHub or Claude return **503 `unavailable` unless `context.deploy.context === "production"`**, *before* reading the secret: the env getter is a spy and is never called in the `deploy-preview`, `branch-deploy` and `dev` cases, and nothing downstream is touched (Example 05 asserts the second half with its call spies; the env-getter spy is the same pattern and is not in an example yet). The no-token case stays 401 because the guard is the first line.
* `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` appear in no response body, header, log line or SSE event, including on every error path (assert on the captured logger as well as on the `Response`). Use fake values built at runtime. **Token-name scan (static):** only the `github-write` module reads `GITHUB_TOKEN` and only `github-read` reads `GITHUB_READ_TOKEN`; no other file names either. ADR-0009 (read token) is **Proposed**: until Dr. Lee accepts it the scan is written for ADR-0007 (`github-read` uses `GITHUB_TOKEN` through read-only methods) and the ADR-0009 variant is skipped with a stated reason.
* The Anthropic client is built with `baseURL: "https://api.anthropic.com"` and the function's own key, so an AI-Gateway variable injected by Netlify cannot reroute calls (docs/03 §5, item 4). MSW's handler is registered only for that host, and `onUnhandledRequest: "error"` fails anything else. Set a fake `ANTHROPIC_BASE_URL` in the test environment and assert it is ignored.
* Stored and returned records validate against `knowledge/software-architect/examples/02-interface-contracts/` (JSON Schema) in the test.

### 3.7 Agent read tools (ADR-0007)

`read_file` and `list_files` read **GitHub `main`** pinned to the head SHA resolved once at the start of the turn or job: a test moves the ref mid-turn and expects every read to keep using the first SHA. `list_files` fetches the tree once and says so when the API reports it truncated. `propose_change` stores that SHA as `baseSha` and each read file's blob SHA as `readBlobSha` (`null` for a new or unread file). Refused before any GitHub call: `.env`, `a/.env.local`, `x.pem`, `x.key`, `.git/config`, a binary, a non-UTF-8 file, a file over 200 KB. Denied **write** paths such as `netlify/functions/a.mts` **may be read**. A GitHub 404/500 becomes a `tool_result` with `is_error: true` and a short message that contains no token, header or stack. The read module exports no write method (static test).

### 3.8 No secrets in the output

A test greps the whole `public/` tree and the **build output** for `sk-ant-`, `github_pat_`, `ghp_`, `gho_`, `sb_secret_`, a three-part JWT, and the literal env names `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`; the only Supabase strings allowed are the project URL and an `sb_publishable_` key, and only in `public/generated/config.js`. It runs in Actions on the checkout (where `config.js` is a fixture) and in `@prod` against the live `/generated/config.js`. **Open (pre-launch, on the real deploy):** Netlify's secret scan must not fail the build on `sb_publishable_…` in `config.js` (UNVERIFIED, docs/03 §9.5); the first real deploy is the test.

### 3.9 Pre-launch tests on the real Supabase project (docs/04 §4.2 a–e)

Approve stays **disabled** (`approveEnabled: false`) until these pass. They need the real project, a throwaway user and a human, so they are **manual** and recorded in the handoff with date and result. Nothing in CI can mark them done. All five are **UNVERIFIED today** (supabase.com was unreachable from the research sandbox).

| | Check | If it fails |
|---|---|---|
| a | The `password`/`oauth` `amr` timestamp **keeps the sign-in time across a token refresh** | security-engineer re-specifies §4.2 rule 2 before launch |
| b | A new sign-in in the same browser gives a new, current timestamp | same |
| c | `last_sign_in_at` changes on password and Google sign-in and **not** on refresh | same |
| d | `getUser` after `signOut({ scope: "local" })`: if it still succeeds, a signed-out token works until `exp` (600 s). Accepted, but write the result down | record it in docs/04 §4.2 |
| e | A TOTP verify yields `aal2` | same |
| f | Netlify secret scanning does not flag `sb_publishable_…` in `config.js` | `SECRETS_SCAN_OMIT_KEYS` (docs/03 §9.5) |
| g | The RLS Security Advisor shows no warning on `profiles`; a second throwaway user cannot read or change another row or their own `role` through the REST API with the publishable key | fix the SQL before launch |

## 4. End-to-end (Playwright)

Sources: [emulation](https://playwright.dev/docs/emulation), [network](https://playwright.dev/docs/network), [service workers](https://playwright.dev/docs/service-workers), [clock](https://playwright.dev/docs/clock) (playwright.dev was unreachable on 2026-11-23, so the doc notes in `knowledge/qa-engineer/` come from earlier reads and from running the examples; `page.clock` was confirmed by Example 07).

### 4.1 Projects

```ts
// playwright.config.ts
projects: [
  { name: "iphone", use: { ...devices["iPhone 15"], serviceWorkers: "block" } },     // WebKit
  { name: "pixel",  use: { ...devices["Pixel 7"],  serviceWorkers: "block" } },      // Chromium
  { name: "offline-sw", use: { ...devices["Pixel 7"], serviceWorkers: "allow" }, testMatch: /offline\.spec/ },
],
workers: 1,   // for the offline-sw project at least: its specs share one server and one "deploy version"
use: { baseURL: process.env.BASE_URL ?? "http://127.0.0.1:4173", timezoneId: "America/New_York", locale: "en-US", trace: "off" },
webServer: process.env.BASE_URL ? undefined : { command: "node tests/server.mjs", url: "http://127.0.0.1:4173/" },
```

* `BASE_URL` unset → a small local static server serves `public/` plus fixture `/generated/config.js` and `/version.json`. `BASE_URL` set → the production origin, and only specs tagged `@prod` run (§6.3). Nothing in CI holds a login, so a `@prod` spec **never signs in for real**: Supabase and `/api/*` are mocked in the browser.
* `iPhone 15` = WebKit, 393×659 viewport at DPR 3; `Pixel 7` = Chromium, 412×839 at DPR 2.625. `devices[...]` is spread first and overrides come after. WebKit is not real Safari. In the research sandbox only Chromium is installed (`/opt/pw-browsers/chromium-1243`), so **the `iphone` project has never run here**; it runs in GitHub Actions (`npx playwright install --with-deps chromium webkit`).
* Run with `--trace off`; turn traces on only to debug (`trace: "on-first-retry"` with `retries: 2`, CI only).
* Emulate preferences in their own passes: `reducedMotion: "reduce"`, `colorScheme: "dark"`, `forcedColors: "active"`, `contrast: "more"`, and reduced transparency where the browser supports it. Glass must fall back to solid; verdict text must stay readable. Geolocation: `permissions: ["geolocation"]` + `geolocation: {latitude: 26.12, longitude: -80.10}`.
* Screenshots for review use `deviceScaleFactor: 2` on both profiles and include the project name in the file name. If WebKit is missing, say so; never label a Chromium shot "iPhone".

### 4.2 Mock everything, and guard the hosts

| Target | How |
|---|---|
| Open-Meteo and Marine | `page.route("https://api.open-meteo.com/**", r => r.fulfill({ json }))` and the same for `marine-api…`. The glob must match the whole URL (`?` is a literal question mark). Also `429` and `400 {"error":true,"reason":"…"}` → a friendly message, never a blank page |
| `/api/*` | `page.route("**/api/**", …)`: canned SSE (`route.fulfill({ body, contentType: "text/event-stream" })`), `401`, `403`, `503`, `429` (with and without our JSON body), `approve_cap`, `budget_exhausted`, `step_up_required` |
| **Supabase** | `page.route(`${SUPABASE_URL}/auth/v1/**`, …)`: token, user, signup, recover, the `authorize` redirect. **Read `SUPABASE_URL` from the page's `/generated/config.js`** instead of hard-coding it, because the CSP allows only the real project host and a different host would be blocked by the **browser** before `route` ever sees it |
| Guard | Record every host in `beforeEach`; `afterEach` fails on anything but the site, the mocked Open-Meteo hosts and the project's Supabase host. A test can never reach real Claude, GitHub or Supabase |

### 4.3 Service worker, offline and install (Pip's cases) — Example 07

Runs in the Chromium-only `offline-sw` project (service workers only work there in Playwright). Example 07 runs these against a test-double SW that follows docs/02 §5: **9 tests pass, and 90 of 90 over ten repeats with one worker**. The real spec runs against the real `public/sw.js`.

| Case | Assertion |
|---|---|
| **Install** | After register + reload the page is controlled; Cache Storage holds exactly `beachday-shell-<VERSION>` and `beachday-data-v1`; the shell cache holds `/`, the JS/CSS and `offline.html` |
| **Never in Cache Storage** | After visiting them online, **none** of `/sw.js`, `/version.json`, `/api/*`, `/console`, `/console.html`, `/js/console/*`, `/vendor/*`, `/generated/*` or any `*.supabase.co` request appears in any cache. Checked by listing `caches.keys()` and each cache's `keys()`. Planting a SW that precaches the Console is caught (3 forbidden entries found) |
| **Shell offline for the installed start URL** | `context.setOffline(true)`, then `goto("/?source=pwa")`: `response.fromServiceWorker()` is true, the heading and the cached forecast render, and the banner says "Offline — showing data from …". A SW that forgets `{ ignoreSearch: true }` serves `offline.html` instead, and the test would fail |
| **Console and vendor fail offline** | `goto("/console")` and `goto("/console.html")` reject with `ERR_INTERNET_DISCONNECTED`; in-page `fetch` of `/vendor/…`, `/sw.js`, `/version.json`, `/api/…` and `/generated/config.js` all reject. The beach shell is **never** shown for a Console URL |
| **Update flow** | After a "deploy" (new `VERSION`) `/sw.js` has different bytes and no `__BUILD_VERSION__`; `registration.update()` leaves the new worker **waiting** (both shell caches exist, the old one still serves); `postMessage({type: "SKIP_WAITING"})` gives one `controllerchange`; the old shell cache is deleted on activate |
| **Install hint, 14-day snooze** | iPhone user agent, not standalone: hint shows; "Not now"; with a frozen clock (`page.clock.install({time})` **then** `setFixedTime(T0)`, or the click lands a few ms after T0) it stays hidden 1 hour later and at 13 d 23 h 59 min 59.999 s, and shows at exactly 14 d. Standalone never shows it. **Open question for Pip/Wren:** across a DST change 14 × 24 h is not 14 calendar days; the example pins elapsed time. The product must say which |
| **Manifest** | The link is on every page; the manifest is served `application/manifest+json`; `/sw.js` has `Cache-Control: no-cache`; `shortcuts` is absent and `console` appears nowhere (also unit, §2.2) |

**Observed (Playwright 1.63.0, Chromium, 2026-11-23) — a trap for offline specs.** `context.setOffline(true)` does **not** stop a `context.route(...)` that *fulfils* from answering the service worker's own request: the route handler still ran (once) and the page showed fresh data and **no** offline banner, so a spec built that way passes for the wrong reason. Swap the route for one that `abort("internetdisconnected")`s, or remove it, and the SW falls back to its cache (banner shown). Example 07 asserts both halves. This settles the "how does `setOffline` treat a SW's fetches" item that was UNVERIFIED in `knowledge/qa-engineer/docs/02`.

### 4.4 Console flows (Supabase and `/api/*` mocked)

Screens and copy: `knowledge/ux-designer-apple-hig/examples/04-console-auth/flow-spec.md` (Wren). Each row asserts roles, visible text, focus and that nothing is stored where it should not be.

| Flow | Assertions |
|---|---|
| Signed out → sign in | One `h1`; email field `autocomplete="username"`, `type="email"`; password `autocomplete="current-password"`; paste works (`fill` and a clipboard paste); Show Password is a button with `aria-pressed`; no `autocomplete="off"`, no CAPTCHA, no puzzle |
| Wrong password | `role="alert"` under the form; **neither field** `aria-invalid`; focus returns to the password field with the text selected. A malformed email sets `aria-invalid` on the email field only, linked by `aria-describedby` |
| Sign up → "Check your email" | `h1` focused; resend is a button; its cooldown announces at start and end only (spy on the live region: ≤ 2 writes); "Use Another Email" keeps the typed address (3.3.7) |
| Forgot / reset | The same words whether or not the address exists (the mock returns both, text is identical); no "confirm password" field |
| **Continue with Google** | A real `<button>`, keyboard operable; clicking navigates (top-level, **no popup**: `context.on("page")` fires zero times) to `<SUPABASE_URL>/auth/v1/authorize?provider=google…` with the PKCE challenge; never a `<form action>`. A cancelled round trip lands on sign-in with the Google error and focus on the Google button |
| Return from OAuth | `code` is removed from the URL (`history.replaceState`) before any further navigation or `Referer`; the session is in `localStorage` only; no token in `sessionStorage`, cookies, the DOM or the console log |
| `403` from `/api/agents` | "This account can't use the Console" screen, `h1` focused, no agent list rendered |
| `401` mid-session | "Your session ended" status on sign-in, `h1` focused; after sign-in the person returns to the route they were on |
| **`503`** | "Couldn't check your access", **never** the no-access screen (a 503 must not look like a 403) |
| Chat | Canned SSE: `role="log"`, the streaming message has `aria-busy="true"` until `done`; focus stays in the composer; errors use `role="alert"`; a pre-stream `429` with and without our JSON body; the client refreshes the token when under 120 s are left **before** `/api/chat` and `/api/jobs`; an unsent draft stays on `budget_exhausted` and Send is `aria-disabled` |
| Proposal card | Heading, file list, diff as text with `+`/`−` markers (not colour alone), warnings on `public/**/*.js`, `*.html`, `.claude/**` and `tests/**`; **model output never becomes HTML**: a message containing `<img src=x onerror=…>` and `[x](javascript:…)` renders as text, with no remote image request |
| **Step-up sheet** | Approve with a stale sign-in → mocked `401 step_up_required` → the sheet opens (`<dialog>`, Esc closes, focus returns to Review and Approve), proposal still `pending`. Password path: wrong password inline `role="alert"`, correct → retry. Google path: leaves for Google, returns to the **same proposal**, shows "Confirmed. Nothing is approved yet…", focus on Approve and Deploy, and **no `approve` request is sent until the person activates it**. Loading the page with `?approve=1`, a `#approve` hash or `?code=…` sends no approve request |
| Approve outcomes | `200` with `deploys: true` → "Committed {sha}" then polling `/version.json` (mocked) until its `commit` equals the SHA → "Live"; `deploys: false` → "Committed {sha}. No deploy needed." and **no polling**; 10 minutes without a match (fake clock) → "Still deploying — check Netlify"; `409 conflict`, `409 stale`, `502 upstream` each show their message and leave Reject usable |
| **Cap** | `429 approve_cap` → `role="alert"`, "14 of 14 approvals used in the last 31 days. Next slot frees Dec 4." or "5 of 5 approvals used today. More open up at midnight Eastern."; Approve stays visible, 44 px, `aria-disabled`, focusable; dates in New York time on a runner in another timezone; the proposal stays pending. `approveEnabled: false` → the "Approve is off" screen |
| Log out | `signOut({ scope: "local" })`; `localStorage` session gone; "Signed out of the Console." with `h1` focused; the beach app is unaffected |
| Public app | The beach app loads **no** auth code and makes **no** request to the Supabase host (request log) |

### 4.5 Headers and deploy checks (`@prod`, and static in CI)

* **CSP:** static unit test on `public/_headers`, and an `@prod` e2e that reads the live `Content-Security-Policy` response header and compares it **string-for-string** with docs/04 §10 (project host filled in). It contains `form-action 'self'`, no `'unsafe-inline'`, no `'unsafe-eval'`, no wildcard host. `Cross-Origin-Opener-Policy: same-origin` if adopted. A page-level test performs a forbidden action (inject `<script>`/`eval` through a test hook) and expects a CSP violation event.
* `/console` and `/console.html`: `noindex` and `no-store`. `/version.json`: `no-store`. `/sw.js`: `Cache-Control: no-cache` and no `__BUILD_VERSION__` left, and the version it contains equals `/version.json`'s. `/manifest.webmanifest`: `application/manifest+json`.
* **Fail closed on the live site:** every `/api` route answers 401 with `cache-control: no-store` when sent no token, **except `/api/jobs-run`** (a background function that returns `202` immediately; docs/03 §9.3). The smoke test (`scripts/smoke.mjs`, netlify-engineer) does this. A **403** for a non-admin needs a test account and is **not** part of CI (no credentials there); it is a manual pre-launch step (§3.9) and part of the unit matrix (§3.1).

## 5. Accessibility — WCAG 2.2 AA

WCAG 2.2 is a W3C Recommendation (12 Dec 2024; 4.1.1 Parsing removed). [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

| Criterion | Level | What it means for Beach Day |
|---|---|---|
| **1.4.1 Use of Color** | A | Verdicts must not rely on red/yellow/green alone: always text ("Great beach day", "Good", "Fair — pick your hours", "Skip it") + icon. Diff lines carry `+` / `−`. [Understanding 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) |
| 1.4.3 Contrast (Minimum) | AA | 4.5:1 text (3:1 large). **Text over glass is measured against the worst-case background** behind the blur; add a tint or scrim |
| 1.4.11 Non-text Contrast | AA | 3:1 for controls, focus rings, rating dots, chart lines, glass edges that convey a boundary |
| 1.4.10 Reflow | AA | 320 CSS px without horizontal scroll (also in the Console and its dialogs) |
| 1.4.12 Text Spacing / 1.4.4 Resize | AA | Layout survives larger text (rem units) |
| 2.4.7 Focus Visible / **2.4.11 Focus Not Obscured** | AA | Visible focus; the sticky header and the chat composer must not cover a focused item |
| **2.5.8 Target Size (Minimum)** | AA | ≥ 24×24 CSS px; we use **44×44** for beach chips, day tabs, Approve/Reject, the Google button and Show Password. axe checks 24 px only, so 44 px is a custom `boundingBox()` assertion |
| 2.2.2 Pause, Stop, Hide | A | No auto-moving content; forecast refreshes and the `/version.json` poll never move focus |
| **3.3.8 Accessible Authentication** | AA | Console sign-in, sign-up, reset and the Approve step-up: password fields allow paste and password managers (`autocomplete` `username`, `current-password`, `new-password`); no CAPTCHA, puzzle, security question or "type the 3rd character"; a second method exists ("Continue with Google" is a visible-text `<button>`, redirect-based, no popup); Show Password is a button with `aria-pressed` |
| **3.3.7 Redundant Entry** | A | No "confirm password" field; resend and "Use Another Email" keep the typed address |
| 3.3.1 / 3.3.3 Error Identification and Suggestion | A / AA | Field errors sit by the field, linked by `aria-describedby`; `aria-invalid="true"` only on a field that is itself wrong (a failed sign-in marks neither) |
| 4.1.3 Status Messages | AA | "Updated", "Offline", "Check your email", "Sent again to …", "Confirmed", "Committed", "No deploy needed", "Live" use `role="status"`; blocking failures (wrong password, approve cap, budget) use `role="alert"`. The region exists **before** its text is written |
| 2.4.2 / 1.3.1 Structure | A | One `h1` per screen, focus moves to the new `h1` after each route change, landmarks, real buttons and links, labelled inputs, `<html lang="en">` |
| 2.3.3 Animation from Interactions | AAA | Not required, but honour `prefers-reduced-motion` and `prefers-reduced-transparency` |

**Chat streaming** ([WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)): message list `role="log"`; `aria-busy="true"` on a streaming message and `false` when done, so it is announced once; `role="status"` for progress, `role="alert"` only for errors; the diff is real text with headings per file.

**Automated checks:**

```ts
import AxeBuilder from "@axe-core/playwright";
const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
  .analyze();
expect(results.violations).toEqual([]);
```

Leave `wcag22aa` out and axe stops checking target size; there is no `wcag22a` tag. Use a page from the test's `context`, not `browser.newPage()` (Example 02 in `knowledge/qa-engineer/`). Scan **after** the content has rendered, in light, dark, `contrast: "more"` and reduced-transparency modes, on both device profiles. `incomplete` results (contrast over glass) are reviewed by hand and recorded; a rule is never disabled globally to get a pass: use a fingerprint snapshot and file the issue with Sable or Wren.

**Screens scanned:** home in each verdict state (Great, Good, Fair, Skip it, short window, window over, no verdict, outlook day, marine missing), beach picker, day detail, offline state, install hint sheet; Console **signed out / sign in, sign up, check your email, forgot, new password, no access, session ended, "couldn't check your access", agent list, chat with a streaming reply, a proposal card, the step-up sheet (password and Google paths), the cap alert, the budget alert, the "Approve is off" screen, and the outcome states**.

**Manual checklist (each release; automation catches only part):** VoiceOver on iPhone and TalkBack on Android through the main flow and one full Console sign-in + approve; keyboard only on desktop (Tab order, Esc on the sheet, focus return); 200 % zoom and 320 px; a **password manager** fills and saves the sign-in and offers a new password on reset; paste into every auth field; reduced motion and reduced transparency on; colour-blindness simulation on verdict colours; Dynamic Type at the largest size.

## 6. CI, the gate and rollback

### 6.1 Decisions this section rests on

* **Tests run in GitHub Actions, never in the Netlify build** (security-engineer, docs/04 §4.7; docs/03 §9.4). On Free the build sees every secret and `tests/**` is agent-writable, so a test that ran in the build would run with `GITHUB_TOKEN` and `ANTHROPIC_API_KEY`.
* **No Deploy Previews and no branch deploys** (security-engineer requires them off, docs/04 §4.6; ADR-0003 commits straight to `main`). The old "wait for the preview URL" step is gone.
* **QA is green on the main deploy, with a rollback ready** (ADR-0003, Dr. Lee's decision). QA's result is a **signal after the commit**; the gate before it is the human reviewing the diff on Approve. A red result after a deploy means: roll back first, then fix.
* **Rollback is ready** when (1) the previous production deploy is known and still within Netlify's retention, (2) "Publish deploy" on it is one click (instant, 0 credits, docs/03 §8.3), and (3) the person on call knows "Lock to stop auto publishing" exists so the next Approve does not overwrite the rollback. Actions cannot roll back (it holds no Netlify credential, on purpose): a human does it. The written runbook `docs/runbooks/rollback.md` does not exist yet (netlify-engineer).

### 6.2 The workflow (a human adds it)

Agents cannot create `.github/workflows/*`: the path is deny-listed in the Console and the PAT has no Workflows permission (ADR-0005). The reviewed **template** is `knowledge/qa-engineer/examples/06-github-actions-no-secrets/tests.yml`. A human copies it to `.github/workflows/tests.yml`, replaces every `<PIN-SHA>` with the full 40-character commit SHA of the release named in the comment (the sandbox could not resolve them, and no SHA is invented here), and sets one repository **variable** (not a secret) named `SITE_URL`.

Rules, enforced by `workflow-lint.mjs` (Example 06: 16 tests; it flags 13 planted violations and the unpinned template):

| Rule | Why |
|---|---|
| Top-level `permissions: { contents: read }`, nothing else; jobs may only narrow it | Least privilege (docs/04 §4.7). The token can read the repo and nothing more |
| **No secrets**: no `secrets.*`, no `secrets: inherit`, no Beach Day secret name anywhere | Nothing in CI can hold `GITHUB_TOKEN`, `ANTHROPIC_API_KEY` or Supabase keys, so an agent-written test has nothing to steal. Repository **variables** (`vars.SITE_URL`) are plain text and allowed |
| No `pull_request_target`, `workflow_run`, `issue_comment` or `repository_dispatch` | These run with a write token or secrets in the context of untrusted input |
| Every `uses:` pinned to a full commit SHA | A moved tag cannot change what runs |
| `actions/checkout` with `persist-credentials: false` | Keeps the token out of `.git/config`, where a test could read it (QA hardening; the behaviour is from memory, **UNVERIFIED** this session) |
| No `${{ … }}` inside a `run:` script; pass values through `env:` and quote `"$VAR"` | Script-injection guard (QA hardening) |
| `timeout-minutes` on every job | A hung job must not burn minutes |
| Triggers: `push` to `main`, `pull_request`, `workflow_dispatch` | |

The same lint becomes `tests/unit/workflow.test.js` once the real file exists, so a later edit that adds a secret or a write permission fails CI. Because `.github/**` is human-only, a change to it is reviewed by security-engineer. The GitHub documentation pages for `permissions` and `secure-use` were **unreachable** on 2026-11-23: the rules above come from security-engineer's decision and general practice, and the exact `permissions` semantics are **UNVERIFIED** until a human reads docs.github.com. `actionlint` was not run (not installed); the YAML was parsed and linted only.

Jobs in the template: **unit** (`npm ci`, `npm test`), **e2e** (needs unit: Playwright on both profiles and the axe specs against the local static server), **post-deploy** (§6.3).

### 6.3 After a production deploy

On a push to `main` the `post-deploy` job: (1) checks whether the push changed anything Netlify builds, using **the same path list as the `ignore` command** (docs/03 §3.1); a docs-only push is skipped and reported as "no deploy expected", not as a failure; (2) polls `${SITE_URL}/version.json` every 10 s, up to 10 minutes, until it names this commit (the same signal as the Console's "Live"); (3) runs `scripts/smoke.mjs` (docs/03 §9.3; **no credentials**): `/sw.js` 200 with no placeholder left and `no-cache`, its version equals `version.json`, the manifest type, the CSP header, and every `/api` route except `/api/jobs-run` answers 401 `no-store`; (4) runs the read-only `@prod` e2e and axe specs on both profiles (Supabase and `/api/*` mocked); (5) runs **Lighthouse CI** against the production URL (`lhci autorun`, performance ≥ 0.9, accessibility = 1.0; Lighthouse has no PWA category since v12, so installability is checked in DevTools → Application, §6.5). A failure at any step is a red check, and the verdict is **FAIL: roll back, then fix**.

The workflow was **not run on GitHub** (no workflow exists in the repo, and the sandbox has no GitHub access): only its YAML and lint were run (Example 06). No Netlify site is linked yet (Dr. Lee, 2026-11-23), so the post-deploy job has nothing to poll until one is.

### 6.4 Cost

Tests cost **0 Netlify credits** because they do not run in Netlify. Each Approve is one production deploy (15 credits, ADR-0004), capped by ADR-0008 at 14 per rolling 31 days (210 credits). Whether GitHub Actions minutes are free for this public repository is **UNVERIFIED** (not read); the `timeout-minutes` and `concurrency` settings bound the spend either way. A failed deploy costs 0 credits.

### 6.5 Local and manual runs

* An agent-written test is **untrusted code** (docs/04 §4.7): a human runs it in a shell without real secrets in the environment, never with `netlify dev` linked to the production site.
* **Installability** is checked by hand in DevTools → Application (Manifest, Service Workers, Cache Storage) and, on devices, by the matrix in the `ios-android-install-behavior` skill. `curl -I` on `/sw.js` and `/manifest.webmanifest` against the deploy.
* Device checks needing real hardware (iPhone Safari standalone launch, WebAPK, VoiceOver, TalkBack) are **not automatable** and are reported "not run" until a person does them.

## 7. Definition of done (QA gate)

Mark **PASS** only when every required item was **run** and passed. Otherwise **FAIL** (with the failing test, reproduction steps and the owning agent in `needs:`) or **INCOMPLETE** (list what was not run and why). The handoff lists the exact commands and their counts.

- [ ] Unit and function tests green (`npm test`); every changed threshold has boundary tests on both sides; the Console change keeps §3.1, §3.2 and §3.4 green.
- [ ] The auth matrix covers **every** function in docs/04 §2 (the registry test passes), and the four mutants still fail it.
- [ ] Approve-cap boundaries (§3.5) pass in two runner timezones, DST days included.
- [ ] Playwright green on `iphone` and `pixel` (if WebKit was unavailable, the `iphone` project is **not run**, and the gate is INCOMPLETE for iOS); the offline spec green when `sw.js`, the manifest or any cached data code changed.
- [ ] axe: zero violations on every changed screen in light, dark and `contrast: "more"`; manual VoiceOver/TalkBack pass for changed screens (or "not run").
- [ ] No secrets in `public/` or the build output (§3.8); every function refuses without a valid `super_admin` token (§3.1); functions answer 503 outside production.
- [ ] CSP header equals docs/04 §10; the workflow lint passes; the Netlify build command contains no test runner.
- [ ] `/sw.js` carries the stamped version; the manifest has no shortcut; the install hint snoozes for 14 days.
- [ ] Post-deploy smoke, `@prod` specs and Lighthouse budgets met on the **main deploy**, and the previous deploy is known and publishable (rollback ready). Not run → INCOMPLETE.
- [ ] Pre-launch Supabase tests (§3.9) recorded before Approve is enabled.

## 8. Open items

| Item | Owner |
|---|---|
| Dr. Lee's number for the `site:compute` budget (tests read the constant) | Dr. Lee |
| `public/console.html` and `public/js/console/**` deny ruling (the allow-list test is written both ways) | Dr. Lee |
| 14-day snooze: 14 × 24 h elapsed, or 14 calendar days across a DST change | pwa-mobile-engineer + ux-designer-apple-hig |
| GitHub Actions docs (`permissions`, `secure-use`, minutes on a public repo), `actionlint`, real action SHAs | A human with access |
| WebKit (`iphone` project) has never run in the research sandbox | CI |
| Supabase pre-launch tests §3.9 a–g | Dr. Lee + security-engineer |
