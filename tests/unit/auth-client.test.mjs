// public/js/console/auth.js, run under Node against the REAL vendored bundle
// (public/vendor/supabase-auth-js-2.119.2.mjs) with a fake fetch, location, history and storages.
// No network, no real project. The publishable key is a fixture placeholder.
import { describe, it, expect, afterEach } from "vitest";
import { createAuth, RETURN_ROUTE_KEY, safeError, AuthUnavailableError } from "../../public/js/console/auth.js";

const SUPA = "https://bdlocaltest.supabase.co";
const KEY = "sb_publishable_bdlocaltest_0000000000000000";
const SITE = "https://beachday.example";
const UID = "5b0c7a52-0000-4000-8000-000000000001";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);
const jwt = (ttl = 600) => `${b64u({ alg: "ES256", typ: "JWT", kid: "k" })}.${b64u({ sub: UID, exp: nowS() + ttl, aud: "authenticated" })}.sig`;
const userBody = (over = {}) => ({ id: UID, aud: "authenticated", email: "lee@example.com", app_metadata: { providers: ["email"] }, identities: [], factors: [], ...over });
const sessionBody = (ttl = 600, user = userBody()) => ({ access_token: jwt(ttl), refresh_token: "r-" + Math.random(), expires_in: ttl, expires_at: nowS() + ttl, token_type: "bearer", user });

function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function fakeLocation(href) {
  const loc = { href, assigned: [], assign(u) { this.assigned.push(u); } };
  Object.defineProperty(loc, "origin", { get() { return new URL(this.href).origin; } });
  return loc;
}
const live = [];
function setup({ href = `${SITE}/console`, routes = {}, user = userBody(), refreshTimeoutMs = 10_000 } = {}) {
  const log = [];
  const fetchImpl = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const h = new Headers(init.headers);
    const call = { method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), body, apikey: h.get("apikey"), authorization: h.get("authorization") };
    log.push(call);
    const key = `${call.method} ${u.pathname}${u.searchParams.get("grant_type") ? "?" + u.searchParams.get("grant_type") : ""}`;
    if (routes[key]) return routes[key](call);
    if (key === "POST /auth/v1/token?password" || key === "POST /auth/v1/token?pkce" || key === "POST /auth/v1/token?refresh_token") return Response.json(sessionBody(600, user));
    if (key === "POST /auth/v1/verify") return Response.json(sessionBody(600, user));
    if (key === "GET /auth/v1/user") return Response.json(user);
    if (key === "PUT /auth/v1/user") return Response.json(user);
    if (key === "POST /auth/v1/signup") return Response.json({ ...userBody(), identities: [] });
    if (key === "POST /auth/v1/logout") return new Response(null, { status: 204 });
    return Response.json({}, { status: 200 });
  };
  const storage = memStorage();
  const sessionStore = memStorage();
  const location = fakeLocation(href);
  const history = { state: null, replaced: [], replaceState(s, _t, url) { this.replaced.push(url); location.href = new URL(url, location.href).href; } };
  const auth = createAuth({ config: { SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: KEY }, storage, sessionStore, location, history, fetchImpl, autoRefreshToken: false, refreshTimeoutMs });
  live.push(auth);
  return { auth, log, storage, sessionStore, location, history };
}
afterEach(() => { for (const a of live.splice(0)) a._client.stopAutoRefresh(); });
const withSession = async (s, ttl = 600) => {
  await s.auth._client.setSession({ access_token: jwt(ttl), refresh_token: "r" });
  s.log.length = 0;
};

describe("client settings", () => {
  it("PKCE, auto refresh on by default, session in the given storage, URL detection off", () => {
    const loc = fakeLocation(`${SITE}/console`);
    const a = createAuth({ config: { SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: KEY }, storage: memStorage(), sessionStore: memStorage(), location: loc, history: {}, fetchImpl: async () => Response.json({}) });
    live.push(a);
    expect(a._client.flowType).toBe("pkce");
    expect(a._client.autoRefreshToken).toBe(true);
    expect(a._client.detectSessionInUrl).toBe(false);
    expect(a._client.persistSession).toBe(true);
    expect(a.redirectTo).toBe(`${SITE}/console`);
  });
  it("refuses a bad config: http URL, a URL with a path, a non-publishable key", () => {
    const secret = ["sb", "secret", "x".repeat(24)].join("_");
    for (const config of [{}, { SUPABASE_URL: "http://bdlocaltest.supabase.co", SUPABASE_PUBLISHABLE_KEY: KEY },
      { SUPABASE_URL: `${SUPA}/x`, SUPABASE_PUBLISHABLE_KEY: KEY }, { SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: secret }]) {
      expect(() => createAuth({ config, storage: memStorage(), sessionStore: memStorage(), location: fakeLocation(SITE), history: {} })).toThrow();
    }
  });
  it("the publishable key goes on apikey; it is never sent as a Bearer token", async () => {
    const s = setup();
    await s.auth.signInWithPassword("lee@example.com", "correct horse battery staple");
    expect(s.log[0].apikey).toBe(KEY);
    expect(s.log.every((c) => c.authorization !== `Bearer ${KEY}`)).toBe(true);
  });
});

