// netlify/functions/lib/guard.mts: the token-and-role check that runs first in every /api/* function.
// docs/04 §4.1 and §12. Real ES256 signatures (minted here) verified by the pinned @supabase/auth-js against a
// mocked JWKS; PostgREST and /auth/v1/user are mocked. No network, no real project, no secret key.
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { AuthRetryableFetchError, AuthApiError, AuthUnknownError } from "@supabase/auth-js";
import { createGuard, guardFromEnv, denyResponse, precheckJwtHeader, tokenRejected } from "../../netlify/functions/lib/guard.mts";
import { SETTINGS } from "../../netlify/functions/lib/settings.mts";

const URL_ = "https://bdguardtest.supabase.co";
const KEY = "sb_publishable_TESTONLY";
const SUB = "5b0c7a52-0000-4000-8000-000000000001";
const b64u = (b) => Buffer.from(b).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID();
  return { privateKey, kid, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig", key_ops: ["verify"] } };
}
function sign(k, claims, header = { alg: "ES256", typ: "JWT", kid: k.kid }) {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(claims));
  const sig = createSign("SHA256").update(`${h}.${p}`).sign({ key: k.privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b64u(sig)}`;
}
// Claim shape of a real Supabase access token (docs: jwts guide; knowledge doc 01).
const claims = (over = {}, url = URL_) => ({
  iss: `${url}/auth/v1`, aud: "authenticated", role: "authenticated", sub: SUB, email: "lee@example.com",
  exp: now() + 600, iat: now(), aal: "aal1", amr: [{ method: "password", timestamp: now() - 30 }],
  session_id: randomUUID(), is_anonymous: false, ...over,
});
const projectKey = newKey();

function mockFetch({ profiles = { [SUB]: "super_admin" }, restStatus = 200, restBody, jwksStatus = 200, userStatus = 401, userHtml = false, restHang = false } = {}) {
  const calls = [];
  const f = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers);
    calls.push({ m: `${init.method ?? "GET"} ${u.pathname}`, apikey: headers.get("apikey"), auth: headers.get("authorization") });
    if (u.pathname === "/auth/v1/.well-known/jwks.json")
      return jwksStatus === 200 ? Response.json({ keys: [projectKey.jwk] }) : new Response("upstream", { status: jwksStatus });
    if (u.pathname === "/auth/v1/user" && userHtml)
      return new Response("<html>blocked</html>", { status: userStatus, headers: { "content-type": "text/html" } });
    if (u.pathname === "/auth/v1/user")
      return Response.json({ code: userStatus, error_code: "bad_jwt", msg: "invalid JWT" }, { status: userStatus });
    if (u.pathname === "/rest/v1/profiles") {
      if (restHang) return new Promise((_, reject) => {
        const keep = setTimeout(() => reject(new Error("mock: never aborted")), 10_000);
        init.signal?.addEventListener("abort", () => { clearTimeout(keep); reject(init.signal.reason); });
      });
      if (restStatus !== 200) return new Response('{"message":"x"}', { status: restStatus });
      if (restBody !== undefined) return new Response(restBody, { status: 200 });
      const id = u.searchParams.get("id").replace("eq.", "");
      return Response.json(id in profiles ? [{ role: profiles[id] }] : []);
    }
    return new Response("not found", { status: 404 });
  };
  f.calls = calls;
  return f;
}
const req = (authz, init = {}) => new Request("https://beachday.example/api/agents", {
  ...init, headers: { ...(authz ? { authorization: authz } : {}), ...(init.headers ?? {}) },
});
const bearer = (t) => `Bearer ${t}`;
function guard(f, extra = {}) {
  const logs = [];
  const g = createGuard({ url: URL_, publishableKey: KEY, fetchImpl: f, log: (e) => logs.push(e), ...extra });
  g.logs = logs;
  return g;
}
const view = (r) => [r.ok, r.status, r.code, r.reason];
const meta = { route: "/api/agents", requestId: "req-1" };
let coldN = 0;
const coldUrl = () => `https://bdcold${++coldN}x.supabase.co`;

describe("401: identity not proven", () => {
  it("no Authorization header -> 401, no network call", async () => {
    const f = mockFetch();
    expect(view(await guard(f).check(req(null), meta))).toEqual([false, 401, "unauthorized", "no_token"]);
    expect(f.calls).toEqual([]);
  });
  it("Basic auth, two-part token, oversized token -> 401 no_token, no network call", async () => {
    const f = mockFetch();
    const g = guard(f);
    for (const h of ["Basic abc", "Bearer a.b", "Bearer " + "a".repeat(5000) + ".b.c", "Bearer a.b.c d"]) {
      expect((await g.check(req(h), meta)).reason).toBe("no_token");
    }
    expect(f.calls).toEqual([]);
  });
  it("garbage three-part token -> 401", async () => {
    expect(view(await guard(mockFetch()).check(req("Bearer not.a-jwt.at-all"), meta))).toEqual([false, 401, "unauthorized", "malformed_token"]);
  });
  it("malformed three-part tokens (header or payload not a base64url JSON object) -> 401 invalid_token, no network call, whatever the pre-check setting", async () => {
    const enc = (v) => b64u(typeof v === "string" ? v : JSON.stringify(v));
    const okHead = enc({ alg: "ES256", typ: "JWT", kid: "k1" });
    const cases = [
      "aaaa.bbbb.cccc",                                // Tess's matrix case: auth-js THROWS on this header
      `${enc("not json")}.${enc({ sub: "x" })}.sig`,
      `${enc([1, 2])}.${enc({ sub: "x" })}.sig`,       // JSON, but not an object
      `${enc("null")}.${enc({ sub: "x" })}.sig`,
      `${okHead}.${enc("not json")}.sig`,              // header fine, payload not JSON
      `${okHead}.${enc('"a string"')}.sig`,
    ];
    for (const precheck of [false, true]) {
      for (const t of cases) {
        const f = mockFetch();
        const r = await createGuard({ url: URL_, publishableKey: KEY, fetchImpl: f, headerPrecheck: precheck }).check(req(`Bearer ${t}`), meta);
        expect([t, precheck, r.status, r.code]).toEqual([t, precheck, 401, "unauthorized"]);
        expect(f.calls ?? []).toEqual([]);
      }
    }
  });
  it("expired token -> 401", async () => {
    const t = sign(projectKey, claims({ exp: now() - 5 }));
    expect(view(await guard(mockFetch()).check(req(bearer(t)), meta))).toEqual([false, 401, "unauthorized", "invalid_token"]);
  });
  it("bad signature (right kid, tampered payload) -> 401, and the tampered sub never reaches PostgREST", async () => {
    const [h, , s] = sign(projectKey, claims()).split(".");
    const forged = `${h}.${b64u(JSON.stringify(claims({ sub: "other" })))}.${s}`;
    const f = mockFetch({ profiles: { other: "super_admin" } });
    expect(view(await guard(f).check(req(bearer(forged)), meta))).toEqual([false, 401, "unauthorized", "invalid_token"]);
    expect(f.calls.some((c) => c.m.includes("/rest/v1/"))).toBe(false);
  });
  it("token from another project (unknown kid) -> 401 (auth-js asks GET /user, which says 401)", async () => {
    const f = mockFetch();
    expect(view(await guard(f).check(req(bearer(sign(newKey(), claims()))), meta))).toEqual([false, 401, "unauthorized", "invalid_token"]);
    expect(f.calls.map((c) => c.m)).toContain("GET /auth/v1/user");
  });
  it("wrong project: valid signature but iss elsewhere -> 401 wrong_project", async () => {
    const t = sign(projectKey, claims({ iss: "https://zzzzzzzz.supabase.co/auth/v1" }));
    expect((await guard(mockFetch()).check(req(bearer(t)), meta)).reason).toBe("wrong_project");
  });
  it("wrong audience -> 401", async () => {
    expect((await guard(mockFetch()).check(req(bearer(sign(projectKey, claims({ aud: "other" })))), meta)).reason).toBe("wrong_audience");
  });
  it("anonymous user -> 401", async () => {
    expect((await guard(mockFetch()).check(req(bearer(sign(projectKey, claims({ is_anonymous: true })))), meta)).reason).toBe("anonymous");
  });
  it("sub missing or not a string -> 401", async () => {
    const g = guard(mockFetch());
    expect((await g.check(req(bearer(sign(projectKey, claims({ sub: 42 })))), meta)).reason).toBe("no_subject");
    expect((await g.check(req(bearer(sign(projectKey, claims({ sub: "" })))), meta)).reason).toBe("no_subject");
  });
  it("PostgREST answers 401 for the token -> 401", async () => {
    expect(view(await guard(mockFetch({ restStatus: 401 })).check(req(bearer(sign(projectKey, claims()))), meta)))
      .toEqual([false, 401, "unauthorized", "profile_rejected_token"]);
  });
});

describe("header pre-check (SETTINGS.jwtHeaderPrecheck; on only after pre-launch test (f))", () => {
  it("defaults to SETTINGS.jwtHeaderPrecheck, which is false in the first build", async () => {
    expect(SETTINGS.jwtHeaderPrecheck).toBe(false);
    const f = mockFetch();
    const t = sign(projectKey, claims(), { alg: "HS256", typ: "JWT" });
    expect((await guard(f).check(req(bearer(t)), meta)).status).toBe(401);
    expect(f.calls.map((c) => c.m)).toContain("GET /auth/v1/user"); // off: reaches getClaims, which falls back
  });
  const withHeader = (hdr) => { const [, p, s] = sign(projectKey, claims()).split("."); return `${typeof hdr === "string" ? b64u(hdr) : b64u(JSON.stringify(hdr))}.${p}.${s}`; };
  for (const [why, hdr] of [
    ["HS256", { alg: "HS256", typ: "JWT", kid: "k" }],
    ["alg none", { alg: "none", typ: "JWT" }],
    ["lower-case es256", { alg: "es256", kid: "k" }],
    ["ES256 without kid", { alg: "ES256", typ: "JWT" }],
    ["empty kid", { alg: "ES256", kid: "" }],
    ["kid not a string", { alg: "ES256", kid: 7 }],
    ["header is a JSON array", ["ES256"]],
    ["header is not JSON", "not json"],
  ]) {
    it(`on: ${why} -> 401 bad_header with no network call`, async () => {
      const f = mockFetch();
      expect(view(await guard(f, { headerPrecheck: true }).check(req(bearer(withHeader(hdr))), meta))).toEqual([false, 401, "unauthorized", "bad_header"]);
      expect(f.calls).toEqual([]);
    });
  }
  it("on: ES256 with a kid passes to getClaims; super_admin -> ok", async () => {
    expect((await guard(mockFetch(), { headerPrecheck: true }).check(req(bearer(sign(projectKey, claims()))), meta)).ok).toBe(true);
  });
  it("precheckJwtHeader accepts RS256 with a kid", () => {
    expect(precheckJwtHeader(`${b64u(JSON.stringify({ alg: "RS256", kid: "k1" }))}.e30.sig`)).toBe(true);
  });
});

describe("403: identity proven, no access", () => {
  it("role user -> 403", async () => {
    expect(view(await guard(mockFetch({ profiles: { [SUB]: "user" } })).check(req(bearer(sign(projectKey, claims()))), meta)))
      .toEqual([false, 403, "forbidden", "not_super_admin"]);
  });
  it("a super_admin role in the JWT, user_metadata or app_metadata is ignored", async () => {
    const t = sign(projectKey, claims({ role: "super_admin", user_metadata: { role: "super_admin" }, app_metadata: { role: "super_admin" } }));
    expect((await guard(mockFetch({ profiles: { [SUB]: "user" } })).check(req(bearer(t)), meta)).status).toBe(403);
  });
  it("a role in the request (query, header or body) is ignored", async () => {
    const t = sign(projectKey, claims());
    const r = new Request("https://beachday.example/api/agents?role=super_admin", {
      method: "POST", headers: { authorization: bearer(t), "x-role": "super_admin" }, body: '{"role":"super_admin"}',
    });
    expect((await guard(mockFetch({ profiles: { [SUB]: "user" } })).check(r, meta)).status).toBe(403);
  });
  it("no profile row -> 403", async () => {
    expect((await guard(mockFetch({ profiles: {} })).check(req(bearer(sign(projectKey, claims()))), meta)).reason).toBe("no_profile");
  });
  it("two rows (should be impossible) -> 403", async () => {
    const body = JSON.stringify([{ role: "super_admin" }, { role: "super_admin" }]);
    expect((await guard(mockFetch({ restBody: body })).check(req(bearer(sign(projectKey, claims()))), meta)).status).toBe(403);
  });
  it("the role lookup is made as the caller: publishable key on apikey, the user's token on Authorization, own id only", async () => {
    const f = mockFetch();
    const t = sign(projectKey, claims());
    await guard(f).check(req(bearer(t)), meta);
    const rest = f.calls.find((c) => c.m.startsWith("GET /rest/v1/profiles"));
    expect([rest.apikey, rest.auth]).toEqual([KEY, `Bearer ${t}`]);
  });
  it("the role is not cached: a demotion applies to the next request", async () => {
    const profiles = { [SUB]: "super_admin" };
    const g = guard(mockFetch({ profiles }));
    const t = sign(projectKey, claims());
    expect((await g.check(req(bearer(t)), meta)).ok).toBe(true);
    profiles[SUB] = "user";
    expect((await g.check(req(bearer(t)), meta)).status).toBe(403);
  });
});

describe("503: the check could not run (fail closed, never 'no access')", () => {
  const t = () => sign(projectKey, claims());
  it("profile lookup 500 -> 503", async () => {
    expect(view(await guard(mockFetch({ restStatus: 500 })).check(req(bearer(t())), meta))).toEqual([false, 503, "unavailable", "profile_unavailable"]);
  });
  it("profile lookup other 4xx (missing grant, 403/404) -> 503, not 403", async () => {
    for (const s of [403, 404, 406]) expect((await guard(mockFetch({ restStatus: s })).check(req(bearer(t())), meta)).status).toBe(503);
  });
  it("profile lookup non-JSON, or JSON that is not an array -> 503", async () => {
    expect((await guard(mockFetch({ restBody: "<html>" })).check(req(bearer(t())), meta)).status).toBe(503);
    expect((await guard(mockFetch({ restBody: '{"role":"super_admin"}' })).check(req(bearer(t())), meta)).status).toBe(503);
  });
  it("profile lookup hangs -> 503 after the timeout", async () => {
    expect((await guard(mockFetch({ restHang: true }), { timeoutMs: 50 }).check(req(bearer(t())), meta)).status).toBe(503);
  });
  it("JWKS unreachable on a cold instance -> 503 (auth-js RETURNS AuthRetryableFetchError, status 0)", async () => {
    const cold = coldUrl();
    const g = createGuard({ url: cold, publishableKey: KEY, fetchImpl: async () => { throw new TypeError("network down"); }, log: () => {} });
    expect(view(await g.check(req(bearer(sign(projectKey, claims({}, cold)))), meta))).toEqual([false, 503, "unavailable", "auth_unavailable"]);
  });
  it("JWKS 502 on a cold instance -> 503", async () => {
    const cold = coldUrl();
    const g = createGuard({ url: cold, publishableKey: KEY, fetchImpl: mockFetch({ jwksStatus: 502 }), log: () => {} });
    expect((await g.check(req(bearer(sign(projectKey, claims({}, cold)))), meta)).status).toBe(503);
  });
  it("unknown kid while GET /user answers 503 -> 503, not 401", async () => {
    expect((await guard(mockFetch({ userStatus: 503 })).check(req(bearer(sign(newKey(), claims()))), meta)).status).toBe(503);
  });
  it("a RETURNED AuthRetryableFetchError from getClaims -> 503; another returned error -> 401", async () => {
    const make = (error) => createGuard({ url: URL_, publishableKey: KEY, log: () => {},
      authClient: { getClaims: async () => ({ data: null, error }), getUser: async () => ({ data: { user: null }, error }) } });
    expect((await make(new AuthRetryableFetchError("down", 0)).check(req(bearer(t())), meta)).status).toBe(503);
    expect((await make(new AuthRetryableFetchError("bad gateway", 502)).check(req(bearer(t())), meta)).status).toBe(503);
    expect((await make(Object.assign(new Error("x"), { name: "AuthRetryableFetchError" })).check(req(bearer(t())), meta)).status)
      .toBe(503); // a look-alike is not a token rejection: fail closed (R1)
    expect((await make(new AuthApiError("Invalid JWT", 401, "bad_jwt")).check(req(bearer(t())), meta)).status).toBe(401);
    expect((await make(new AuthApiError("Too many", 429, "over_request_rate_limit")).check(req(bearer(t())), meta)).status).toBe(503);
    expect((await make(new AuthUnknownError("<html>", null)).check(req(bearer(t())), meta)).status).toBe(503);
  });
  it("unknown kid while GET /user answers 429 (shared IP rate limit) -> 503, not 'sign in again'", async () => {
    expect(view(await guard(mockFetch({ userStatus: 429 })).check(req(bearer(sign(newKey(), claims()))), meta))).toEqual([false, 503, "unavailable", "auth_unavailable"]);
  });
  it("unknown kid while GET /user answers an HTML 403 (WAF page) -> 503", async () => {
    expect((await guard(mockFetch({ userStatus: 403, userHtml: true })).check(req(bearer(sign(newKey(), claims()))), meta)).status).toBe(503);
  });
  it("unknown kid while GET /user answers 505 -> 503", async () => {
    expect((await guard(mockFetch({ userStatus: 505 })).check(req(bearer(sign(newKey(), claims()))), meta)).status).toBe(503);
  });
  it("unknown kid while GET /user answers JSON 403 (token rejected) -> 401", async () => {
    expect((await guard(mockFetch({ userStatus: 403 })).check(req(bearer(sign(newKey(), claims()))), meta)).status).toBe(401);
  });
  it("tokenRejected: only Supabase rejections of the token count", () => {
    expect(tokenRejected(new AuthApiError("x", 401, "bad_jwt"))).toBe(true);
    expect(tokenRejected(new AuthApiError("x", 403, "session_not_found"))).toBe(true);
    for (const e of [new AuthApiError("x", 429, "over_request_rate_limit"), new AuthApiError("x", 500, "unexpected_failure"),
      new AuthRetryableFetchError("x", 0), new AuthUnknownError("x", null), Object.assign(new Error("x"), { name: "AuthInvalidJwtError" }),
      { status: 401 }, null, "x"]) expect(tokenRejected(e)).toBe(false);
  });
  it("a THROW from getClaims -> 503", async () => {
    const g = createGuard({ url: URL_, publishableKey: KEY, log: () => {},
      authClient: { getClaims: async () => { throw new Error("boom"); }, getUser: async () => { throw new Error("boom"); } } });
    expect(view(await g.check(req(bearer(t())), meta))).toEqual([false, 503, "unavailable", "auth_unavailable"]);
  });
  it("getClaims returns no claims and no error -> 401", async () => {
    const g = createGuard({ url: URL_, publishableKey: KEY, log: () => {},
      authClient: { getClaims: async () => ({ data: null, error: null }), getUser: async () => ({}) } });
    expect((await g.check(req(bearer(t())), meta)).status).toBe(401);
  });
  it("missing or bad config (no URL, http URL, no key, a secret key) -> 503 with no network call", async () => {
    const secret = ["sb", "secret", "x".repeat(24)].join("_");
    for (const cfg of [{}, { url: URL_ }, { publishableKey: KEY }, { url: "http://bdguardtest.supabase.co", publishableKey: KEY },
      { url: URL_, publishableKey: secret }, { url: "not a url", publishableKey: KEY }]) {
      const f = mockFetch();
      const g = createGuard({ ...cfg, fetchImpl: f, log: () => {} });
      expect(view(await g.check(req(bearer(t())), meta))).toEqual([false, 503, "unavailable", "misconfigured"]);
      expect(f.calls).toEqual([]);
    }
  });
  it("guardFromEnv reads only SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, and fails closed when they are absent", async () => {
    const g = guardFromEnv({ env: {}, log: () => {} });
    expect((await g.check(req(bearer(t())), meta)).reason).toBe("misconfigured");
    const ok = guardFromEnv({ env: { SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: KEY }, fetchImpl: mockFetch(), log: () => {} });
    expect((await ok.check(req(bearer(t())), meta)).ok).toBe(true);
  });
});

describe("allow, logging, and what the guard leaves alone", () => {
  it("super_admin with a valid token -> ok, with userId, claims and the token for step-up / forwarding", async () => {
    const tok = sign(projectKey, claims());
    const r = await guard(mockFetch()).check(req(bearer(tok)), meta);
    expect([r.ok, r.userId, r.claims.sub, r.token]).toEqual([true, SUB, SUB, tok]);
  });
  it("never reads the request body", async () => {
    const r = new Request("https://beachday.example/api/chat", { method: "POST", headers: { authorization: bearer(sign(projectKey, claims())) }, body: "{}" });
    await guard(mockFetch()).check(r, meta);
    expect(r.bodyUsed).toBe(false);
  });
  it("logs route, requestId, status and outcome, plus sub once verified; never the token or the header", async () => {
    const tok = sign(projectKey, claims());
    const g = guard(mockFetch({ profiles: { [SUB]: "user" } }));
    await g.check(req(bearer(tok)), meta);
    await g.check(req("Bearer x.y.z"), meta);
    expect(g.logs[0]).toEqual({ msg: "auth", route: "/api/agents", requestId: "req-1", status: 403, outcome: "not_super_admin", sub: SUB });
    expect(g.logs[1].sub).toBeUndefined();
    const text = JSON.stringify(g.logs);
    expect(text).not.toContain(tok.split(".")[2]);
    expect(text).not.toContain("x.y.z");
    expect(text).not.toMatch(/Bearer|apikey|sb_publishable/);
  });
  it("logs the allow too, with sub", async () => {
    const g = guard(mockFetch());
    await g.check(req(bearer(sign(projectKey, claims()))), meta);
    expect(g.logs).toEqual([{ msg: "auth", route: "/api/agents", requestId: "req-1", status: 200, outcome: "allowed", sub: SUB }]);
  });
  it("getUser is exposed for the Approve step-up and goes through the same client", async () => {
    const f = mockFetch({ userStatus: 403 });
    const res = await guard(f).getUser(sign(projectKey, claims()));
    expect(res.data.user).toBeNull();
    expect(res.error).toBeTruthy();
    expect(f.calls.map((c) => c.m)).toContain("GET /auth/v1/user");
  });
});

describe("denyResponse", () => {
  it("401 carries www-authenticate, code unauthorized, and no reason or upstream text", async () => {
    const res = denyResponse({ ok: false, status: 401, code: "unauthorized", reason: "wrong_project" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(JSON.stringify(body)).not.toContain("wrong_project");
  });
  it("403 forbidden and 503 unavailable, with no Access-Control-Allow-* or Set-Cookie", async () => {
    for (const [status, code] of [[403, "forbidden"], [503, "unavailable"]]) {
      const res = denyResponse({ ok: false, status, code, reason: "x" });
      expect(res.status).toBe(status);
      expect((await res.json()).error.code).toBe(code);
      expect([...res.headers.keys()].filter((k) => k.startsWith("access-control-") || k === "set-cookie")).toEqual([]);
    }
  });
});
