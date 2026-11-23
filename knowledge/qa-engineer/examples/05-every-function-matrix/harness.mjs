// Test harness for "401 / 403 / 503 on EVERY function" (docs/06 §3.1). Node built-ins only.
//
// STAND-INS. In the real repo the guard is netlify/functions/lib/auth.mts and the handlers are the real functions.
// Here a ~40-line guard (docs/04 §4.1: Bearer shape -> ES256 signature via JWKS -> exp/iss/aud/anonymous/sub ->
// role read from profiles as the caller) and eight tiny handlers let the harness run. What this example proves is the
// HARNESS: it fails when a route skips or misorders the guard (see matrix.test.mjs, "mutants").
import { generateKeyPairSync, createSign, createVerify, createPublicKey, randomUUID } from "node:crypto";
import { approveStepUp } from "../../../security-engineer/examples/01-bearer-step-up-and-origin/stepup.mjs";

export const SUPABASE = "https://abcdefgh.supabase.co";
export const SITE = "https://beachday.example";
export const NOW = Math.floor(Date.parse("2026-11-23T17:00:00Z") / 1000);
const b64u = (b) => Buffer.from(b).toString("base64url");

export function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID();
  return { privateKey, kid, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" } };
}
export function sign(key, claims, { kid = key.kid } = {}) {
  const h = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const p = b64u(JSON.stringify(claims));
  const sig = createSign("SHA256").update(`${h}.${p}`).sign({ key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b64u(sig)}`;
}
export const claimsFor = (over = {}) => ({
  iss: `${SUPABASE}/auth/v1`, aud: "authenticated", role: "authenticated", sub: "user-1", exp: NOW + 600, iat: NOW,
  is_anonymous: false, aal: "aal1", amr: [{ method: "password", timestamp: NOW - 30 }], ...over,
});

// ---- the fake outside world: Supabase (JWKS + PostgREST + getUser). Counts every call and refuses other hosts. ----
export function makeWorld({ key, profiles = { "user-1": "super_admin" }, jwksDown = false, restFailure = null, users = {} } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(`${u.host}${u.pathname}`);
    if (u.origin !== SUPABASE) throw new Error(`unexpected host ${u.host}`); // Claude / GitHub must never be reached by the guard
    if (u.pathname === "/auth/v1/.well-known/jwks.json") {
      if (jwksDown) throw new TypeError("fetch failed");
      return Response.json({ keys: [key.jwk] });
    }
    if (u.pathname === "/rest/v1/profiles") {
      if (restFailure === "network") throw new TypeError("fetch failed");
      if (restFailure) return new Response("{}", { status: restFailure });
      const id = u.searchParams.get("id").replace("eq.", "");
      return Response.json(id in profiles ? [{ role: profiles[id] }] : []);
    }
    return new Response("not found", { status: 404 });
  };
  const getUser = async (token) => {
    const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
    return { data: { user: users[sub] ?? { id: sub, last_sign_in_at: new Date((NOW - 30) * 1000).toISOString(), factors: [] } }, error: null };
  };
  return { calls, fetchImpl, getUser };
}

// ---- stand-in guard (docs/04 §4.1) ----
export function makeGuard({ fetchImpl, skipSignature = false, trustJwtRole = false }) {
  const deny = (status, reason) => ({ ok: false, status, reason });
  return async function guard(req) {
    const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") ?? "");
    if (!m) return deny(401, "no_token");
    let header, claims;
    try { header = JSON.parse(Buffer.from(m[1], "base64url")); claims = JSON.parse(Buffer.from(m[2], "base64url")); } catch { return deny(401, "garbage"); }
    let jwks;
    try { jwks = await (await fetchImpl(`${SUPABASE}/auth/v1/.well-known/jwks.json`)).json(); } catch { return deny(503, "unavailable"); }
    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk || header.alg !== "ES256") return deny(401, "unknown_key");
    const ok = createVerify("SHA256").update(`${m[1]}.${m[2]}`).verify({ key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url"));
    if (!ok && !skipSignature) return deny(401, "bad_signature");   // skipSignature is a planted bug (mutant)
    if (!(claims.exp > NOW)) return deny(401, "expired");
    if (claims.iss !== `${SUPABASE}/auth/v1`) return deny(401, "wrong_project");
    if (claims.aud !== "authenticated" || claims.is_anonymous === true || typeof claims.sub !== "string") return deny(401, "bad_claims");
    let res;
    try {
      res = await fetchImpl(`${SUPABASE}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(claims.sub)}`, { headers: { authorization: `Bearer ${m[1]}.${m[2]}.${m[3]}`, apikey: "sb_publishable_TESTONLY" } });
    } catch { return deny(503, "unavailable"); }
    if (res.status === 401) return deny(401, "rejected_by_postgrest");
    if (!res.ok) return deny(503, "unavailable");
    const rows = await res.json();
    const role = trustJwtRole && claims.user_role ? claims.user_role : rows[0]?.role;   // trustJwtRole is a planted bug (mutant)
    if ((rows.length !== 1 && !(trustJwtRole && claims.user_role)) || role !== "super_admin") return deny(403, "forbidden");
    return { ok: true, claims, token: `${m[1]}.${m[2]}.${m[3]}` };
  };
}

// ---- responses: every status carries the docs/04 §10 function headers ----
export function respond(status, body = {}, extra = {}) {
  const h = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", ...extra };
  if (status === 401) h["www-authenticate"] = "Bearer";
  return new Response(JSON.stringify(body), { status, headers: h });
}
const CODES = { 401: "unauthorized", 403: "forbidden", 503: "unavailable" };

export function checkOrigin(req) {
  if (req.method === "GET") return true;
  const sfs = req.headers.get("sec-fetch-site"), origin = req.headers.get("origin");
  return !((sfs !== null && sfs !== "same-origin") || (origin !== null && origin !== SITE));
}

// ---- the registry: one row per route in docs/04 §2. `touches` is what a successful call is allowed to reach. ----
export const ROUTES = [
  { key: "GET /api/agents", method: "GET", path: "/api/agents", touches: [] },
  { key: "POST /api/chat", method: "POST", path: "/api/chat", touches: ["claude", "github", "blobs"], prod: true },
  { key: "POST /api/jobs", method: "POST", path: "/api/jobs", touches: ["blobs"], prod: false },
  { key: "POST /api/jobs-run", method: "POST", path: "/api/jobs-run", touches: ["claude", "github", "blobs"], prod: true },
  { key: "GET /api/jobs/:id", method: "GET", path: "/api/jobs/j_01ARZ3NDEKTSV4RRFFQ69G5FAV", touches: ["blobs"] },
  { key: "GET /api/proposals/:id", method: "GET", path: "/api/proposals/p_01ARZ3NDEKTSV4RRFFQ69G5FAV", touches: ["blobs"] },
  { key: "POST /api/proposals/:id/approve", method: "POST", path: "/api/proposals/p_01ARZ3NDEKTSV4RRFFQ69G5FAV/approve", touches: ["blobs", "github"], prod: true },
  { key: "POST /api/proposals/:id/reject", method: "POST", path: "/api/proposals/p_01ARZ3NDEKTSV4RRFFQ69G5FAV/reject", touches: ["blobs"] },
];

// Build handlers over a spy set. `mutate` lets matrix.test.mjs plant bugs and prove the matrix notices them.
export function makeApp({ world, deployContext = "production", mutate = {} }) {
  const spy = { claude: 0, github: 0, blobs: 0 };
  const guard = makeGuard({ fetchImpl: world.fetchImpl, skipSignature: mutate.skipSignature, trustJwtRole: mutate.trustJwtRole });
  const proposal = { status: "pending", contentHash: "a1b2c3d4", baseSha: "abc" };
  const handlers = Object.fromEntries(ROUTES.map((r) => [r.key, async (req) => {
    if (mutate.touchBeforeGuard === r.key) { spy.blobs++; }                                  // BUG: side effect before the check
    if (mutate.noGuard !== r.key) {
      const g = await guard(req);
      if (!g.ok) return respond(g.status, { error: { code: CODES[g.status] } });             // never echo the reason
      req.auth = g;
    }
    if (!checkOrigin(req)) return respond(403, { error: { code: "forbidden" } });
    if (r.prod && deployContext !== "production") return respond(503, { error: { code: "unavailable" } }); // before any secret is read
    if (r.key.endsWith("/approve")) {
      const body = await req.json().catch(() => ({}));
      const su = await approveStepUp(req.auth.token, req.auth.claims, world.getUser, NOW);
      if (!su.ok) return respond(su.status, { error: { code: su.code } });                   // proposal stays pending
      if (body.contentHash !== proposal.contentHash) return respond(409, { error: { code: "conflict" } });
      if (proposal.status !== "pending") return respond(409, { error: { code: "conflict" } });
      proposal.status = "committing"; spy.blobs++; spy.github++;
      proposal.status = "committed";
      return respond(200, { status: "committed" });
    }
    for (const t of r.touches) spy[t]++;
    return respond(200, { ok: true });
  }]));
  return { handlers, spy, proposal };
}
const pathOf = (r) => `${SITE}${r.path}`;
export const request = (r, { token, headers = {}, body } = {}) =>
  new Request(pathOf(r), { method: r.method, headers: { ...(token ? { authorization: token.startsWith("Bearer") || token.includes(" ") ? token : `Bearer ${token}` } : {}), ...headers }, body: r.method === "POST" ? JSON.stringify(body ?? {}) : undefined });

// ---- the matrix itself: returns a list of failures instead of throwing, so mutants can be checked ----
export function buildCases() {
  const good = newKey(), other = newKey();
  const T = (over, k = good) => sign(k, claimsFor(over));
  const [h, p, s] = T().split(".");
  const forged = `${h}.${b64u(JSON.stringify(claimsFor({ sub: "user-2" })))}.${s}`;
  const mk = (name, expect, token, worldOpts = {}) => ({ name, expect, token, worldOpts });
  return {
    good,
    cases: [
      mk("no Authorization header", 401, null),
      mk("Basic scheme", 401, "Basic dXNlcjpwYXNz"),
      mk("garbage token", 401, "not.a-jwt"),
      mk("three garbage parts", 401, "aaa.bbb.ccc"),
      mk("expired token", 401, T({ exp: NOW - 1 })),
      mk("bad signature (payload tampered)", 401, forged, { profiles: { "user-2": "super_admin" } }),
      mk("signed by another project's key", 401, T({}, other)),
      mk("wrong iss (another project)", 401, T({ iss: "https://zzzzzzzz.supabase.co/auth/v1" })),
      mk("wrong aud", 401, T({ aud: "other" })),
      mk("anonymous user", 401, T({ is_anonymous: true })),
      mk("PostgREST rejects the token (401)", 401, T(), { restFailure: 401 }),
      mk("role user", 403, T(), { profiles: { "user-1": "user" } }),
      mk("no profile row", 403, T(), { profiles: {} }),
      mk("JWT claims role=super_admin but profiles says user", 403, T({ role: "super_admin", user_role: "super_admin" }), { profiles: { "user-1": "user" } }),
      mk("profiles returns 500", 503, T(), { restFailure: 500 }),
      mk("profiles returns 502", 503, T(), { restFailure: 502 }),
      mk("profiles network error", 503, T(), { restFailure: "network" }),
      mk("JWKS unreachable (cold instance)", 503, T(), { jwksDown: true }),
    ],
  };
}

const SECRETS_TO_NEVER_ECHO = ["sb_publishable_TESTONLY", "service_role", "sb_secret_", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"];

export async function runMatrix({ mutate = {}, deployContext = "production" } = {}) {
  const failures = [];
  const { good, cases } = buildCases();
  for (const route of ROUTES) {
    for (const c of cases) {
      const world = makeWorld({ key: good, ...c.worldOpts });
      const app = makeApp({ world, mutate, deployContext });
      const res = await app.handlers[route.key](request(route, { token: c.token, body: { contentHash: "a1b2c3d4" } }));
      const text = await res.text();
      const tag = `${route.key} | ${c.name}`;
      if (res.status !== c.expect) failures.push(`${tag}: status ${res.status}, want ${c.expect}`);
      if (Object.values(app.spy).some((n) => n > 0)) failures.push(`${tag}: touched ${JSON.stringify(app.spy)}`);
      if (world.calls.some((x) => !x.startsWith("abcdefgh.supabase.co"))) failures.push(`${tag}: reached ${world.calls}`);
      if (res.headers.get("cache-control") !== "no-store") failures.push(`${tag}: cache-control`);
      if (res.headers.get("x-content-type-options") !== "nosniff") failures.push(`${tag}: nosniff`);
      if (!/^application\/json/.test(res.headers.get("content-type") ?? "")) failures.push(`${tag}: content-type`);
      if (c.expect === 401 && res.headers.get("www-authenticate") !== "Bearer") failures.push(`${tag}: www-authenticate`);
      if ([...res.headers.keys()].some((k) => k.startsWith("access-control-allow-") || k === "set-cookie")) failures.push(`${tag}: CORS or cookie header`);
      if (SECRETS_TO_NEVER_ECHO.some((x) => text.includes(x)) || (c.token && text.includes(c.token))) failures.push(`${tag}: body echoes a secret or the token`);
      if (!/"code":"(unauthorized|forbidden|unavailable)"/.test(text)) failures.push(`${tag}: error body shape`);
    }
  }
  return failures;
}