describe("Google and the PKCE return", () => {
  it("signInWithGoogle: navigates to the project's /authorize with PKCE and the one exact redirect; route kept in sessionStorage", async () => {
    const s = setup();
    expect(await s.auth.signInWithGoogle("#/console/proposals/p_01HZX0000000000000000000AB")).toEqual({ ok: true });
    const u = new URL(s.location.assigned[0]);
    expect(`${u.origin}${u.pathname}`).toBe(`${SUPA}/auth/v1/authorize`);
    expect(u.searchParams.get("provider")).toBe("google");
    expect(u.searchParams.get("redirect_to")).toBe(`${SITE}/console`);
    expect(u.searchParams.get("code_challenge_method")).toBe("s256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(s.sessionStore.getItem(RETURN_ROUTE_KEY)).toBe("#/console/proposals/p_01HZX0000000000000000000AB");
    expect(s.log).toEqual([]);
  });
  it("a return route that is not a plain #/console route is not saved (no URLs, no query, no script)", async () => {
    for (const bad of ["https://evil.example/", "#/console/x?approve=1", "javascript:alert(1)", "#/elsewhere", "#/console/../x", 42]) {
      const s = setup();
      await s.auth.signInWithGoogle(bad);
      expect(s.sessionStore.getItem(RETURN_ROUTE_KEY)).toBeNull();
    }
  });
  it("completeRedirect: exchanges ?code= in this browser, strips it, returns the saved route once", async () => {
    const s = setup();
    await s.auth.signInWithGoogle("#/console/proposals/p_01HZX0000000000000000000AB");
    s.location.href = `${SITE}/console?code=abc123`;
    const r = await s.auth.completeRedirect();
    expect(r).toEqual({ kind: "oauth", ok: true, returnRoute: "#/console/proposals/p_01HZX0000000000000000000AB" });
    const ex = s.log.find((c) => c.query.grant_type === "pkce");
    expect([ex.body.auth_code, typeof ex.body.code_verifier]).toEqual(["abc123", "string"]);
    expect(s.history.replaced).toEqual(["/console"]);
    expect(s.auth.takeReturnRoute()).toBeNull(); // read once, deleted
    expect(await s.auth.getSession()).toBeTruthy();
  });
  it("completeRedirect: a ?code= from another browser (no verifier) fails without a network call, and is still stripped", async () => {
    const s = setup({ href: `${SITE}/console?code=abc123` });
    const r = await s.auth.completeRedirect();
    expect([r.ok, r.error.code]).toEqual([false, "pkce_code_verifier_not_found"]);
    expect(s.log).toEqual([]);
    expect(s.history.replaced).toEqual(["/console"]);
  });
  it("completeRedirect: ?error= from Google is stripped and mapped to oauth_failed; the raw description never leaves", async () => {
    const s = setup({ href: `${SITE}/console?error=access_denied&error_code=x&error_description=%3Cimg%20src%3Dx%3E` });
    s.sessionStore.setItem(RETURN_ROUTE_KEY, "#/console");
    const r = await s.auth.completeRedirect();
    expect(r).toEqual({ kind: "oauth", ok: false, error: { code: "oauth_failed", status: 0, retryable: false } });
    expect(s.history.replaced).toEqual(["/console"]);
    expect(s.sessionStore.getItem(RETURN_ROUTE_KEY)).toBeNull();
  });
  it("completeRedirect: nothing in the URL does nothing", async () => {
    const s = setup({ href: `${SITE}/console#/console/agents` });
    expect(await s.auth.completeRedirect()).toEqual({ kind: "none" });
    expect([s.log, s.history.replaced]).toEqual([[], []]);
  });
});

describe("email links (token_hash): nothing happens until the tap", () => {
  it("pendingEmailLink reports the type only, makes no call and leaves the URL alone", () => {
    const s = setup({ href: `${SITE}/console?token_hash=pkce_abc&type=email` });
    expect(s.auth.pendingEmailLink()).toEqual({ type: "email" });
    expect([s.log, s.history.replaced]).toEqual([[], []]);
  });
  it("pendingEmailLink strips an unsupported type (magiclink, invite) and reports nothing", () => {
    const s = setup({ href: `${SITE}/console?token_hash=x&type=magiclink` });
    expect(s.auth.pendingEmailLink()).toBeNull();
    expect(s.history.replaced).toEqual(["/console"]);
  });
  it("confirmFromEmailLink (the tap): verifyOtp with token_hash, then strips; an email confirmation ends signed out", async () => {
    const s = setup({ href: `${SITE}/console?token_hash=pkce_abc&type=email` });
    expect(await s.auth.confirmFromEmailLink()).toEqual({ ok: true, type: "email" });
    const v = s.log.find((c) => c.path === "/auth/v1/verify");
    expect([v.method, v.body.token_hash, v.body.type]).toEqual(["POST", "pkce_abc", "email"]);
    expect(s.history.replaced).toEqual(["/console"]);
    expect(s.log.find((c) => c.path === "/auth/v1/logout")?.query.scope).toBe("local");
    expect(await s.auth.getSession()).toBeNull();
  });
  it("confirmFromEmailLink with type=recovery keeps the session for S5, then setNewPassword updates the user", async () => {
    const s = setup({ href: `${SITE}/console?token_hash=pkce_r&type=recovery` });
    expect(await s.auth.confirmFromEmailLink()).toEqual({ ok: true, type: "recovery" });
    expect(await s.auth.getSession()).toBeTruthy();
    expect(await s.auth.setNewPassword("a much longer new password")).toEqual({ ok: true });
    expect(s.log.some((c) => c.method === "PUT" && c.path === "/auth/v1/user" && c.body.password)).toBe(true);
  });
  it("a used or expired link: the error code comes back, the URL is still stripped", async () => {
    const s = setup({ href: `${SITE}/console?token_hash=old&type=email`,
      routes: { "POST /auth/v1/verify": () => Response.json({ code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" }, { status: 403 }) } });
    const r = await s.auth.confirmFromEmailLink();
    expect([r.ok, r.type, r.error.code]).toEqual([false, "email", "otp_expired"]);
    expect(JSON.stringify(r)).not.toContain("invalid or has expired");
    expect(s.history.replaced).toEqual(["/console"]);
  });
  it("an unsupported type is refused before any network call", async () => {
    const s = setup({ href: `${SITE}/console?token_hash=x&type=invite` });
    expect((await s.auth.confirmFromEmailLink()).error.code).toBe("unsupported_link");
    expect(s.log).toEqual([]);
  });
});

describe("sign up, reset, resend: one exact redirect, no enumeration", () => {
  it("signUp sends the /console redirect and a PKCE challenge; no session means 'check your email'", async () => {
    const s = setup();
    expect(await s.auth.signUp("new@example.com", "correct horse battery staple")).toEqual({ ok: true, needsConfirmation: true });
    expect(s.log[0].path).toBe("/auth/v1/signup");
    expect(s.log[0].query.redirect_to).toBe(`${SITE}/console`);
    expect(s.log[0].body.code_challenge).toBeTruthy();
  });
  it("every redirect any call sends is the single allow-list entry, with no query and no hash", async () => {
    const s = setup();
    await s.auth.signUp("a@example.com", "correct horse battery staple");
    await s.auth.sendReset("a@example.com");
    await s.auth.resendConfirmation("a@example.com");
    await s.auth.signInWithGoogle("#/console");
    const sent = [...s.log.map((c) => c.query.redirect_to), new URL(s.location.assigned[0]).searchParams.get("redirect_to")];
    expect([...new Set(sent)]).toEqual([`${SITE}/console`]);
  });
  it("a per-user email cooldown 429 looks like success on reset and resend; the per-IP limit does not", async () => {
    const cooldown = () => Response.json({ code: 429, error_code: "over_email_send_rate_limit", msg: "only request this after 60 seconds" }, { status: 429 });
    const ipLimit = () => Response.json({ code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }, { status: 429 });
    let s = setup({ routes: { "POST /auth/v1/recover": cooldown, "POST /auth/v1/resend": cooldown } });
    expect(await s.auth.sendReset("a@example.com")).toEqual({ ok: true });
    expect(await s.auth.resendConfirmation("a@example.com")).toEqual({ ok: true });
    s = setup({ routes: { "POST /auth/v1/recover": ipLimit } });
    expect((await s.auth.sendReset("a@example.com")).error).toEqual({ code: "over_request_rate_limit", status: 429, retryable: false });
  });
  it("wrong password: a code, never the message", async () => {
    const s = setup({ routes: { "POST /auth/v1/token?password": () => Response.json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400 }) } });
    const r = await s.auth.signInWithPassword("a@example.com", "nope");
    expect(r).toEqual({ ok: false, error: { code: "invalid_credentials", status: 400, retryable: false } });
  });
  it("Supabase down: retryable network error, not 'wrong password'", async () => {
    const s = setup({ routes: { "POST /auth/v1/token?password": () => { throw new TypeError("fetch failed"); } } });
    const r = await s.auth.signInWithPassword("a@example.com", "x");
    expect([r.ok, r.error.retryable]).toEqual([false, true]);
  });
});

describe("tokens before /api/* calls (docs/04 §4.1: refresh when < 120 s left)", () => {
  it("no session -> null", async () => {
    expect(await setup().auth.getAccessToken()).toBeNull();
  });
  it("an hour left: the stored token, no refresh", async () => {
    const s = setup();
    await withSession(s, 3600);
    expect((await s.auth.getAccessToken()).split(".").length).toBe(3);
    expect(s.log.filter((c) => c.query.grant_type === "refresh_token")).toEqual([]);
  });
  it("100 s left: exactly one refresh, and the new token", async () => {
    const s = setup();
    await withSession(s, 100);
    const t = await s.auth.getAccessToken({ minValiditySeconds: 120 });
    expect(s.log.filter((c) => c.query.grant_type === "refresh_token").length).toBe(1);
    expect(t.split(".").length).toBe(3);
  });
  it("refresh rejected (revoked) -> null, so the Console shows S7", async () => {
    const s = setup({ routes: { "POST /auth/v1/token?refresh_token": () => Response.json({ code: 400, error_code: "refresh_token_not_found", msg: "x" }, { status: 400 }) } });
    await withSession(s, 100);
    expect(await s.auth.getAccessToken()).toBeNull();
  });
  it("refresh could not run (Supabase down) -> AuthUnavailableError within refreshTimeoutMs, so the Console shows 'try again', not S7", async () => {
    const s = setup({ refreshTimeoutMs: 300, routes: { "POST /auth/v1/token?refresh_token": () => new Response("bad gateway", { status: 502 }) } });
    await withSession(s, 100);
    const t0 = Date.now();
    await expect(s.auth.getAccessToken()).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("60 s left (inside auth-js's own refresh margin) and refresh 502 -> AuthUnavailableError in < 2 s", async () => {
    const s = setup({ refreshTimeoutMs: 300, routes: { "POST /auth/v1/token?refresh_token": () => new Response("bad gateway", { status: 502 }) } });
    await withSession(s, 60);
    const t0 = Date.now();
    await expect(s.auth.getAccessToken()).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("an expired access token and refresh 502 -> AuthUnavailableError in < 2 s, not null (S7)", async () => {
    const s = setup({ refreshTimeoutMs: 300, routes: { "POST /auth/v1/token?refresh_token": () => new Response("bad gateway", { status: 502 }) } });
    await withSession(s, 3600);
    // Expire the stored session in place, as if the tab slept past exp.
    const k = [...s.storage.m.keys()].find((x) => x.endsWith("-auth-token"));
    const stored = JSON.parse(s.storage.getItem(k));
    stored.expires_at = nowS() - 30;
    s.storage.setItem(k, JSON.stringify(stored));
    const t0 = Date.now();
    await expect(s.auth.getAccessToken()).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("the test-only client handle is not enumerable", () => {
    const { auth } = setup();
    expect(Object.keys(auth)).not.toContain("_client");
    expect(auth._client).toBeTruthy();
  });
  it("a refresh that answers 502 once and then succeeds still yields a token (auth-js retries inside the window)", async () => {
    let n = 0;
    const s = setup({ routes: { "POST /auth/v1/token?refresh_token": () => (n++ === 0 ? new Response("bad gateway", { status: 502 }) : Response.json(sessionBody())) } });
    await withSession(s, 100);
    expect((await s.auth.getAccessToken()).split(".").length).toBe(3);
  });
});

describe("sign out", () => {
  it("Sign Out is this device only (scope=local) and forgets the return route", async () => {
    const s = setup();
    await withSession(s);
    s.sessionStore.setItem(RETURN_ROUTE_KEY, "#/console");
    expect(await s.auth.signOut()).toEqual({ ok: true });
    expect(s.log.find((c) => c.path === "/auth/v1/logout").query.scope).toBe("local");
    expect(s.sessionStore.getItem(RETURN_ROUTE_KEY)).toBeNull();
    expect(await s.auth.getSession()).toBeNull();
  });
  it("Sign Out Everywhere is scope=global", async () => {
    const s = setup();
    await withSession(s);
    await s.auth.signOut({ everywhere: true });
    expect(s.log.find((c) => c.path === "/auth/v1/logout").query.scope).toBe("global");
  });
});

describe("step-up and TOTP (S8, S12)", () => {
  it("stepUpWithPassword signs in again with the current account's email (no TOTP factor)", async () => {
    const s = setup();
    await withSession(s);
    expect(await s.auth.stepUpWithPassword("correct horse battery staple")).toEqual({ ok: true });
    const t = s.log.find((c) => c.query.grant_type === "password");
    expect(t.body.email).toBe("lee@example.com");
  });
  it("stepUpWithPassword with no session refuses without a network call", async () => {
    const s = setup();
    expect((await s.auth.stepUpWithPassword("x")).error.code).toBe("no_session");
    expect(s.log).toEqual([]);
  });
  it("with a verified TOTP factor: a missing or malformed code is refused before the password is sent", async () => {
    const user = userBody({ factors: [{ id: "f1", factor_type: "totp", status: "verified" }] });
    const s = setup({ user });
    await withSession(s);
    for (const code of [undefined, "", "12345", "abcdef", "1234567"]) {
      expect((await s.auth.stepUpWithPassword("pw", code)).error.code).toBe("totp_required");
    }
    expect(s.log.some((c) => c.query.grant_type === "password")).toBe(false);
  });
  it("with a verified TOTP factor: password, then challenge and verify the code", async () => {
    const user = userBody({ factors: [{ id: "f1", factor_type: "totp", status: "verified" }] });
    const s = setup({ user, routes: {
      "POST /auth/v1/factors/f1/challenge": () => Response.json({ id: "c1", type: "totp", expires_at: nowS() + 300 }),
      "POST /auth/v1/factors/f1/verify": () => Response.json(sessionBody(600, user)),
    } });
    await withSession(s);
    expect(await s.auth.stepUpWithPassword("pw", "123456")).toEqual({ ok: true });
    const v = s.log.find((c) => c.path === "/auth/v1/factors/f1/verify");
    expect([v.body.code, v.body.challenge_id]).toEqual(["123456", "c1"]);
  });
  it("stepUpWithGoogle leaves for Google like sign-in and keeps only the route", async () => {
    const s = setup();
    await withSession(s);
    expect(await s.auth.stepUpWithGoogle("#/console/proposals/p_01HZX0000000000000000000AB")).toEqual({ ok: true });
    expect(new URL(s.location.assigned[0]).searchParams.get("redirect_to")).toBe(`${SITE}/console`);
  });
  it("getAccount reports sign-in methods and a verified factor, for the S8 fields", async () => {
    const user = userBody({ app_metadata: { providers: ["email", "google"] }, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] });
    const s = setup({ user });
    await s.auth.signInWithPassword("lee@example.com", "pw");
    expect(await s.auth.getAccount()).toEqual({ id: UID, email: "lee@example.com", methods: { password: true, google: true }, hasVerifiedFactor: true });
  });
  it("mfa.enroll returns the QR data URL and the key; challengeAndVerify checks the code format first", async () => {
    const s = setup({ routes: { "POST /auth/v1/factors": () => Response.json({ id: "f9", type: "totp", totp: { qr_code: "<svg/>", secret: "ABCDEFGHIJKLMNOP", uri: "otpauth://x" } }) } });
    await withSession(s);
    const e = await s.auth.mfa.enroll({ friendlyName: "Phone" });
    expect([e.ok, e.factorId, e.secret, e.qrCode.startsWith("data:image/svg+xml")]).toEqual([true, "f9", "ABCDEFGHIJKLMNOP", true]);
    s.log.length = 0;
    expect((await s.auth.mfa.challengeAndVerify("f9", "12ab56")).error.code).toBe("totp_invalid_format");
    expect(s.log).toEqual([]);
  });
});

describe("safeError", () => {
  it("keeps only a code, a status and the retryable flag", () => {
    expect(safeError({ code: "weak_password", status: 422, message: "<b>leak</b>" })).toEqual({ code: "weak_password", status: 422, retryable: false });
    expect(safeError({ code: "Has Spaces <x>", status: "x" })).toEqual({ code: "unknown", status: 0, retryable: false });
    expect(safeError(null)).toEqual({ code: "unknown", status: 0, retryable: false });
  });
});
