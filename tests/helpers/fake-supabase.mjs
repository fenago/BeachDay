// ONE stateful fake of the Supabase project Beach Day talks to (ADR-0006): GoTrue (Auth) + PostgREST `profiles`.
// Used by (a) vitest function tests, (b) the harness server through MSW (server-side guard calls) and
// (c) Playwright, which forwards the browser's calls to the SAME instance via /__fake/supabase/*.
//
// Modelled on observed GoTrue behaviour (see knowledge/supabase-auth-engineer): ES256 access tokens with a kid in a JWKS,
// 600 s lifetime, amr [{method, timestamp}] + aal, refresh rotation, PKCE codes, obfuscated sign-up for existing
// addresses, token_hash email links, TOTP factors, PostgREST that answers only for the caller's own row.
// NOT modelled: rate limits, phone, anonymous sign-in, SAML, real Google. Never use a real project.
import { webcrypto, randomUUID, randomBytes, createHash, createHmac } from "node:crypto";
import { FIXTURE_SUPABASE_URL, FIXTURE_PUBLISHABLE_KEY } from "./secrets.mjs";

const subtle = webcrypto.subtle;
const b64u = (x) => Buffer.from(x).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");
const sha256b64u = (s) => createHash("sha256").update(s).digest("base64url");

// ---------- signing keys and JWTs ----------
export async function newSigningKey({ kid = randomUUID() } = {}) {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await subtle.exportKey("jwk", pair.publicKey);
  const jwk = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid, alg: "ES256", use: "sig", key_ops: ["verify"] };
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, kid, jwk };
}

// header overrides let tests make bad-alg / missing-kid / non-JSON headers; `rawHeader` replaces the header string.
export async function signJwt(key, claims, { kid = key.kid, alg = "ES256", header = {}, rawHeader } = {}) {
  const h = rawHeader !== undefined ? rawHeader : JSON.stringify({ alg, typ: "JWT", ...(kid === null ? {} : { kid }), ...header });
  const hp = `${b64u(h)}.${b64u(JSON.stringify(claims))}`;
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, Buffer.from(hp)); // IEEE P1363, as JWS needs
  return `${hp}.${b64u(Buffer.from(sig))}`;
}

