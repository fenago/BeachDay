// The function auth matrix: every /api route x every case (docs/06 §3.1, §3.2, docs/04 §12).
// Cells are data: { id, run(ctx) -> string[] problems }. tests/functions/matrix.test.mjs runs them against the REAL handlers,
// tests/functions/matrix-selftest.test.mjs runs the same cells against stand-in handlers and against planted-bug mutants,
// so a matrix that "passes by refusing everything" or "passes against a guard that does nothing" is caught.
// Everything is in process: the real guard/origin/http libs, the fake Supabase (real ES256 tokens), fake Blobs, fake GitHub/Anthropic.
import { startHarness } from "../harness/server.mjs";
import { API_ROUTES } from "../harness/routes.mjs";
import { createGuard } from "../../netlify/functions/lib/guard.mts";
import { FIXTURE_SUPABASE_URL, FIXTURE_PUBLISHABLE_KEY } from "./secrets.mjs";

export const PROPOSAL_ID = "p_01ARZ3NDEKTSV4RRFFQ69G5FAV";
export const JOB_ID = "j_01ARZ3NDEKTSV4RRFFQ69G5FAV";
export const ADMIN = "lee@example.test";
export const PLAIN = "sam@example.test";

/** Routes that read a secret (GitHub or Claude) and so check the deploy context first (build-contracts §2.2 step 4). */
export const SECRET_READERS = new Set(["POST /api/chat", "POST /api/jobs-run", "GET /api/proposals/:id", "POST /api/proposals/:id/approve"]);
export const ID_ROUTES = { "GET /api/jobs/:id": "job", "GET /api/proposals/:id": "proposal", "POST /api/proposals/:id/approve": "proposal", "POST /api/proposals/:id/reject": "proposal" };
export const isPost = (route) => route.method === "POST";

/** Which API routes have a handler file yet. */
export function pendingRoutes(h) { return API_ROUTES.filter((r) => !h.hasHandler(r.key)).map((r) => r.key); }

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function buildRequest(h, route, { token, headers = {}, id, sameOrigin = true, body } = {}) {
  const path = route.pattern.replace(":id", id ?? (ID_ROUTES[route.key] === "job" ? JOB_ID : PROPOSAL_ID));
  const hdr = new Headers({ ...(token === undefined ? {} : { authorization: token }), ...headers });
  if (isPost(route)) {
    hdr.set("content-type", "application/json");
    if (sameOrigin) { if (!hdr.has("origin")) hdr.set("origin", h.url); if (!hdr.has("sec-fetch-site")) hdr.set("sec-fetch-site", "same-origin"); }
  }
  const payload = body ?? (route.key.endsWith("/approve") ? { contentHash: `sha256:${"0".repeat(64)}` } : {});
  return new Request(`${h.url}${path}`, { method: route.method, headers: hdr, body: isPost(route) ? JSON.stringify(payload) : undefined });
}

/** Fresh state: two users (a super_admin and a plain user), no failures, zeroed counters. */
export async function setup(h) {
  await h.reset();
  h.clearDepsAdapters();
  h.supabase.addUser({ email: ADMIN, role: "super_admin" });
  h.supabase.addUser({ email: PLAIN, role: "user" });
  h.supabase.resetCalls(); h.blobs.resetCalls();
}

const downstream = (h) => ({ blobs: h.blobs.callCount, github: h.github.calls.length, anthropic: h.anthropic.requests.length, restWrites: h.supabase.restWrites });

export function checkEnvelope(res, text, { status, tokens = [] }) {
  const p = [];
  if (status !== undefined && res.status !== status) p.push(`status ${res.status}, wanted ${status}`);
  const hd = (n) => res.headers.get(n);
  if (!/no-store/.test(hd("cache-control") ?? "")) p.push("cache-control lacks no-store");
  if (hd("x-content-type-options") !== "nosniff") p.push("x-content-type-options is not nosniff");
  for (const [k] of res.headers) if (k.startsWith("access-control-allow-")) p.push(`has ${k}`);
  if (hd("set-cookie")) p.push("has set-cookie");
  if (res.status === 401 && !/^Bearer/i.test(hd("www-authenticate") ?? "")) p.push("401 without www-authenticate: Bearer");
  const hay = text + [...res.headers].map(([k, v]) => `${k}:${v}`).join("\n");
  for (const t of tokens) if (t && hay.includes(t)) p.push("a token or secret appears in the response");
  if (/\bat .*\.(mts|mjs|js):\d+/.test(text)) p.push("a stack trace appears in the body");
  return p;
}

