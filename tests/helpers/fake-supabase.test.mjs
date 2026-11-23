import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { createFakeSupabase, signJwt, totpCode, MIN_PASSWORD_LENGTH } from "./fake-supabase.mjs";
import { FIXTURE_SUPABASE_URL, FIXTURE_PUBLISHABLE_KEY } from "./secrets.mjs";

const O = FIXTURE_SUPABASE_URL;
const PW = "correct horse battery staple";
let fake;
beforeEach(async () => { fake = await createFakeSupabase({ siteUrl: "http://127.0.0.1:4173/console", allowedRedirectUrls: ["http://127.0.0.1:4173/console"] }); });

const call = (method, path, { body, token, headers = {} } = {}) =>
  fake.handle(new Request(`${O}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
const rest = (token, id, extra = {}) => call("GET", `/rest/v1/profiles?select=role&id=eq.${id}`, { token, headers: { apikey: FIXTURE_PUBLISHABLE_KEY, ...extra } });
const payload = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url"));
const header = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[0], "base64url"));
const signIn = async (email, pw = PW) => (await call("POST", "/auth/v1/token?grant_type=password", { body: { email, password: pw } }));

describe("tokens and JWKS", () => {
  it("publishes an ES256 JWK and signs access tokens with its kid; claims have the documented shape", async () => {
    fake.addUser({ email: "a@example.test" });
    const s = await (await signIn("a@example.test")).json();
    const jwks = await (await call("GET", "/auth/v1/.well-known/jwks.json")).json();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(jwks.keys[0].d).toBeUndefined();
    expect(header(s.access_token)).toMatchObject({ alg: "ES256", typ: "JWT", kid: jwks.keys[0].kid });
    const c = payload(s.access_token);
    expect(c).toMatchObject({ iss: `${O}/auth/v1`, aud: "authenticated", role: "authenticated", aal: "aal1", is_anonymous: false });
    expect(c.amr).toEqual([{ method: "password", timestamp: expect.any(Number) }]);
    expect(c.exp - c.iat).toBe(600);
    expect(s.expires_in).toBe(600);
  });
  it("revokeKey makes old tokens unverifiable (kid no longer in the JWKS)", async () => {
    fake.addUser({ email: "a@example.test", role: "super_admin" });
    const t = await fake.mint("a@example.test");
    await fake.revokeKey();
    const jwks = await (await call("GET", "/auth/v1/.well-known/jwks.json")).json();
    expect(jwks.keys[0].kid).not.toBe(header(t).kid);
    expect((await rest(t, payload(t).sub)).status).toBe(401);
  });
});

describe("password sign-in", () => {
  it("wrong password and unknown email look the same (400 invalid_credentials)", async () => {
    fake.addUser({ email: "a@example.test" });
    const a = await signIn("a@example.test", "nope-nope-nope-nope"); const b = await signIn("zzz@example.test");
    expect([a.status, b.status]).toEqual([400, 400]);
    expect(await a.json()).toEqual(await b.json());
  });
  it("an unconfirmed address cannot sign in", async () => {
    fake.addUser({ email: "u@example.test", confirmed: false });
    const r = await signIn("u@example.test");
    expect(r.status).toBe(400);
    expect((await r.json()).error_code).toBe("email_not_confirmed");
  });
});

describe("sign-up with Confirm email on", () => {
  it("new address: user object, no session, a signup email is queued", async () => {
    const r = await call("POST", "/auth/v1/signup", { body: { email: "New@Example.test", password: PW } });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.access_token).toBeUndefined();
    expect(j.email).toBe("new@example.test");
    expect(fake.lastEmail("new@example.test", "signup").tokenHash).toMatch(/^[0-9a-f]{32}$/);
  });
  it("existing address: SAME response shape (obfuscated, no identities), no error, no enumeration", async () => {
    fake.addUser({ email: "dr@example.test" });
    const a = await (await call("POST", "/auth/v1/signup", { body: { email: "dr@example.test", password: PW } })).json();
    const b = await (await call("POST", "/auth/v1/signup", { body: { email: "fresh@example.test", password: PW } })).json();
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.access_token).toBeUndefined();
    expect(a.identities).toEqual([]);
    expect(a.id).not.toBe(fake.getUser("dr@example.test").id);
  });
  it(`passwords shorter than ${MIN_PASSWORD_LENGTH} are refused (422 weak_password)`, async () => {
    const r = await call("POST", "/auth/v1/signup", { body: { email: "x@example.test", password: "short" } });
    expect(r.status).toBe(422);
    expect((await r.json()).error_code).toBe("weak_password");
  });
  it("token_hash confirms once, only when the person taps (POST /verify), and is single-use", async () => {
    await call("POST", "/auth/v1/signup", { body: { email: "n@example.test", password: PW } });
    const { tokenHash } = fake.lastEmail("n@example.test", "signup");
    expect((await signIn("n@example.test")).status).toBe(400);
    const ok = await call("POST", "/auth/v1/verify", { body: { type: "signup", token_hash: tokenHash } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).access_token).toBeTruthy();
    expect((await call("POST", "/auth/v1/verify", { body: { type: "signup", token_hash: tokenHash } })).status).toBe(403);
    expect((await signIn("n@example.test")).status).toBe(200);
  });
  it('/verify type "email" (what auth.js sends) matches a stored signup OR recovery token; a wrong type is refused', async () => {
    await call("POST", "/auth/v1/signup", { body: { email: "n@example.test", password: PW } });
    const { tokenHash } = fake.lastEmail("n@example.test", "signup");
    expect((await call("POST", "/auth/v1/verify", { body: { type: "magiclink", token_hash: tokenHash } })).status).toBe(403);
    const ok = await call("POST", "/auth/v1/verify", { body: { type: "email", token_hash: tokenHash } });
    expect(ok.status).toBe(200);
    expect(payload((await ok.json()).access_token).amr[0].method).toBe("otp");
    expect((await signIn("n@example.test")).status).toBe(200);
    await call("POST", "/auth/v1/recover", { body: { email: "n@example.test" } });
    const rec = fake.lastEmail("n@example.test", "recovery").tokenHash;
    expect((await call("POST", "/auth/v1/verify", { body: { type: "email", token_hash: rec } })).status).toBe(200);
    expect((await call("POST", "/auth/v1/verify", { body: { type: "email", token_hash: rec } })).status).toBe(403);
  });
  it("recover answers 200 {} for unknown and known addresses alike; only a known confirmed one gets an email", async () => {
    fake.addUser({ email: "k@example.test" });
    const a = await call("POST", "/auth/v1/recover", { body: { email: "k@example.test" } });
    const b = await call("POST", "/auth/v1/recover", { body: { email: "ghost@example.test" } });
    expect([a.status, b.status, await a.text(), await b.text()]).toEqual([200, 200, "{}", "{}"]);
    expect(fake.lastEmail("k@example.test", "recovery")).toBeTruthy();
    expect(fake.lastEmail("ghost@example.test")).toBeNull();
  });
});

describe("PKCE and Google", () => {
  const verifier = "v".repeat(60);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = (extra = "") => call("GET", `/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent("http://127.0.0.1:4173/console")}&code_challenge=${challenge}&code_challenge_method=s256${extra}`);
  const codeOf = async () => new URL((await authorize()).headers.get("location")).searchParams.get("code");
  const exchange = (auth_code, code_verifier) => call("POST", "/auth/v1/token?grant_type=pkce", { body: { auth_code, code_verifier } });
  it("authorize redirects back with ?code (no '#'), the code exchanges once with the right verifier, session amr is oauth", async () => {
    const r = await authorize();
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location"));
    expect(loc.origin + loc.pathname).toBe("http://127.0.0.1:4173/console");
    expect(loc.hash).toBe("");
    const code = loc.searchParams.get("code");
    const s = await (await exchange(code, verifier)).json();
    expect(payload(s.access_token).amr[0].method).toBe("oauth");
    const again = await exchange(code, verifier);
    expect([again.status, (await again.json()).error_code]).toEqual([404, "flow_state_not_found"]);
  });
  it("NO path: /authorize without a code_challenge (or a short one, or method plain) is 400 validation_failed, never an implicit session", async () => {
    for (const q of ["", "&code_challenge=short&code_challenge_method=s256", `&code_challenge=${challenge}&code_challenge_method=plain`]) {
      const r = await call("GET", `/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent("http://127.0.0.1:4173/console")}${q}`);
      expect([r.status, (await r.json()).error_code]).toEqual([400, "validation_failed"]);
    }
  });
  it("NO path: empty code or verifier 400; unknown code 404; wrong verifier 400 and the code is NOT consumed; expired after 300 s 422", async () => {
    const r1 = await exchange("", ""); expect([r1.status, (await r1.json()).error_code]).toEqual([400, "validation_failed"]);
    const r2 = await exchange("nope", verifier); expect([r2.status, (await r2.json()).error_code]).toEqual([404, "flow_state_not_found"]);
    const code = await codeOf();
    const r3 = await exchange(code, "x".repeat(60)); expect([r3.status, (await r3.json()).error_code]).toEqual([400, "bad_code_verifier"]);
    expect((await exchange(code, verifier)).status).toBe(200);
    const old = await codeOf();
    fake.advance(301_000);
    const r4 = await exchange(old, verifier); expect([r4.status, (await r4.json()).error_code]).toEqual([422, "flow_state_expired"]);
  });
  it("redirect allow-list is an EXACT URL match: same origin but another path, a query or a hash falls back to the Site URL", async () => {
    for (const bad of ["https://evil.example/x", "http://127.0.0.1:4173/not-console", "http://127.0.0.1:4173/console?x=1", "http://127.0.0.1:4173/console#x"]) {
      const r = await call("GET", `/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(bad)}&code_challenge=${challenge}&code_challenge_method=s256`);
      const loc = new URL(r.headers.get("location"));
      expect([loc.origin + loc.pathname, loc.searchParams.get("x")]).toEqual(["http://127.0.0.1:4173/console", null]);
    }
    fake.allowRedirectUrl("http://127.0.0.1:4173/console?return=approve");
    const ok = await call("GET", `/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent("http://127.0.0.1:4173/console?return=approve")}&code_challenge=${challenge}&code_challenge_method=s256`);
    expect(new URL(ok.headers.get("location")).searchParams.get("return")).toBe("approve");
  });
  it("same verified email links to the existing account (automatic linking), role unchanged", async () => {
    fake.addUser({ email: "dr@example.test", role: "super_admin" });
    fake.setGoogle({ email: "dr@example.test" });
    const code = await codeOf();
    const s = await (await exchange(code, verifier)).json();
    expect(s.user.id).toBe(fake.getUser("dr@example.test").id);
    expect(s.user.app_metadata.providers).toEqual(["email", "google"]);
    expect(await (await rest(s.access_token, s.user.id)).json()).toEqual([{ role: "super_admin" }]);
  });
  it("Google denied: comes back with error params, no code", async () => {
    fake.setGoogle({ deny: true });
    const loc = new URL((await authorize()).headers.get("location"));
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("code")).toBeNull();
  });
});

describe("refresh, /user, logout", () => {
  it("refresh rotates and keeps the sign-in amr unchanged (no token_refresh row, like real GoTrue); reusing a refresh token revokes the session", async () => {
    fake.addUser({ email: "a@example.test" });
    const s1 = await (await signIn("a@example.test")).json();
    const r = await call("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s1.refresh_token } });
    const s2 = await r.json();
    expect(payload(s2.access_token).amr.map((a) => a.method)).toEqual(["password"]);
    expect(s2.refresh_token).not.toBe(s1.refresh_token);
    expect((await call("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s1.refresh_token } })).status).toBe(400);
    expect((await call("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s2.refresh_token } })).status).toBe(400); // reuse killed the session
    expect((await call("GET", "/auth/v1/user", { token: s2.access_token })).status).toBe(403);
  });
  it("a bad or expired JWT on /user and /factors is 403 bad_jwt; a missing header is 401 no_authorization", async () => {
    fake.addUser({ email: "a@example.test" });
    const exp = await fake.mintExpired("a@example.test");
    const r = await call("GET", "/auth/v1/user", { token: exp });
    expect([r.status, (await r.json()).error_code]).toEqual([403, "bad_jwt"]);
    expect((await call("POST", "/auth/v1/factors", { token: "x.y.z", body: {} })).status).toBe(403);
    expect((await call("GET", "/auth/v1/user")).status).toBe(401);
  });
  it("GET /user returns last_sign_in_at and factors (what Approve's step-up reads)", async () => {
    fake.addUser({ email: "a@example.test" });
    const s = await (await signIn("a@example.test")).json();
    const u = await (await call("GET", "/auth/v1/user", { token: s.access_token })).json();
    expect(u.last_sign_in_at).toBeTruthy();
    expect(u.factors).toEqual([]);
  });
  it("signOut local: refresh is dead and /user says session_not_found, but PostgREST still honours the unexpired JWT (like the real thing)", async () => {
    fake.addUser({ email: "a@example.test", role: "super_admin" });
    const s = await (await signIn("a@example.test")).json();
    expect((await call("POST", "/auth/v1/logout?scope=local", { token: s.access_token })).status).toBe(204);
    expect((await call("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s.refresh_token } })).status).toBe(400);
    const u = await call("GET", "/auth/v1/user", { token: s.access_token });
    expect(u.status).toBe(403);
    expect((await u.json()).error_code).toBe("session_not_found");
    expect((await rest(s.access_token, s.user.id)).status).toBe(200);
  });
  it("ageSignIn moves amr and last_sign_in_at back (601 s step-up tests)", async () => {
    fake.addUser({ email: "a@example.test" });
    await signIn("a@example.test");
    const t = await fake.mint("a@example.test");
    fake.ageSignIn("a@example.test", 601);
    const u = await (await call("GET", "/auth/v1/user", { token: t })).json();
    expect(Date.now() - Date.parse(u.last_sign_in_at)).toBeGreaterThanOrEqual(601_000);
  });
});

describe("TOTP", () => {
  it("enroll -> challenge -> verify raises the session to aal2 with a totp amr entry; a wrong code is refused", async () => {
    fake.addUser({ email: "a@example.test" });
    const s = await (await signIn("a@example.test")).json();
    const enrol = await (await call("POST", "/auth/v1/factors", { token: s.access_token, body: { factor_type: "totp", friendly_name: "Phone" } })).json();
    const ch = await (await call("POST", `/auth/v1/factors/${enrol.id}/challenge`, { token: s.access_token, body: {} })).json();
    expect((await call("POST", `/auth/v1/factors/${enrol.id}/verify`, { token: s.access_token, body: { challenge_id: ch.id, code: "000000" } })).status).toBe(400);
    const ok = await call("POST", `/auth/v1/factors/${enrol.id}/verify`, { token: s.access_token, body: { challenge_id: ch.id, code: totpCode(enrol.totp.secret) } });
    const s2 = await ok.json();
    expect(payload(s2.access_token)).toMatchObject({ aal: "aal2" });
    expect(payload(s2.access_token).amr.map((a) => a.method)).toEqual(["totp", "password"]); // newest first
    const u = await (await call("GET", "/auth/v1/user", { token: s2.access_token })).json();
    expect(u.factors[0]).toMatchObject({ factor_type: "totp", status: "verified" });
  });
  it("NO path: with a verified factor, enrolling another from an aal1 session is 403 insufficient_aal; unenrolling the verified one is 422; from aal2 both work", async () => {
    fake.addUser({ email: "a@example.test" });
    const { id } = fake.enrollVerifiedTotp("a@example.test");
    const s = await (await signIn("a@example.test")).json();
    const en = await call("POST", "/auth/v1/factors", { token: s.access_token, body: { factor_type: "totp" } });
    expect([en.status, (await en.json()).error_code]).toEqual([403, "insufficient_aal"]);
    const del = await call("DELETE", `/auth/v1/factors/${id}`, { token: s.access_token });
    expect([del.status, (await del.json()).error_code]).toEqual([422, "insufficient_aal"]);
    const ch = await (await call("POST", `/auth/v1/factors/${id}/challenge`, { token: s.access_token, body: {} })).json();
    const s2 = await (await call("POST", `/auth/v1/factors/${id}/verify`, { token: s.access_token, body: { challenge_id: ch.id, code: fake.currentTotp("a@example.test") } })).json();
    expect(payload(s2.access_token).aal).toBe("aal2");
    expect((await call("DELETE", `/auth/v1/factors/${id}`, { token: s2.access_token })).status).toBe(200);
  });
  it("a fresh sign-in of a user WITH a verified factor is aal1 until the TOTP step", async () => {
    fake.addUser({ email: "a@example.test" });
    fake.enrollVerifiedTotp("a@example.test");
    const s = await (await signIn("a@example.test")).json();
    expect(payload(s.access_token).aal).toBe("aal1");
    expect(fake.currentTotp("a@example.test")).toMatch(/^\d{6}$/);
  });
});

describe("PostgREST profiles (RLS)", () => {
  it("returns only the caller's own row, even when asking for another id; role is read live", async () => {
    fake.addUser({ email: "a@example.test", role: "super_admin" });
    const b = fake.addUser({ email: "b@example.test", role: "user" });
    const ta = await fake.mint("a@example.test");
    expect(await (await rest(ta, fake.getUser("a@example.test").id)).json()).toEqual([{ role: "super_admin" }]);
    expect(await (await rest(ta, b.id)).json()).toEqual([]);
    fake.setRole("a@example.test", "user"); // demotion is visible on the next request
    expect(await (await rest(ta, fake.getUser("a@example.test").id)).json()).toEqual([{ role: "user" }]);
  });
  it("no profile row -> []; a role claim in the JWT changes nothing", async () => {
    fake.addUser({ email: "a@example.test", role: "user" });
    const t = await fake.mint("a@example.test", { role: "super_admin", user_role: "super_admin", user_metadata: { role: "super_admin" } });
    expect(await (await rest(t, fake.getUser("a@example.test").id)).json()).toEqual([{ role: "user" }]);
    fake.deleteProfile("a@example.test");
    expect(await (await rest(t, fake.getUser("a@example.test").id)).json()).toEqual([]);
  });
  it("401 for wrong apikey, no token, expired token, tampered payload, another project's key, unsupported alg", async () => {
    fake.addUser({ email: "a@example.test", role: "super_admin" });
    const id = fake.getUser("a@example.test").id;
    const good = await fake.mint("a@example.test");
    const [h, p, s] = good.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload(good), sub: "someone-else" })).toString("base64url")}.${s}`;
    const cases = {
      "wrong apikey": await rest(good, id, { apikey: "sb_publishable_wrong" }),
      "no token": await call("GET", `/rest/v1/profiles?select=role&id=eq.${id}`, { headers: { apikey: FIXTURE_PUBLISHABLE_KEY } }),
      expired: await rest(await fake.mint("a@example.test", { exp: Math.floor(Date.now() / 1000) - 5 }), id),
      tampered: await rest(forged, id),
      "other key": await rest(await fake.mint("a@example.test", {}, { key: fake.otherKey }), id),
      "alg HS256 header": await rest(await fake.mint("a@example.test", {}, { alg: "HS256" }), id),
    };
    for (const [name, r] of Object.entries(cases)) expect([name, r.status]).toEqual([name, 401]);
    expect(p).toBeTruthy();
  });
  it("INSERT/UPDATE/DELETE are denied and counted (a user cannot self-promote)", async () => {
    fake.addUser({ email: "a@example.test", role: "user" });
    const t = await fake.mint("a@example.test");
    const r = await call("PATCH", `/rest/v1/profiles?id=eq.${fake.getUser("a@example.test").id}`, { token: t, headers: { apikey: FIXTURE_PUBLISHABLE_KEY }, body: { role: "super_admin" } });
    expect(r.status).toBe(403);
    expect(fake.restWrites).toBe(1);
    expect(await (await rest(t, fake.getUser("a@example.test").id)).json()).toEqual([{ role: "user" }]);
  });
  it("setRole changes 0 rows for an unconfirmed email (mirrors promote-super-admin.sql)", () => {
    fake.addUser({ email: "u@example.test", confirmed: false });
    expect(fake.setRole("u@example.test", "super_admin")).toBe(0);
    fake.confirm("u@example.test");
    expect(fake.setRole("u@example.test", "super_admin")).toBe(1);
  });
});

