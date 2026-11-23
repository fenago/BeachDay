// node --test stepup.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { checkOrigin, checkStepUp, approveStepUp, precheckJwtHeader } from "./stepup.mjs";

const NOW = 1_800_000_000;                       // fixed clock (seconds)
const iso = (s) => new Date(s * 1000).toISOString();
const SUB = "11111111-2222-3333-4444-555555555555";

const claims = (amr, extra = {}) => ({ sub: SUB, aal: "aal1", amr, ...extra });
const user = (extra = {}) => ({ id: SUB, last_sign_in_at: iso(NOW - 120), factors: [], ...extra });

test("step-up table", () => {
  const rows = [
    ["fresh password sign-in (2 min)", claims([{ method: "password", timestamp: NOW - 120 }]), user(), true],
    ["fresh Google sign-in (9 min 59 s)", claims([{ method: "oauth", timestamp: NOW - 599 }]), user({ last_sign_in_at: iso(NOW - 599) }), true],
    ["exactly 10 min", claims([{ method: "password", timestamp: NOW - 600 }]), user({ last_sign_in_at: iso(NOW - 600) }), true],
    ["10 min 1 s: too old", claims([{ method: "password", timestamp: NOW - 601 }]), user(), false],
    ["only token_refresh is fresh", claims([{ method: "token_refresh", timestamp: NOW - 5 }, { method: "password", timestamp: NOW - 7200 }]), user(), false],
    ["recovery link is not a step-up", claims([{ method: "recovery", timestamp: NOW - 5 }]), user(), false],
    ["otp / magic link is not a step-up", claims([{ method: "otp", timestamp: NOW - 5 }]), user(), false],
    ["array order is not trusted (fresh entry last)", claims([{ method: "password", timestamp: NOW - 7200 }, { method: "password", timestamp: NOW - 60 }]), user(), true],
    ["timestamp 2 min in the future", claims([{ method: "password", timestamp: NOW + 120 }]), user(), false],
    ["timestamp 30 s in the future (skew ok)", claims([{ method: "password", timestamp: NOW + 30 }]), user(), true],
    ["amr missing", claims(undefined), user(), false],
    ["amr malformed", claims("password"), user(), false],
    ["timestamp as string", claims([{ method: "password", timestamp: String(NOW) }]), user(), false],
    ["fresh amr but last_sign_in_at stale", claims([{ method: "password", timestamp: NOW - 60 }]), user({ last_sign_in_at: iso(NOW - 3600) }), false],
    ["last_sign_in_at missing", claims([{ method: "password", timestamp: NOW - 60 }]), user({ last_sign_in_at: null }), false],
    ["verified TOTP factor, token aal1", claims([{ method: "password", timestamp: NOW - 60 }]), user({ factors: [{ status: "verified" }] }), false],
    ["verified TOTP factor, token aal2", claims([{ method: "totp", timestamp: NOW - 30 }, { method: "password", timestamp: NOW - 60 }], { aal: "aal2" }), user({ factors: [{ status: "verified" }] }), true],
    ["unverified factor only, aal1 ok", claims([{ method: "password", timestamp: NOW - 60 }]), user({ factors: [{ status: "unverified" }] }), true],
    ["token thief enrols own TOTP: fresh totp + aal2 but old sign-in", claims([{ method: "totp", timestamp: NOW - 10 }, { method: "password", timestamp: NOW - 86400 }], { aal: "aal2" }), user({ factors: [{ status: "verified" }], last_sign_in_at: iso(NOW - 86400) }), false],
    ["getUser returned another user", claims([{ method: "password", timestamp: NOW - 60 }]), user({ id: "someone-else" }), false],
    ["banned user", claims([{ method: "password", timestamp: NOW - 60 }]), user({ banned_until: iso(NOW + 3600) }), false],
  ];
  for (const [why, c, u, want] of rows) {
    const got = checkStepUp({ claims: c, user: u, now: NOW });
    console.log(`${got.ok === want ? "PASS" : "FAIL"}  ${String(got.ok).padEnd(5)} ${why}${got.ok ? "" : ` -> ${got.reason}`}`);
    assert.equal(got.ok, want, why);
    if (!got.ok) { assert.equal(got.status, 401); assert.equal(got.code, "step_up_required"); }
  }
});