function secretsOf(h, token) {
  return [token?.split(" ").pop(), FIXTURE_PUBLISHABLE_KEY, process.env.ANTHROPIC_API_KEY, process.env.GITHUB_TOKEN];
}

/** Call one cell for one route. Returns the list of problems (empty = pass). */
async function call(h, route, { token, wantStatus, nothingTouched = true, profileReadsAtMost, request = {}, deployContext }) {
  const req = buildRequest(h, route, { token, ...request });
  const before = downstream(h);
  h.supabase.resetCalls();
  let res;
  try { res = await h.callHandler(route.key, req, { deployContext }); } catch (e) { return [`handler threw: ${String(e?.message ?? e).split("\n")[0]}`]; }
  const text = await res.text();
  const problems = checkEnvelope(res, text, { status: wantStatus, tokens: secretsOf(h, token) });
  const after = downstream(h);
  if (nothingTouched) for (const k of Object.keys(before)) if (after[k] !== before[k]) problems.push(`${k} touched (${before[k]} -> ${after[k]})`);
  if (profileReadsAtMost !== undefined) {
    const n = h.supabase.callCount("/rest/v1/profiles");
    if (n > profileReadsAtMost) problems.push(`${n} profile reads, at most ${profileReadsAtMost} expected`);
  }
  return problems;
}

// ---- tokens ----
const tokenFor = async (h, email, over, opts) => `Bearer ${await h.supabase.mint(email, over, opts)}`;
async function tampered(h) {
  const [a, , c] = (await h.supabase.mint(ADMIN)).split(".");
  const payload = { iss: h.supabase.issuer, aud: "authenticated", sub: "00000000-0000-4000-8000-0000000000aa", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), email: ADMIN, is_anonymous: false };
  return `Bearer ${a}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${c}`;
}

const u401 = (id, make) => ({ id, group: "401", run: async (h, route) => call(h, route, { token: await make(h), wantStatus: 401, profileReadsAtMost: 0 }) });
const NOT_DENIED = (st) => ![401, 403, 503].includes(st);

/** Positive control: a valid super_admin must get past the guard on every route, or the matrix could pass by refusing everything. */
async function positive(h, route) {
  const req = buildRequest(h, route, { token: await tokenFor(h, ADMIN) });
  let res; try { res = await h.callHandler(route.key, req); } catch (e) { return [`handler threw: ${String(e?.message ?? e).split("\n")[0]}`]; }
  const text = await res.text();
  const p = checkEnvelope(res, text, { tokens: secretsOf(h, "") });
  if (!NOT_DENIED(res.status)) p.push(`a valid super_admin got ${res.status}`);
  if (route.key === "GET /api/agents" && res.status !== 200) p.push(`agents answered ${res.status}, wanted 200`);
  if (route.key === "GET /api/agents" && /systemPrompt/.test(text)) p.push("agents response carries a system prompt");
  return p;
}

