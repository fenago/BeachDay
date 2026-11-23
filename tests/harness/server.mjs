// Full-stack local harness: a stand-in for Netlify that runs the REAL function code with FAKE upstreams.
//   node tests/harness/server.mjs            (PORT, default 4173; 127.0.0.1 only)
//
// What it does (docs/06 §3, build_plan W1 item 5):
//  - serves public/ with directory index and /console -> console.html;
//  - applies public/_headers per path, <project-ref>.supabase.co -> the fixture host, so CSP violations appear in the browser;
//  - serves /generated/config.js and /version.json from tests/fixtures/site (version settable), stamps __BUILD_VERSION__ in sw.js in memory;
//  - routes /api/* by docs/04 §2 to netlify/functions/<module>.mts, loaded lazily (501 while a module is missing),
//    calling create<Name>Handler(deps) and handler(request, context) with context.deploy.context = "production";
//  - runs MSW in-process for api.anthropic.com, api.github.com and the fixture Supabase host (server-side calls);
//  - mounts /__fake/supabase/* so Playwright forwards the BROWSER's Supabase calls to the SAME fake state;
//  - /__harness/ctl: a JSON control channel so a Playwright test (another process) can drive the fakes.
// None of the /__* endpoints exists outside this harness. Nothing here reads real secrets or reaches a real host.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakeSupabase } from "../helpers/fake-supabase.mjs";
import { createFakeBlobs, fakeContext } from "../helpers/fake-blobs.mjs";
import { createFakeAnthropic, createFakeGithub, createUpstreams, DEFAULT_SEED } from "../helpers/msw-upstreams.mjs";
import { fakeAnthropicKey, fakeGithubToken, FIXTURE_SUPABASE_URL, FIXTURE_PUBLISHABLE_KEY, FIXTURE_REPO } from "../helpers/secrets.mjs";
import { loadHeadersFile, headersFor } from "./headers.mjs";
import { matchRoute, API_ROUTES } from "./routes.mjs";