test("approveStepUp: getUser failures fail closed", async () => {
  const c = claims([{ method: "password", timestamp: NOW - 60 }]);
  // Shaped like auth-js errors: a class with __isAuthError and a name. Built here, no npm needed.
  class AuthError extends Error { constructor(name, status, code) { super("upstream detail that must not be echoed"); this.__isAuthError = true; this.name = name; this.status = status; this.code = code; } }
  const rows = [
    // [why, getUser, wantStatus, wantCode]
    ["thrown network error", async () => { throw new TypeError("fetch failed"); }, 503, "unavailable"],
    ["RETURNED network error (status 0), the auth-js shape", async () => ({ data: { user: null }, error: new AuthError("AuthRetryableFetchError", 0) }), 503, "unavailable"],
    ["RETURNED 502 from /user", async () => ({ data: { user: null }, error: new AuthError("AuthRetryableFetchError", 502) }), 503, "unavailable"],
    ["returned 403 session_not_found (signed out)", async () => ({ data: { user: null }, error: new AuthError("AuthApiError", 403, "session_not_found") }), 401, "unauthorized"],
    ["returned 403 user_banned", async () => ({ data: { user: null }, error: new AuthError("AuthApiError", 403, "user_banned") }), 401, "unauthorized"],
    ["plain-object error (not an auth error)", async () => ({ data: { user: null }, error: { status: 401 } }), 401, "unauthorized"],
    ["name only, no __isAuthError marker", async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError" } }), 401, "unauthorized"],
    ["no error and no user", async () => ({ data: { user: null }, error: null }), 401, "unauthorized"],
    ["undefined result", async () => undefined, 401, "unauthorized"],
  ];
  for (const [why, getUser, status, code] of rows) {
    const got = await approveStepUp("t", c, getUser, NOW);
    console.log(`${got.status === status && got.code === code ? "PASS" : "FAIL"}  ${got.status} ${got.code.padEnd(11)} ${why}`);
    assert.deepEqual([got.status, got.code], [status, code], why);
    assert.ok(!JSON.stringify(got).includes("upstream detail"), "error never echoed");
  }
  // Real code passes auth-js's own predicate; the injected one wins.
  const injected = await approveStepUp("t", c, async () => ({ data: { user: null }, error: { x: 1 } }), NOW, () => true);
  assert.deepEqual([injected.status, injected.code], [503, "unavailable"]);
  const ok = await approveStepUp("t", c, async () => ({ data: { user: user() }, error: null }), NOW);
  assert.equal(ok.ok, true);
});

test("precheckJwtHeader: cheap forgeries rejected before getClaims", () => {
  const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const tok = (h) => `${b64(h)}.${b64({ sub: SUB })}.c2ln`;
  const rows = [
    ["ES256 with kid", tok({ alg: "ES256", kid: "k1", typ: "JWT" }), true],
    ["RS256 with kid", tok({ alg: "RS256", kid: "k1" }), true],
    ["HS256 (legacy secret or forged)", tok({ alg: "HS256", kid: "k1" }), false],
    ["alg none", tok({ alg: "none", kid: "k1" }), false],
    ["alg lower-case es256", tok({ alg: "es256", kid: "k1" }), false],
    ["kid missing", tok({ alg: "ES256" }), false],
    ["kid empty", tok({ alg: "ES256", kid: "" }), false],
    ["kid not a string", tok({ alg: "ES256", kid: 7 }), false],
    ["header not JSON", `${b64("not json")}.${b64({})}.c2ln`, false],
    ["header is an array", tok(["ES256"]), false],
    ["two parts", `${b64({ alg: "ES256", kid: "k1" })}.${b64({})}`, false],
    ["padding / bad chars in header", `${b64({ alg: "ES256", kid: "k1" })}=.${b64({})}.c2ln`, false],
    ["oversized token", "a".repeat(9000), false],
    ["not a string", null, false],
  ];
  for (const [why, t, want] of rows) {
    const got = precheckJwtHeader(t);
    console.log(`${got.ok === want ? "PASS" : "FAIL"}  ${String(got.ok).padEnd(5)} ${why}`);
    assert.equal(got.ok, want, why);
    if (!got.ok) assert.equal(got.status, 401);
  }
});

test("Origin / Sec-Fetch-Site defence in depth", () => {
  const SITE = "https://beachday.example";
  const req = (method, h) => new Request(`${SITE}/api/proposals/p_X/approve`, { method, headers: h });
  const rows = [
    ["same-origin fetch", req("POST", { origin: SITE, "sec-fetch-site": "same-origin" }), true],
    ["cross-site POST", req("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), false],
    ["same-site sibling subdomain", req("POST", { origin: "https://x.beachday.example", "sec-fetch-site": "same-site" }), false],
    ["foreign Origin, no Fetch Metadata", req("POST", { origin: "https://evil.example" }), false],
    ["Origin null (sandboxed iframe)", req("POST", { origin: "null" }), false],
    ["no Origin, no Fetch Metadata (server-to-server, jobs -> jobs-run)", req("POST", {}), true],
    ["GET is not checked", req("GET", { "sec-fetch-site": "cross-site" }), true],
  ];
  for (const [why, r, want] of rows) {
    const got = checkOrigin(r, SITE);
    console.log(`${got.ok === want ? "PASS" : "FAIL"}  ${String(got.ok).padEnd(5)} ${why}${got.ok ? "" : ` -> ${got.reason}`}`);
    assert.equal(got.ok, want, why);
  }
});
