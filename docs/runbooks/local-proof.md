# Local run proof

Owner: netlify-engineer (Nell). Checked 2026-11-23 at commit `b828c82d7228ff124a7a1f2f4e37319360c3315a`, in a scratch copy made with `git archive HEAD`, then `npm ci` (0 vulnerabilities). netlify-cli 27.20.1 (installed by hand, not a project dependency). Fake values only: `SUPABASE_URL=https://bdlocaltest.supabase.co`, `SUPABASE_PUBLISHABLE_KEY=sb_publishable_bdlocaltest_0000000000000000`, `COMMIT_REF` = the commit. `NODE_OPTIONS` was unset (the CLI needs that). Logs are in the session scratch folder `local-proof/` (not committed).

`netlify build --offline` does not set `NETLIFY=true`, and `stamp-sw.mjs` refuses to run without it, so every run exported `NETLIFY=true CI=true`.

## What was proven

| | Command | Captured result |
|---|---|---|
| L1 negative | `netlify build --offline` with the `<project-ref>` placeholder left in `public/_headers` | Exit 2. build-agents ran (12 agents, 25 skills, biggest prompt 124.3 KB). stamp-sw ran. gen-config failed: "CSP connect-src in public/_headers does not list every required source (values not shown)". No `public/generated/` was written |
| L1 | Same, after replacing the placeholder with `bdlocaltest` in the copy's `public/_headers` (and restoring the copy's `sw.js`, which the failed run had stamped) | Exit 0. `sw.js` has `VERSION = "b828c82d7228"` and no placeholder. `version.json` has the same version and the full commit. `config.js` written with the fake URL, key and BUILD_VERSION. `agents.json` has 12 agents. 8 functions bundled in 3.7 s: agents, approve, chat, job-run, job-status, jobs, proposal, reject |
| L2 | `netlify dev --offline --port 8899` | **Could not run.** The static server and all 8 functions loaded, then the CLI stopped with `Error: fetch failed`, thrown from `prepareServer` (`lib/edge-functions/proxy.js:160`) while "Setting up the Edge Functions environment". The log shows only `fetch failed`. Most likely cause: a blocked download of the Edge Functions runtime. We use no edge functions. Not checked on a machine with network access |
| L2 substitute | `unset NODE_OPTIONS; netlify functions:serve --offline --port 8899 --functions netlify/functions` (after `node scripts/build-agents.mjs` in the same copy), then `curl -i` on each route (saved in `local-proof/l2-curl.log`) | With the fake Supabase env set: all 7 sync routes with **no token** gave 401 (7 of 7). All 7 with a **well-formed fake bearer token** gave 503 (Supabase unreachable, fail closed), never 200. Every one of those 28 responses carried `cache-control`, `x-content-type-options` and the JSON `content-security-policy`, and none had `access-control-*` or `set-cookie`. `POST /api/jobs-run` with no token gave 202. With **no Supabase env** set: all 14 requests (7 routes, with and without a token) gave 503, and the function log printed `outcome: misconfigured` 14 times. The 401 responses also carry `www-authenticate: Bearer` |
| L3 partial | `PORT=4187 node tests/harness/server.mjs`, then `BASE_URL=http://127.0.0.1:4187 node scripts/smoke.mjs` in the built copy (`local-proof/smoke-harness.log`) | Exit 1: 35 PASS, 1 FAIL. All 7 sync `/api` routes: 401, no-store, nosniff, no CORS or cookie. `sw.js` 200, stamped, no-cache; manifest type; CSP; COOP. The one FAIL is "sw.js contains the version in /version.json": the harness serves a fixture `version.json` and stamps `sw.js` in memory. A harness quirk, not a product bug |

Not covered: the headers from `_headers` (functions:serve serves no static files; the build log lists them), a real Netlify deploy, and real Supabase, Anthropic or GitHub calls.

## L3: full stack in a browser

The end-to-end proof is Tess's run of `approve.spec.mjs` through the harness (real function code, fake upstreams). Counts: pending Tess W3.

## Repeat it

```bash
export COMMIT_REF=$(git rev-parse HEAD)
export NETLIFY=true CI=true SUPABASE_URL=https://bdlocaltest.supabase.co \
  SUPABASE_PUBLISHABLE_KEY=sb_publishable_bdlocaltest_0000000000000000
fresh() { rm -rf /tmp/bd-proof && mkdir /tmp/bd-proof && git archive HEAD | tar -x -C /tmp/bd-proof && (cd /tmp/bd-proof && npm ci); }

# negative check: the placeholder guard must stop the build
fresh && (cd /tmp/bd-proof && netlify build --offline; echo "exit=$?") || echo "expected failure, exit=$?"

# positive check (edits the COPY only; -i.bak works on Linux and macOS)
fresh && cd /tmp/bd-proof \
  && sed -i.bak 's/<project-ref>/bdlocaltest/g' public/_headers \
  && netlify build --offline; echo "exit=$?"

# function code under Netlify's own runtime (still in /tmp/bd-proof)
unset NODE_OPTIONS
netlify functions:serve --offline --port 8899 --functions netlify/functions &
curl -i http://localhost:8899/api/agents        # expect 401
```

Never run `netlify deploy --prod`.