describe("minting odd tokens, failure modes, counters", () => {
  it("mintExpired is signed correctly but expired for every verifier (the fake's clock is not what auth-js uses)", async () => {
    fake.addUser({ email: "a@example.test", role: "super_admin" });
    const t = await fake.mintExpired("a@example.test");
    expect(payload(t).exp).toBeLessThan(Math.floor(Date.now() / 1000));
    expect((await rest(t, fake.getUser("a@example.test").id)).status).toBe(401);
  });
  it("mint can produce a missing kid, non-JSON header and unsigned-garbage tokens", async () => {
    fake.addUser({ email: "a@example.test" });
    const noKid = await fake.mint("a@example.test", {}, { kid: null });
    expect(header(noKid).kid).toBeUndefined();
    const rawBad = await fake.mint("a@example.test", {}, { rawHeader: "not json" });
    expect(Buffer.from(rawBad.split(".")[0], "base64url").toString()).toBe("not json");
    expect(await signJwt(fake.key, { a: 1 })).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
  it("fail(): status, nonjson, network (Response.error), times counts down, clearFailures removes", async () => {
    fake.addUser({ email: "a@example.test", role: "super_admin" });
    const t = await fake.mint("a@example.test"); const id = fake.getUser("a@example.test").id;
    fake.fail("rest", 500, { times: 1 });
    expect((await rest(t, id)).status).toBe(500);
    expect((await rest(t, id)).status).toBe(200);
    fake.fail("rest", "nonjson");
    const nj = await rest(t, id);
    expect(nj.headers.get("content-type")).toContain("text/html");
    fake.clearFailures();
    fake.fail("jwks", "network");
    expect((await call("GET", "/auth/v1/.well-known/jwks.json")).type).toBe("error");
    fake.clearFailures();
    fake.fail("user", 502);
    expect((await call("GET", "/auth/v1/user", { token: t })).status).toBe(502);
  });
  it("hang is released by an aborted request signal", async () => {
    fake.fail("user", "hang");
    const ac = new AbortController();
    const p = fake.handle(new Request(`${O}/auth/v1/user`, { signal: ac.signal }));
    setTimeout(() => ac.abort(), 20);
    expect((await p).type).toBe("error");
  });
  it("counts calls by 'METHOD path' and resets", async () => {
    await call("GET", "/auth/v1/.well-known/jwks.json"); await call("GET", "/auth/v1/.well-known/jwks.json");
    expect(fake.callCount("jwks.json")).toBe(2);
    expect(fake.callCount(/^GET \/auth/)).toBe(2);
    fake.resetCalls();
    expect(fake.callCount()).toBe(0);
  });
});