export const CELLS = [
  { id: "positive control: super_admin passes the guard", group: "control", run: positive },
  // ---- 401: identity not proven (no network call at all for the first four) ----
  { id: "no Authorization header", group: "401", run: (h, r) => call(h, r, { token: undefined, wantStatus: 401, profileReadsAtMost: 0 }) },
  u401("Basic credentials", async () => "Basic dXNlcjpwYXNz"),
  u401("Bearer with garbage", async () => "Bearer not-a-token"),
  u401("three garbage parts", async () => "Bearer aaaa.bbbb.cccc"),
  u401("expired (exp in the past)", async (h) => `Bearer ${await h.supabase.mintExpired(ADMIN)}`),
  u401("bad signature (payload edited to another sub)", tampered),
  u401("signed by another project's key (unknown kid)", (h) => tokenFor(h, ADMIN, {}, { key: h.supabase.otherKey })),
  u401("wrong iss", (h) => tokenFor(h, ADMIN, { iss: "https://other-project.supabase.co/auth/v1" })),
  u401("wrong aud", (h) => tokenFor(h, ADMIN, { aud: "someone-else" })),
  u401("anonymous (is_anonymous: true)", (h) => tokenFor(h, ADMIN, { is_anonymous: true })),
  u401("no sub claim", (h) => tokenFor(h, ADMIN, { sub: undefined })),
  { id: "PostgREST answers 401 to the caller's token", group: "401", run: async (h, r) => { h.supabase.fail("rest", 401); return call(h, r, { token: await tokenFor(h, ADMIN), wantStatus: 401, profileReadsAtMost: 1 }); } },
  // ---- 403: authenticated but not super_admin ----
  { id: "role user", group: "403", run: async (h, r) => call(h, r, { token: await tokenFor(h, PLAIN), wantStatus: 403, profileReadsAtMost: 1 }) },
  { id: "no profiles row", group: "403", run: async (h, r) => { const t = await tokenFor(h, ADMIN); h.supabase.deleteProfile(ADMIN); return call(h, r, { token: t, wantStatus: 403, profileReadsAtMost: 1 }); } },
  { id: "role super_admin claimed inside the JWT and user_metadata, profile says user (the role is never read from the token)", group: "403",
    run: async (h, r) => call(h, r, { token: await tokenFor(h, PLAIN, { role: "super_admin", user_role: "super_admin", app_metadata: { role: "super_admin" }, user_metadata: { role: "super_admin" } }), wantStatus: 403, profileReadsAtMost: 1 }) },
  { id: "demoted between two requests: not 403 then 403 (role not cached)", group: "403",
    run: async (h, r) => {
      const t = await tokenFor(h, ADMIN);
      const first = await h.callHandler(r.key, buildRequest(h, r, { token: t })); await first.text();
      if (!NOT_DENIED(first.status)) return [`before demotion the super_admin got ${first.status}`];
      h.supabase.setRole(ADMIN, "user");
      return call(h, r, { token: t, wantStatus: 403, profileReadsAtMost: 1 });
    } },
  // ---- 503: upstream failure, never 401/403, never allow ----
  ...[500, 502, 404].map((st) => ({ id: `profiles answers ${st}`, group: "503", run: async (h, r) => { h.supabase.fail("rest", st); return call(h, r, { token: await tokenFor(h, ADMIN), wantStatus: 503, profileReadsAtMost: 1 }); } })),
  { id: "profiles answers 200 with a non-JSON body", group: "503", run: async (h, r) => { h.supabase.fail("rest", "nonjson"); return call(h, r, { token: await tokenFor(h, ADMIN), wantStatus: 503, profileReadsAtMost: 1 }); } },
  { id: "network error on the profile read", group: "503", run: async (h, r) => { h.supabase.fail("rest", "network"); return call(h, r, { token: await tokenFor(h, ADMIN), wantStatus: 503, profileReadsAtMost: 1 }); } },
  { id: "JWKS answers 502 on a cold key (new kid)", group: "503", run: async (h, r) => { await h.supabase.revokeKey(); const t = await tokenFor(h, ADMIN); h.supabase.fail("jwks", 502); return call(h, r, { token: t, wantStatus: 503, profileReadsAtMost: 0 }); } },
  { id: "JWKS unreachable (network) on a cold key", group: "503", run: async (h, r) => { await h.supabase.revokeKey(); const t = await tokenFor(h, ADMIN); h.supabase.fail("jwks", "network"); return call(h, r, { token: t, wantStatus: 503, profileReadsAtMost: 0 }); } },
  // ---- Origin on every POST (a valid super_admin): 403 and nothing touched ----
  ...[["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }], ["Sec-Fetch-Site: same-site", { "sec-fetch-site": "same-site" }], ["Origin: https://evil.example", { origin: "https://evil.example" }], ["Origin: null", { origin: "null" }]]
    .map(([id, headers]) => ({ id, group: "origin", postOnly: true, run: async (h, r) => call(h, r, { token: await tokenFor(h, ADMIN), wantStatus: 403, request: { headers, sameOrigin: false }, profileReadsAtMost: 1 }) })),
  { id: "Sec-Fetch-Site: same-origin is allowed", group: "origin", postOnly: true, run: async (h, r) => positive(h, r) },
  { id: "both Origin and Sec-Fetch-Site absent is allowed (server to server)", group: "origin", postOnly: true,
    run: async (h, r) => { const res = await h.callHandler(r.key, buildRequest(h, r, { token: await tokenFor(h, ADMIN), sameOrigin: false })); await res.text(); return res.status === 403 ? ["403 when both headers are absent"] : []; } },
  // ---- production check before any secret is read (secret-reading routes only) ----
  { id: "outside production (deploy-preview): 503 before any secret use", group: "env", secretReadersOnly: true,
    run: async (h, r) => call(h, r, { token: await tokenFor(h, ADMIN), wantStatus: 503, deployContext: "deploy-preview", profileReadsAtMost: 1 }) },
  // ---- id shape before any Blobs call ----
  ...[["id x", "x"], ["lowercase ulid", "p_01arz3ndektsv4rrffq69g5fav"], ["25 characters", "p_01ARZ3NDEKTSV4RRFFQ69G5FA"], ["wrong prefix for the route", "WRONG"], ["traversal %2e%2e", "%2e%2e"]]
    .map(([id, v]) => ({ id: `bad :id (${id}) answers 400 before any Blobs call`, group: "id", idOnly: true,
      run: async (h, r) => { const kind = ID_ROUTES[r.key]; const bad = v === "WRONG" ? (kind === "job" ? PROPOSAL_ID : JOB_ID) : v; return call(h, r, { token: await tokenFor(h, ADMIN), wantStatus: 400, request: { id: bad }, profileReadsAtMost: 1 }); } })),
  { id: "unknown but well-formed id answers 404 (GET routes)", group: "id", idOnly: true, getOnly: true,
    run: async (h, r) => { const res = await h.callHandler(r.key, buildRequest(h, r, { token: await tokenFor(h, ADMIN) })); await res.text(); return res.status === 404 ? [] : [`status ${res.status}, wanted 404`]; } },
];

export const applies = (cell, route) =>
  !(cell.postOnly && !isPost(route)) && !(cell.secretReadersOnly && !SECRET_READERS.has(route.key)) && !(cell.idOnly && !ID_ROUTES[route.key]) && !(cell.getOnly && isPost(route));

/** Hang case: Supabase never answers; the guard aborts at 5 s and answers 503. One concurrent run for all routes (about 5 s, not 40). */
export async function runHangCase(h, routes) {
  await setup(h);
  const token = await tokenFor(h, ADMIN);
  h.supabase.fail("rest", "hang");
  const out = await Promise.all(routes.map(async (route) => {
    const res = await h.callHandler(route.key, buildRequest(h, route, { token })); const text = await res.text();
    return { route: route.key, problems: checkEnvelope(res, text, { status: 503, tokens: secretsOf(h, token) }) };
  }));
  h.supabase.clearFailures();
  return out.filter((o) => o.problems.length).map((o) => `${o.route}: ${o.problems.join("; ")}`);
}

export async function runCell(h, cell, route) { await setup(h); return cell.run(h, route); }

// ---- planted-bug mutants: each is a guard dep that a correct matrix must catch ----
export function mutantGuards() {
  const real = () => createGuard({ url: FIXTURE_SUPABASE_URL, publishableKey: FIXTURE_PUBLISHABLE_KEY, fetchImpl: (...a) => globalThis.fetch(...a) });
  const decode = (req) => { const t = (req.headers.get("authorization") ?? "").replace(/^Bearer /, ""); try { return { token: t, payload: JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()) }; } catch { return null; } };
  const allow = (token, payload) => ({ ok: true, userId: payload?.sub ?? "u", claims: payload ?? {}, token });
  return {
    "skips the guard": () => ({ check: async () => allow("", {}), getUser: async () => ({ data: { user: null }, error: null }) }),
    "skips the signature check": () => { const g = real(); return { ...g, check: async (req, m) => { const d = decode(req); return d?.payload?.sub ? allow(d.token, d.payload) : g.check(req, m); } }; },
    "trusts a role claim": () => { const g = real(); return { ...g, check: async (req, m) => { const r = await g.check(req, m); const d = decode(req); return !r.ok && r.status === 403 && d?.payload?.user_metadata?.role === "super_admin" ? allow(d.token, d.payload) : r; } }; },
    "maps an outage to 401": () => { const g = real(); return { ...g, check: async (req, m) => { const r = await g.check(req, m); return !r.ok && r.status === 503 ? { ...r, status: 401, code: "unauthorized" } : r; } }; },
    "ignores the role (any signed-in user)": () => { const g = real(); return { ...g, check: async (req, m) => { const r = await g.check(req, m); const d = decode(req); return !r.ok && r.status === 403 && d ? allow(d.token, d.payload) : r; } }; },
  };
}

export async function startMatrixHarness(opts = {}) { return startHarness({ port: 0, ...opts }); }