export const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FIXTURE_SITE = join(REPO_ROOT, "tests", "fixtures", "site");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".map": "application/json" };
const JSON_HEAD = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export async function startHarness({ port = 0, host = "127.0.0.1", publicDir = join(REPO_ROOT, "public"), functionsDir = join(REPO_ROOT, "netlify", "functions"), version = "fixture0000000000000000000000000000000000", approveEnabled = true, settingsOverrides = {}, seedFiles = DEFAULT_SEED, quiet = true } = {}) {
  const s = { version, deployContext: "production", approveEnabled, settingsOverrides: { ...settingsOverrides }, clockOffsetMs: 0, background: new Set(), depsAdapters: new Map(), moduleCache: new Map(), log: [] };
  const clock = { now: () => Date.now() + s.clockOffsetMs };

  // ---- fakes ----
  const writeToken = fakeGithubToken("write");
  const supabase = await createFakeSupabase({ origin: FIXTURE_SUPABASE_URL, publishableKey: FIXTURE_PUBLISHABLE_KEY, now: clock.now });
  const blobs = createFakeBlobs();
  const github = createFakeGithub({ writeToken, files: seedFiles, now: clock.now });
  const anthropic = createFakeAnthropic();
  const upstreams = createUpstreams({ supabase, github, anthropic }).listen();

  // ---- env for the real function code (fake, runtime-built; never printed) ----
  const env = { ANTHROPIC_API_KEY: fakeAnthropicKey(), GITHUB_TOKEN: writeToken, SUPABASE_URL: FIXTURE_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: FIXTURE_PUBLISHABLE_KEY, GITHUB_OWNER: FIXTURE_REPO.owner, GITHUB_REPO: FIXTURE_REPO.repo };
  Object.assign(process.env, env);

  let origin = "";
  const rules = loadHeadersFile(join(publicDir, "_headers"));

  async function loadSettings() {
    const mod = await import(pathToFileURL(join(REPO_ROOT, "netlify/functions/lib/settings.mts")).href);
    return { ...mod.SETTINGS, approveEnabled: s.approveEnabled, ...s.settingsOverrides };
  }

  // The deps bag every factory receives. Handlers take what they need; extra keys are ignored.
  // W2: Remy/Cass confirm the exact deps names; register an adapter with harness.registerDeps(name, fn) if they differ.
  async function buildDeps(routeInfo, mod) {
    const settings = await loadSettings();
    const bag = {
      fetch: (...a) => globalThis.fetch(...a),
      env: { ...env },
      getStore: blobs.getStore, blobs,
      now: clock.now,
      settings,
      deployContext: s.deployContext,
      supabase: { url: FIXTURE_SUPABASE_URL, publishableKey: FIXTURE_PUBLISHABLE_KEY, fetch: (...a) => globalThis.fetch(...a) },
      github: { owner: FIXTURE_REPO.owner, repo: FIXTURE_REPO.repo },
      siteUrl: origin,
      requestSelf: (path, init) => globalThis.fetch(`${origin}${path}`, init), // /api/jobs -> /api/jobs-run goes through the harness
      // build-contracts §2.2 names. guard/registry/getClient/getReader/getWriter/stepUp stay the handler's real wiring (MSW + process.env).
      stores: Object.fromEntries(["proposals", "jobs", "ratelimit", "audit"].map((n) => [n, blobs.getStore(n)])),
      startJob: (authorization, body, o = origin) => globalThis.fetch(`${o}/api/jobs-run`, { method: "POST", headers: { "content-type": "application/json", authorization, origin: o }, body: JSON.stringify(body) }),
    };
    const real = typeof mod.realDeps === "function" ? mod.realDeps() : {};
    const adapted = s.depsAdapters.get(routeInfo.module)?.(bag) ?? bag;
    return { ...real, ...adapted };
  }

  async function loadHandler(routeInfo) {
    const file = join(functionsDir, `${routeInfo.module}.mts`);
    if (!existsSync(file)) return { missing: `netlify/functions/${routeInfo.module}.mts does not exist yet` };
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod[routeInfo.factory] !== "function") return { missing: `${routeInfo.module}.mts does not export ${routeInfo.factory}` };
    const cacheKey = `${routeInfo.module}|${s.deployContext}|${s.approveEnabled}|${JSON.stringify(s.settingsOverrides)}`;
    if (!s.moduleCache.has(cacheKey)) s.moduleCache.set(cacheKey, mod[routeInfo.factory](await buildDeps(routeInfo, mod)));
    return { handler: s.moduleCache.get(cacheKey) };
  }

  // ---- node <-> fetch plumbing ----
  async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); }
  const toHeaders = (raw) => { const h = new Headers(); for (const [k, v] of Object.entries(raw)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v); return h; };

  async function sendFetchResponse(res, response, ac) {
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    if (!response.body) return res.end();
    const reader = response.body.getReader();
    res.on("close", () => { ac?.abort(); reader.cancel().catch(() => {}); });
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
    } catch { /* client went away */ }
    res.end();
  }

  async function handleApi(req, res, url) {
    const m = matchRoute(url.pathname);
    if (!m) return sendFetchResponse(res, new Response(JSON.stringify({ error: { code: "not_found", message: "No such route (harness)" } }), { status: 404, headers: JSON_HEAD }));
    const loaded = await loadHandler(m.route).catch((e) => ({ missing: `${m.route.module}.mts failed to load: ${String(e?.message ?? e).split("\n")[0]}` }));
    if (loaded.missing) return sendFetchResponse(res, new Response(JSON.stringify({ error: { code: "not_implemented", message: `harness: ${loaded.missing}` } }), { status: 501, headers: JSON_HEAD }));
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
    const ac = new AbortController();
    const request = new Request(`${origin}${req.url}`, { method: req.method, headers: toHeaders(req.headers), body, signal: ac.signal });
    const context = fakeContext({ params: m.params, deployContext: s.deployContext, siteUrl: origin, requestId: randomBytes(8).toString("hex"), ip: "203.0.113.7" });
    if (m.route.background) { // Netlify background functions answer 202 at once and keep running
      const p = Promise.resolve().then(() => loaded.handler(request, context)).then((r) => r?.body?.cancel?.(), (e) => s.log.push(`background ${m.route.module}: ${String(e?.message ?? e)}`)).finally(() => s.background.delete(p));
      s.background.add(p);
      return sendFetchResponse(res, new Response("", { status: 202 }));
    }
    let response;
    try { response = await loaded.handler(request, context); }
    catch (e) { s.log.push(`${m.route.module} threw: ${String(e?.message ?? e)}`); response = new Response(JSON.stringify({ error: { code: "internal", message: "harness: handler threw" } }), { status: 500, headers: JSON_HEAD }); }
    return sendFetchResponse(res, response, ac);
  }

  // ---- static ----
  async function resolveStatic(pathname) {
    const clean = normalize(decodeURIComponent(pathname)).replace(/\\/g, "/");
    if (clean.includes("\0") || clean.split("/").includes("..")) return { status: 400 };
    if (clean === "/version.json") return { json: { version: s.version, commit: s.version, builtAt: "2026-11-23T00:00:00.000Z" } };
    if (clean.startsWith("/generated/")) { const f = join(FIXTURE_SITE, clean); return existsSync(f) ? { file: f } : { status: 404 }; }
    if (clean === "/console") return { file: join(publicDir, "console.html") };
    let f = join(publicDir, clean);
    if (!f.startsWith(publicDir + sep) && f !== publicDir) return { status: 400 };
    try {
      if ((await stat(f)).isDirectory()) {
        if (!pathname.endsWith("/")) return { redirect: `${pathname}/` };
        f = join(f, "index.html");
      }
    } catch { return { status: 404 }; }
    return existsSync(f) ? { file: f } : { status: 404 };
  }

  async function handleStatic(req, res, url) {
    const r = await resolveStatic(url.pathname);
    const subs = { "<project-ref>.supabase.co": new URL(FIXTURE_SUPABASE_URL).host };
    const base = { "cache-control": "public, max-age=0, must-revalidate" };
    const hdr = (pathname, extra) => { const h = { ...base, ...extra }; for (const [k, v] of headersFor(rules, pathname, { substitutions: subs })) h[k] = v; return h; };
    if (r.redirect) { res.writeHead(301, { location: r.redirect }); return res.end(); }
    if (r.status) { res.writeHead(r.status, { "content-type": "text/plain; charset=utf-8", ...hdr(url.pathname, {}) }); return res.end(r.status === 404 ? "Not Found" : "Bad Request"); }
    if (r.json) { res.writeHead(200, hdr(url.pathname, { "content-type": TYPES[".json"] })); return res.end(JSON.stringify(r.json)); }
    let body = await readFile(r.file);
    if (url.pathname === "/sw.js") body = Buffer.from(body.toString("utf8").split("__BUILD_VERSION__").join(s.version)); // stamp-sw.mjs, in memory
    res.writeHead(200, hdr(url.pathname, { "content-type": TYPES[extname(r.file)] ?? "application/octet-stream" }));
    res.end(req.method === "HEAD" ? undefined : body);
  }

  // ---- the browser's Supabase calls arrive here (see routeSupabase in tests/helpers/openmeteo-routes.mjs) ----
  async function handleFakeSupabase(req, res, url) {
    const path = url.pathname.slice("/__fake/supabase".length) || "/";
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
    const headers = toHeaders(req.headers); headers.delete("host");
    const r = await supabase.handle(new Request(`${supabase.origin}${path}${url.search}`, { method: req.method, headers, body }));
    if (r.type === "error") { res.writeHead(599, { "x-fake-network-error": "1" }); return res.end(); }
    return sendFetchResponse(res, r);
  }

  // ---- control channel ----
  const ctlOps = {
    // supabase
    "supabase.addUser": (a) => supabase.addUser(a), "supabase.setRole": ({ email, role, force }) => supabase.setRole(email, role, { force }),
    "supabase.deleteProfile": ({ email }) => supabase.deleteProfile(email), "supabase.confirm": ({ email }) => supabase.confirm(email),
    "supabase.setGoogle": (a) => supabase.setGoogle(a), "supabase.lastEmail": ({ to, type }) => supabase.lastEmail(to, type),
    "supabase.outbox": () => supabase.outbox, "supabase.currentTotp": ({ email }) => supabase.currentTotp(email), "supabase.enrollVerifiedTotp": ({ email }) => supabase.enrollVerifiedTotp(email),
    "supabase.mint": ({ email, over, opts }) => supabase.mint(email, over, opts), "supabase.ageSignIn": ({ email, seconds }) => supabase.ageSignIn(email, seconds),
    "supabase.fail": ({ target, mode, times }) => { supabase.fail(target, mode, { times }); return true; }, "supabase.clearFailures": () => supabase.clearFailures(),
    "supabase.calls": () => supabase.calls, "supabase.callCount": ({ pattern }) => supabase.callCount(pattern), "supabase.resetCalls": () => supabase.resetCalls(),
    "supabase.restWrites": () => supabase.restWrites, "supabase.sessionCount": ({ email }) => supabase.sessionCount(email), "supabase.setSiteUrl": ({ url: u }) => supabase.setSiteUrl(u), "supabase.allowRedirectUrl": ({ url: u }) => supabase.allowRedirectUrl(u), "supabase.mintExpired": ({ email, over, opts }) => supabase.mintExpired(email, over, opts),
    // blobs
    "blobs.peek": ({ store, key }) => blobs.peek(store, key), "blobs.seed": ({ store, key, value }) => blobs.seed(store, key, value),
    "blobs.callCount": () => blobs.callCount, "blobs.resetCalls": () => blobs.resetCalls(), "blobs.reset": () => blobs.reset(),
    "blobs.keys": ({ store }) => [...(blobs.stores.get(store)?.rows.keys() ?? [])],
    // github
    "github.state": () => ({ main: github.state.main, commitCount: github.state.commitCount, violations: github.state.violations, calls: github.calls }),
    "github.fileText": ({ path }) => github.state.fileText(path), "github.log": () => github.state.log().map((c) => ({ sha: c.sha, message: c.message, author: c.author, parents: c.parents })),
    "github.pushConcurrent": ({ path, text }) => github.state.pushConcurrent(path, text),
    "github.failNextPatchWithRace": () => github.state.failNextPatchWithRace(), "github.patchAppliesThen": ({ kind }) => github.state.patchAppliesThen(kind),
    "github.patchFails502": () => github.state.patchFails502(), "github.setReadDown": ({ value }) => github.state.setReadDown(value),
    "github.failNext": ({ re, status }) => github.state.failNext(new RegExp(re), status),
    // anthropic
    "anthropic.script": ({ turns }) => { anthropic.script(...turns); return anthropic.pending; }, "anthropic.requests": () => anthropic.requests, "anthropic.pending": () => anthropic.pending,
    // harness
    "harness.setVersion": ({ version: v }) => { s.version = v; return v; }, "harness.setDeployContext": ({ value }) => { s.deployContext = value; s.moduleCache.clear(); return value; },
    "harness.setApproveEnabled": ({ value }) => { s.approveEnabled = !!value; s.moduleCache.clear(); return s.approveEnabled; },
    "harness.setSettings": ({ overrides }) => { s.settingsOverrides = { ...overrides }; s.moduleCache.clear(); return s.settingsOverrides; },
    // Moves the harness/fake clock only (deps.now, PostgREST, /user, TOTP, amr). auth-js verifies exp against the REAL clock: use supabase.mintExpired.
    "harness.advanceClock": ({ ms }) => { s.clockOffsetMs += ms; return s.clockOffsetMs; },
    "harness.settled": async () => { await Promise.allSettled([...s.background]); return true; },
    "harness.log": () => s.log, "harness.unexpectedHosts": () => upstreams.unexpected,
    "harness.routes": () => API_ROUTES.map((r) => r.key),
    "harness.reset": () => { supabase.reset(); blobs.reset(); upstreams.reset(); s.version = version; s.deployContext = "production"; s.approveEnabled = approveEnabled; s.settingsOverrides = { ...settingsOverrides }; s.clockOffsetMs = 0; s.log.length = 0; s.moduleCache.clear(); return true; },
  };

  async function handleCtl(req, res) {
    const { op, args = {} } = JSON.parse((await readBody(req)).toString() || "{}");
    const fn = ctlOps[op];
    if (!fn) return sendFetchResponse(res, new Response(JSON.stringify({ error: `unknown op ${op}` }), { status: 400, headers: JSON_HEAD }));
    try { return sendFetchResponse(res, new Response(JSON.stringify({ result: (await fn(args)) ?? null }), { status: 200, headers: JSON_HEAD })); }
    catch (e) { return sendFetchResponse(res, new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: JSON_HEAD })); }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://harness.local");
      if (url.pathname === "/__harness/health") return sendFetchResponse(res, new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEAD }));
      if (url.pathname === "/__harness/ctl" && req.method === "POST") return await handleCtl(req, res);
      if (url.pathname.startsWith("/__fake/supabase")) return await handleFakeSupabase(req, res, url);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      return await handleStatic(req, res, url);
    } catch (e) {
      s.log.push(`harness error: ${String(e?.message ?? e)}`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("harness error");
    }
  });
  await new Promise((r) => server.listen(port, host, r));
  origin = `http://${host}:${server.address().port}`;
  supabase.setSiteUrl(`${origin}/console`); supabase.allowRedirectUrl(`${origin}/console`); // exact URLs, like the dashboard allow-list
  if (!quiet) console.log(`beach-day harness on ${origin} (public: ${publicDir})`);

  return {
    url: origin, port: server.address().port, supabase, blobs, github, anthropic, upstreams, state: s, env: Object.freeze({ ...env, ANTHROPIC_API_KEY: "(hidden)", GITHUB_TOKEN: "(hidden)" }),
    registerDeps(moduleName, fn) { s.depsAdapters.set(moduleName, fn); s.moduleCache.clear(); },
    async close() { supabase.clearFailures(); await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); upstreams.close(); },
  };
}

// Run directly: `node tests/harness/server.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const h = await startHarness({ port: Number(process.env.PORT ?? 4173), quiet: false });
  const stop = () => h.close().finally(() => process.exit(0));
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