async function verifyJwt(key, token, nowMs) {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token ?? "");
  if (!m) return { ok: false, why: "malformed" };
  let header, claims;
  try { header = JSON.parse(unb64u(m[1])); claims = JSON.parse(unb64u(m[2])); } catch { return { ok: false, why: "malformed" }; }
  if (header.alg !== "ES256" || header.kid !== key.kid) return { ok: false, why: "unknown_key" };
  const good = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key.publicKey, unb64u(m[3]), Buffer.from(`${m[1]}.${m[2]}`));
  if (!good) return { ok: false, why: "bad_signature" };
  if (!(claims.exp * 1000 > nowMs)) return { ok: false, why: "expired" };
  return { ok: true, claims, header };
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32encode = (buf) => { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return out; };
const b32decode = (s) => { let bits = ""; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export function totpCode(secretB32, atMs = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)));
  const h = createHmac("sha1", b32decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

const JSON_HEADERS = { "content-type": "application/json" };
const j = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
const authErr = (status, error_code, msg) => j(status, { code: status, error_code, msg });

export const MIN_PASSWORD_LENGTH = 12; // docs/04 §4.5: minimum length 12

/**
 * @param {object} [opts]
 * @param {string} [opts.origin]            project origin (fixture host by default)
 * @param {string} [opts.publishableKey]
 * @param {() => number} [opts.now]         ms clock; tests can move it with setNow()
 * @param {string} [opts.siteUrl]           Site URL used when redirect_to is not allow-listed
 * @param {string[]} [opts.allowedRedirectUrls]   exact redirect URLs (string match, like Supabase's allow-list)
 * @param {boolean} [opts.autoconfirm]      true = sign-up returns a session (Confirm email OFF; do not use for the real model)
 */
export async function createFakeSupabase(opts = {}) {
  const origin = opts.origin ?? FIXTURE_SUPABASE_URL;
  const publishableKey = opts.publishableKey ?? FIXTURE_PUBLISHABLE_KEY;
  let nowFn = opts.now ?? (() => Date.now());
  const ttl = 600;
  let key = await newSigningKey();
  const otherKey = await newSigningKey(); // "another project's key" for forged-token tests

  const s = {
    users: new Map(),          // id -> user
    profiles: new Map(),       // id -> { role }   (PostgREST table)
    sessions: new Map(),       // session_id -> { userId, amr, aal, revoked }
    refresh: new Map(),        // token -> { sessionId, used }
    codes: new Map(),          // pkce auth code -> { userId, challenge, amr, aal, sessionId? }
    emailTokens: new Map(),    // token_hash -> { userId, type, used }
    challenges: new Map(),     // challenge id -> { factorId }
    outbox: [],                // emails "sent": { to, type, tokenHash, at }
    calls: [],                 // { method, path, status }
    restWrites: 0,             // attempted PostgREST writes (must stay denied)
    failures: [],              // { target, mode, times }
    google: { email: "google.user@example.test", deny: false },
    siteUrl: opts.siteUrl ?? "http://127.0.0.1:4173",
    allowedRedirectUrls: new Set(opts.allowedRedirectUrls ?? []),
    autoconfirm: !!opts.autoconfirm,
    hangMs: 30_000,
    releases: new Set(),
  };
  const nowMs = () => nowFn();
  const nowS = () => Math.floor(nowMs() / 1000);
  const iso = (ms = nowMs()) => new Date(ms).toISOString();
  const issuer = `${origin}/auth/v1`;

  // ----- model helpers -----
  const userByEmail = (email) => [...s.users.values()].find((u) => u.email === String(email).trim().toLowerCase());
  function createUser({ email, password = null, confirmed = false, provider = "email", role = "user" }) {
    const id = randomUUID();
    const u = { id, email: String(email).trim().toLowerCase(), password, confirmed, providers: [provider], createdAt: iso(), lastSignInAt: null, factors: [], user_metadata: {}, app_metadata: { provider, providers: [provider] } };
    s.users.set(id, u);
    s.profiles.set(id, { role }); // trigger: a row appears on user creation, role 'user'
    return u;
  }
  const userJson = (u) => ({
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.confirmed ? u.createdAt : undefined, phone: "", confirmed_at: u.confirmed ? u.createdAt : undefined,
    last_sign_in_at: u.lastSignInAt ?? undefined,
    app_metadata: { provider: u.providers[0], providers: u.providers }, user_metadata: u.user_metadata,
    identities: u.providers.map((p) => ({ identity_id: randomUUID(), id: u.id, user_id: u.id, provider: p, identity_data: { email: u.email, sub: u.id }, last_sign_in_at: u.lastSignInAt ?? u.createdAt, created_at: u.createdAt, updated_at: u.createdAt })),
    factors: u.factors.map((f) => ({ id: f.id, friendly_name: f.friendlyName, factor_type: "totp", status: f.status, created_at: u.createdAt, updated_at: u.createdAt })),
    created_at: u.createdAt, updated_at: iso(), is_anonymous: false,
  });
  const hasVerifiedFactor = (u) => u.factors.some((f) => f.status === "verified");

  async function accessToken(u, sess, sessionId, extraClaims = {}) {
    const iat = nowS();
    return signJwt(key, {
      iss: issuer, aud: "authenticated", exp: iat + ttl, iat, sub: u.id, email: u.email, phone: "",
      app_metadata: { provider: u.providers[0], providers: u.providers }, user_metadata: u.user_metadata,
      role: "authenticated", aal: sess.aal, amr: sess.amr, session_id: sessionId, is_anonymous: false, ...extraClaims,
    });
  }
  async function sessionJson(u, sessionId) {
    const sess = s.sessions.get(sessionId);
    const refresh_token = randomBytes(9).toString("base64url").slice(0, 12);
    s.refresh.set(refresh_token, { sessionId, used: false });
    const access_token = await accessToken(u, sess, sessionId);
    return { access_token, token_type: "bearer", expires_in: ttl, expires_at: nowS() + ttl, refresh_token, user: userJson(u) };
  }
  function newSession(u, method, { aal = "aal1", amr } = {}) {
    const id = randomUUID();
    s.sessions.set(id, { userId: u.id, amr: amr ?? [{ method, timestamp: nowS() }], aal, revoked: false });
    u.lastSignInAt = iso();
    return id;
  }

  // ----- failure injection -----
  // targets: jwks | rest | user | token | signup | recover | authorize | verify | factors | logout | "*"
  // modes:   a status number (5xx / 4xx body {}), "network", "hang", "nonjson", "empty"
  const takeFailure = (target) => {
    const f = s.failures.find((x) => (x.target === target || x.target === "*") && x.times !== 0);
    if (!f) return null;
    if (f.times > 0) f.times -= 1;
    return f.mode;
  };
  async function applyFailure(mode, request) {
    if (mode === "network") return Response.error();
    if (mode === "nonjson") return new Response("<html>bad gateway</html>", { status: 200, headers: { "content-type": "text/html" } });
    if (mode === "empty") return new Response("", { status: 200 });
    if (mode === "hang") {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, s.hangMs);
        const done = () => { clearTimeout(t); resolve(); };
        request.signal?.addEventListener("abort", done, { once: true });
        s.releases.add(done);
      });
      return Response.error();
    }
    return new Response("{}", { status: Number(mode), headers: JSON_HEADERS });
  }

  // ----- the router -----
  async function route(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const body = async () => { try { return await request.clone().json(); } catch { return {}; } };

    // JWKS
    if (method === "GET" && path === "/auth/v1/.well-known/jwks.json") {
      const f = takeFailure("jwks"); if (f) return applyFailure(f, request);
      return j(200, { keys: [key.jwk] }, { "cache-control": "public, max-age=600" });
    }
    // PostgREST: profiles. RLS: a caller sees only their own row; no INSERT/UPDATE/DELETE grants.
    if (path === "/rest/v1/profiles") {
      const f = takeFailure("rest"); if (f) return applyFailure(f, request);
      if (request.headers.get("apikey") !== publishableKey) return j(401, { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." });
      if (!bearer) return j(401, { code: "PGRST301", message: "JWT required" });
      const v = await verifyJwt(key, bearer, nowMs());
      if (!v.ok) return j(401, { code: "PGRST301", message: v.why === "expired" ? "JWT expired" : "JWT invalid", details: null, hint: null });
      if (method !== "GET" && method !== "HEAD") { s.restWrites += 1; return j(403, { code: "42501", message: "permission denied for table profiles", details: null, hint: null }); }
      const idFilter = url.searchParams.get("id");
      const wanted = idFilter?.startsWith("eq.") ? decodeURIComponent(idFilter.slice(3)) : null;
      const rows = [];
      const mine = s.profiles.get(v.claims.sub);
      if (mine && (wanted === null || wanted === v.claims.sub)) rows.push({ id: v.claims.sub, role: mine.role });
      const select = (url.searchParams.get("select") ?? "*").split(",");
      const shaped = rows.map((r) => (select.includes("*") ? r : Object.fromEntries(select.filter((c) => c in r).map((c) => [c, r[c]]))));
      if ((request.headers.get("accept") ?? "").includes("vnd.pgrst.object+json")) {
        return shaped.length === 1 ? j(200, shaped[0]) : j(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      }
      return j(200, shaped);
    }
    if (!path.startsWith("/auth/v1/")) return j(404, { message: "not found" });
    const ep = path.slice("/auth/v1".length);

    // GET /user (the Approve step-up call)
    if (method === "GET" && ep === "/user") {
      const f = takeFailure("user"); if (f) return applyFailure(f, request);
      if (!bearer) return authErr(401, "no_authorization", "This endpoint requires a Bearer token");
      const v = await verifyJwt(key, bearer, nowMs());
      if (!v.ok) return authErr(403, "bad_jwt", `invalid JWT: ${v.why}`);
      const sess = s.sessions.get(v.claims.session_id);
      if (!sess || sess.revoked) return authErr(403, "session_not_found", "Session from session_id claim in JWT does not exist");
      const u = s.users.get(v.claims.sub);
      if (!u) return authErr(403, "user_not_found", "User from sub claim in JWT does not exist");
      return j(200, userJson(u));
    }

    // POST /token?grant_type=password|pkce|refresh_token
    if (method === "POST" && ep === "/token") {
      const f = takeFailure("token"); if (f) return applyFailure(f, request);
      const grant = url.searchParams.get("grant_type");
      const b = await body();
      if (grant === "password") {
        const u = userByEmail(b.email);
        if (!u || u.password === null || u.password !== b.password) return authErr(400, "invalid_credentials", "Invalid login credentials");
        if (!u.confirmed) return authErr(400, "email_not_confirmed", "Email not confirmed");
        const sid = newSession(u, "password");
        return j(200, await sessionJson(u, sid));
      }
      if (grant === "pkce") {
        if (!b.auth_code || !b.code_verifier) return authErr(400, "validation_failed", "auth code and code verifier should be non-empty");
        const c = s.codes.get(b.auth_code);
        if (!c) return authErr(404, "flow_state_not_found", "invalid flow state, no valid flow state found");
        if (nowMs() - c.createdAt > 300_000) { s.codes.delete(b.auth_code); return authErr(422, "flow_state_expired", "invalid flow state, flow state has expired"); }
        if (sha256b64u(b.code_verifier) !== c.challenge) return authErr(400, "bad_code_verifier", "invalid flow state, code verifier does not match"); // NOT consumed
        s.codes.delete(b.auth_code);
        const u = s.users.get(c.userId);
        const sid = newSession(u, c.method ?? "oauth", { amr: c.amr, aal: c.aal });
        return j(200, await sessionJson(u, sid));
      }
      if (grant === "refresh_token") {
        const r = s.refresh.get(b.refresh_token);
        if (!r) return authErr(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        const sess = s.sessions.get(r.sessionId);
        if (sess.revoked) return authErr(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
        if (r.used) { sess.revoked = true; return authErr(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used"); } // reuse = theft signal: the session dies
        r.used = true;
        const u = s.users.get(sess.userId);
        // Real GoTrue adds no amr row on refresh (R4-6); the amr keeps the original sign-in. A "token_refresh" amr is only minted via mint(over).
        return j(200, await sessionJson(u, r.sessionId));
      }
      return authErr(400, "validation_failed", "unsupported grant_type");
    }

    // POST /signup  (Confirm email ON: no session; existing address returns an obfuscated user, never an error)
    if (method === "POST" && ep === "/signup") {
      const f = takeFailure("signup"); if (f) return applyFailure(f, request);
      const b = await body();
      if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return authErr(422, "validation_failed", "Unable to validate email address: invalid format");
      if (typeof b.password !== "string" || b.password.length < MIN_PASSWORD_LENGTH) return authErr(422, "weak_password", `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`);
      const existing = userByEmail(b.email);
      if (existing) {
        s.outbox.push({ to: existing.email, type: "already_registered", tokenHash: null, at: iso() });
        const fake = userJson({ ...existing, id: randomUUID(), providers: ["email"], confirmed: false, lastSignInAt: null, factors: [] });
        return j(200, { ...fake, identities: [] }); // GoTrue obfuscation: same shape as a new sign-up, no identities
      }
      const u = createUser({ email: b.email, password: b.password, confirmed: s.autoconfirm });
      if (s.autoconfirm) return j(200, await sessionJson(u, newSession(u, "password")));
      const tokenHash = randomBytes(16).toString("hex");
      s.emailTokens.set(tokenHash, { userId: u.id, type: "signup", used: false });
      s.outbox.push({ to: u.email, type: "signup", tokenHash, at: iso() });
      return j(200, userJson(u));
    }

    // POST /recover  (always 200: never reveals whether the address exists)
    if (method === "POST" && ep === "/recover") {
      const f = takeFailure("recover"); if (f) return applyFailure(f, request);
      const b = await body();
      const u = userByEmail(b.email);
      if (u && u.confirmed) {
        const tokenHash = randomBytes(16).toString("hex");
        s.emailTokens.set(tokenHash, { userId: u.id, type: "recovery", used: false });
        s.outbox.push({ to: u.email, type: "recovery", tokenHash, at: iso() });
      }
      return j(200, {});
    }

    // POST /resend {type:"signup", email}: always 200 {} (never reveals the address); an unconfirmed user gets a NEW single-use link
    if (method === "POST" && ep === "/resend") {
      const f = takeFailure("resend"); if (f) return applyFailure(f, request);
      const b = await body();
      if (!["signup", "email_change"].includes(b.type)) return authErr(400, "validation_failed", "Invalid type");
      const u = userByEmail(b.email);
      if (u && !u.confirmed) {
        const tokenHash = randomBytes(16).toString("hex");
        s.emailTokens.set(tokenHash, { userId: u.id, type: "signup", used: false });
        s.outbox.push({ to: u.email, type: "signup", tokenHash, at: iso() });
      }
      return j(200, {});
    }

    // PUT /user {password} (set a new password after a reset link; needs a live session)
    if (method === "PUT" && ep === "/user") {
      const f = takeFailure("user"); if (f) return applyFailure(f, request);
      if (!bearer) return authErr(401, "no_authorization", "This endpoint requires a Bearer token");
      const v = await verifyJwt(key, bearer, nowMs());
      if (!v.ok) return authErr(403, "bad_jwt", `invalid JWT: ${v.why}`);
      const sess = s.sessions.get(v.claims.session_id);
      const u = s.users.get(v.claims.sub);
      if (!sess || sess.revoked || !u) return authErr(403, "session_not_found", "Session from session_id claim in JWT does not exist");
      const b = await body();
      if (typeof b.password !== "string" || b.password.length < MIN_PASSWORD_LENGTH) return authErr(422, "weak_password", `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`);
      if (b.password === u.password) return authErr(422, "same_password", "New password should be different from the old password.");
      u.password = b.password;
      return j(200, userJson(u));
    }

    // POST /verify  {type, token_hash}  (acted on only after the person taps; single use)
    if (method === "POST" && ep === "/verify") {
      const f = takeFailure("verify"); if (f) return applyFailure(f, request);
      const b = await body();
      const t = s.emailTokens.get(b.token_hash);
      // Real GoTrue: type "email" matches a stored confirmation OR recovery token (auth.js sends "email"); signup/recovery stay exact.
      const typeOk = t && (t.type === b.type || (b.type === "email" && (t.type === "signup" || t.type === "recovery")));
      if (!typeOk || t.used) return authErr(403, "otp_expired", "Email link is invalid or has expired");
      t.used = true;
      const u = s.users.get(t.userId);
      if (t.type === "signup") u.confirmed = true;
      const sid = newSession(u, "otp");
      return j(200, await sessionJson(u, sid));
    }

    // GET /authorize?provider=google&redirect_to=..&code_challenge=..  -> fake Google, then back with ?code=
    if (method === "GET" && ep === "/authorize") {
      const f = takeFailure("authorize"); if (f) return applyFailure(f, request);
      if (url.searchParams.get("provider") !== "google") return authErr(400, "validation_failed", "Unsupported provider");
      const challenge = url.searchParams.get("code_challenge") ?? "";
      if (challenge.length < 43 || challenge.length > 128 || (url.searchParams.get("code_challenge_method") ?? "").toLowerCase() !== "s256") return authErr(400, "validation_failed", "PKCE required: code_challenge (43-128 chars) and code_challenge_method=s256"); // no implicit flow
      let back = url.searchParams.get("redirect_to") ?? s.siteUrl;
      if (back !== s.siteUrl && !s.allowedRedirectUrls.has(back)) back = s.siteUrl; // EXACT string match against the allow-list, else the Site URL
      const dest = new URL(back);
      if (s.google.deny) {
        dest.searchParams.set("error", "access_denied"); dest.searchParams.set("error_code", "oauth_provider_denied"); dest.searchParams.set("error_description", "User denied access");
        return new Response(null, { status: 302, headers: { location: dest.toString() } });
      }
      let u = userByEmail(s.google.email);
      if (!u) { u = createUser({ email: s.google.email, confirmed: true, provider: "google" }); }
      else { // automatic account linking (Dr. Lee 2026-11-23): same verified email joins the existing account
        if (!u.providers.includes("google")) { u.providers.push("google"); u.confirmed = true; }
      }
      const code = randomUUID();
      s.codes.set(code, { userId: u.id, createdAt: nowMs(), challenge, method: "oauth", amr: [{ method: "oauth", timestamp: nowS() }], aal: "aal1" });
      dest.searchParams.set("code", code);
      return new Response(null, { status: 302, headers: { location: dest.toString() } });
    }

    // MFA: POST /factors (enroll), POST /factors/:id/challenge, POST /factors/:id/verify, DELETE /factors/:id
    if (ep === "/factors" || ep.startsWith("/factors/")) {
      const f = takeFailure("factors"); if (f) return applyFailure(f, request);
      if (!bearer) return authErr(401, "no_authorization", "This endpoint requires a Bearer token");
      const v = await verifyJwt(key, bearer, nowMs());
      if (!v.ok) return authErr(403, "bad_jwt", `invalid JWT: ${v.why}`);
      const u = s.users.get(v.claims.sub);
      const sessionId = v.claims.session_id;
      const callerAal = s.sessions.get(sessionId)?.aal ?? "aal1";
      if (method === "POST" && ep === "/factors") {
        if (hasVerifiedFactor(u) && callerAal !== "aal2") return authErr(403, "insufficient_aal", "AAL2 required to enroll a new factor");
        const b = await body();
        const secret = b32encode(randomBytes(20));
        const fid = randomUUID();
        u.factors.push({ id: fid, status: "unverified", secret, friendlyName: b.friendly_name ?? "Authenticator" });
        return j(200, { id: fid, type: "totp", friendly_name: b.friendly_name ?? "Authenticator", totp: { qr_code: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\" viewBox=\"0 0 200 200\"><rect width=\"200\" height=\"200\" fill=\"#fff\"/><rect x=\"20\" y=\"20\" width=\"60\" height=\"60\" fill=\"#000\"/></svg>", secret, uri: `otpauth://totp/Beach%20Day:${encodeURIComponent(u.email)}?secret=${secret}&issuer=Beach%20Day` } });
      }
      const m = /^\/factors\/([^/]+)(?:\/(challenge|verify))?$/.exec(ep);
      const fac = m && u.factors.find((x) => x.id === m[1]);
      if (!fac) return authErr(404, "mfa_factor_not_found", "MFA factor not found");
      if (method === "POST" && m[2] === "challenge") {
        const id = randomUUID(); s.challenges.set(id, { factorId: fac.id });
        return j(200, { id, type: "totp", expires_at: nowS() + 300 });
      }
      if (method === "POST" && m[2] === "verify") {
        const b = await body();
        const ch = s.challenges.get(b.challenge_id);
        if (!ch || ch.factorId !== fac.id) return authErr(400, "mfa_challenge_not_found", "MFA challenge not found");
        if (b.code !== totpCode(fac.secret, nowMs())) return authErr(400, "mfa_verification_failed", "Invalid TOTP code entered");
        s.challenges.delete(b.challenge_id);
        fac.status = "verified";
        const sess = s.sessions.get(sessionId);
        sess.aal = "aal2"; sess.amr = [{ method: "totp", timestamp: nowS() }, ...sess.amr]; // newest first
        return j(200, await sessionJson(u, sessionId));
      }
      if (method === "DELETE" && !m[2]) {
        if (fac.status === "verified" && callerAal !== "aal2") return authErr(422, "insufficient_aal", "AAL2 required to unenroll a verified factor"); u.factors = u.factors.filter((x) => x.id !== fac.id); return j(200, { id: fac.id }); }
      return authErr(405, "method_not_allowed", "method not allowed");
    }

    // POST /logout?scope=global|local|others
    if (method === "POST" && ep === "/logout") {
      const f = takeFailure("logout"); if (f) return applyFailure(f, request);
      if (bearer) {
        const v = await verifyJwt(key, bearer, nowMs());
        if (v.ok) {
          const scope = url.searchParams.get("scope") ?? "global";
          for (const [id, sess] of s.sessions) {
            if (sess.userId !== v.claims.sub) continue;
            if ((scope === "local" && id === v.claims.session_id) || scope === "global" || (scope === "others" && id !== v.claims.session_id)) sess.revoked = true;
          }
        }
      }
      return new Response(null, { status: 204 });
    }
    return authErr(404, "not_found", `no such endpoint ${method} ${ep}`);
  }

  async function handle(request) {
    const u = new URL(request.url);
    let res;
    try {
      const star = takeFailure("*");
      res = star ? await applyFailure(star, request) : await route(request);
    } catch (e) {
      res = j(500, { code: 500, error_code: "unexpected_failure", msg: "fake-supabase internal error" });
      res.fakeError = e;
    }
    s.calls.push({ method: request.method, path: u.pathname, status: res.type === "error" ? 0 : res.status });
    return res;
  }

  // ----- the test-facing API -----
  const api = {
    origin, publishableKey, issuer,
    handle,
    get key() { return key; },
    otherKey,
    jwks: () => ({ keys: [key.jwk] }),
    /** Revocation: the old kid disappears from the JWKS, so every issued token stops verifying. */
    revokeKey: async () => { key = await newSigningKey(); },
    /** Moves the FAKE clock only (PostgREST exp, /user, TOTP, amr timestamps, PKCE expiry). auth-js getClaims checks exp against the REAL Date.now(), so use mintExpired() for an expired token. */
    setNow(ms) { nowFn = typeof ms === "function" ? ms : () => ms; },
    /** Same caveat as setNow: the fake only. */
    advance(ms) { const base = nowFn(); nowFn = () => base + ms; },
    /** Create a user. role is written to the `profiles` table (trigger default 'user'). */
    addUser({ email, password = "correct horse battery staple", confirmed = true, role = "user", provider = "email" }) {
      const u = createUser({ email, password: provider === "email" ? password : null, confirmed, provider, role });
      return { id: u.id, email: u.email, password };
    },
    /** Mirrors supabase/manual/promote-super-admin.sql: only a CONFIRMED user changes. Returns the number of rows changed. */
    setRole(email, role, { force = false } = {}) {
      const u = userByEmail(email);
      if (!u || (!u.confirmed && !force)) return 0;
      s.profiles.get(u.id).role = role;
      return 1;
    },
    deleteProfile(email) { const u = userByEmail(email); if (u) s.profiles.delete(u.id); },
    getUser: (email) => userByEmail(email),
    confirm(email) { const u = userByEmail(email); if (u) u.confirmed = true; },
    setGoogle({ email, deny } = {}) { if (email) s.google.email = email; if (deny !== undefined) s.google.deny = deny; },
    allowRedirectUrl(u) { s.allowedRedirectUrls.add(u); },
    setSiteUrl(u) { s.siteUrl = u; },
    /** The latest email of a type for an address, as the link the person would tap. */
    lastEmail(to, type) { return [...s.outbox].reverse().find((m) => m.to === String(to).toLowerCase() && (!type || m.type === type)) ?? null; },
    get outbox() { return s.outbox; },
    /** TOTP: current code for a user's (first) factor, as the authenticator app would show it. */
    currentTotp(email, { factorId } = {}) { const u = userByEmail(email); const f = u?.factors.find((x) => !factorId || x.id === factorId); return f ? totpCode(f.secret, nowMs()) : null; },
    enrollVerifiedTotp(email) { const u = userByEmail(email); const secret = b32encode(randomBytes(20)); const id = randomUUID(); u.factors.push({ id, status: "verified", secret, friendlyName: "Authenticator" }); return { id, secret }; },
    /**
     * Mint a signed access token without a sign-in (function tests). Creates a live session so /user works.
     * over: claim overrides; opts: { key, kid, alg, header, rawHeader, sign: false } (sign:false returns an unsigned-looking 3-part string).
     */
    async mint(email, over = {}, opts = {}) {
      const u = userByEmail(email);
      if (!u) throw new Error(`fake-supabase: no user ${email}`);
      const sid = over.session_id ?? newSession(u, "password", { aal: over.aal ?? "aal1", amr: over.amr });
      const sess = s.sessions.get(sid);
      const iat = over.iat ?? nowS();
      const claims = {
        iss: issuer, aud: "authenticated", exp: iat + ttl, iat, sub: u.id, email: u.email, phone: "",
        app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
        role: "authenticated", aal: sess?.aal ?? "aal1", amr: sess?.amr ?? [{ method: "password", timestamp: iat }], session_id: sid, is_anonymous: false, ...over,
      };
      return signJwt(opts.key ?? key, claims, opts);
    },
    /** A correctly signed token that is already expired for any verifier (iat 700 s ago, exp 100 s ago). */
    mintExpired(email, over = {}, opts = {}) { const iat = Math.floor(Date.now() / 1000) - 700; return api.mint(email, { iat, exp: iat + 600, ...over }, opts); },
    /** Sign-in as the browser would, returning the session JSON (for function tests that need a real refresh token). */
    async signIn(email, password) {
      const res = await handle(new Request(`${origin}/auth/v1/token?grant_type=password`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password }) }));
      return res.json();
    },
    ageSignIn(email, seconds) { // make the user's existing sessions look `seconds` older (step-up window tests)
      const u = userByEmail(email);
      for (const sess of s.sessions.values()) if (sess.userId === u.id) sess.amr = sess.amr.map((a) => ({ ...a, timestamp: a.timestamp - seconds }));
      u.lastSignInAt = iso(nowMs() - seconds * 1000);
    },
    /** Failure injection. Returns a function that removes it. times: how many calls it affects (-1 = all). */
    fail(target, mode, { times = -1 } = {}) { const f = { target, mode, times }; s.failures.push(f); return () => { s.failures = s.failures.filter((x) => x !== f); }; },
    clearFailures() { s.failures = []; for (const r of [...s.releases]) r(); s.releases.clear(); },
    setHangMs(ms) { s.hangMs = ms; },
    // call counters
    get calls() { return s.calls; },
    callCount(pattern) { return s.calls.filter((c) => (pattern instanceof RegExp ? pattern.test(`${c.method} ${c.path}`) : `${c.method} ${c.path}`.includes(pattern ?? ""))).length; },
    resetCalls() { s.calls.length = 0; },
    get restWrites() { return s.restWrites; },
    sessionCount(email) { const u = userByEmail(email); return [...s.sessions.values()].filter((x) => x.userId === u?.id && !x.revoked).length; },
    reset() { for (const m of [s.users, s.profiles, s.sessions, s.refresh, s.codes, s.emailTokens, s.challenges]) m.clear(); s.outbox.length = 0; s.calls.length = 0; s.restWrites = 0; api.clearFailures(); s.google = { email: "google.user@example.test", deny: false }; },
  };
  return api;
}

/** Claim shapes this fake issues, for Cass to compare with the real GoTrue (see HANDOFF). */
export const CLAIM_SHAPE = Object.freeze({
  access_token: ["iss", "aud", "exp", "iat", "sub", "email", "phone", "app_metadata", "user_metadata", "role", "aal", "amr", "session_id", "is_anonymous"],
  amr_entry: ["method", "timestamp"],
  methods: ["password", "oauth", "otp", "totp", "token_refresh"],
});
