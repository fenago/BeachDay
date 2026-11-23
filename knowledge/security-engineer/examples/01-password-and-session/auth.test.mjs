// node --test auth.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword, verifyPassword, createSession, verifySession, sessionCookie,
  csrfToken, verifyCsrf, recentlyAuthenticated, SESSION_TTL_S,
} from "./auth.mjs";

const SECRET = "test-only-session-secret-0123456789abcdef"; // placeholder, >= 32 bytes
const PW = "correct horse beach day";

test("scrypt hash: format, unique salt, verify right/wrong", async () => {
  const t0 = performance.now();
  const h1 = await hashPassword(PW);
  const ms = Math.round(performance.now() - t0);
  const h2 = await hashPassword(PW);
  console.log(`hash: ${h1.slice(0, 32)}…  (${ms} ms)`);
  assert.match(h1, /^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.notEqual(h1, h2, "random salt per hash");
  assert.equal(await verifyPassword(PW, h1), true);
  assert.equal(await verifyPassword(PW + " ", h1), false);
  assert.equal(await verifyPassword("", h1), false);
  assert.equal(await verifyPassword(123, h1), false);
});

test("stored hash with absurd params is refused (DoS guard)", async () => {
  await assert.rejects(verifyPassword(PW, "scrypt$1073741824$8$1$AAAA$AAAA"), /out of range/);
  await assert.rejects(verifyPassword(PW, "bcrypt$whatever"), /format/);
});

test("session round trip and cookie flags", () => {
  const s = createSession(SECRET);
  const claims = verifySession(s.token, SECRET);
  assert.equal(claims.sid, s.sid);
  assert.equal(claims.exp - claims.iat, SESSION_TTL_S);
  const c = sessionCookie(s.token);
  console.log(c.replace(s.token, "<token>"));
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=43200"]) assert.ok(c.includes(flag), flag);
});

test("tampering is rejected", () => {
  const s = createSession(SECRET);
  const [payload, mac] = s.token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  const forged = Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 10 * 365 * 86400 })).toString("base64url");
  const flipped = mac.slice(0, -1) + (mac.at(-1) === "A" ? "B" : "A");
  const cases = {
    "extended exp, old MAC": `${forged}.${mac}`,
    "flipped MAC char": `${payload}.${flipped}`,
    "MAC from another secret": createSession("another-secret-another-secret-12345").token,
    "no dot": payload,
    "three parts": `${payload}.${mac}.x`,
    "empty": "",
    "non-string": 42,
    "huge": "a".repeat(5000) + "." + mac,
    "alg-none style": `${payload}.`,
  };
  for (const [name, tok] of Object.entries(cases)) assert.equal(verifySession(tok, SECRET), null, name);
});

test("expiry: valid until exp, rejected at and after", () => {
  const t0 = Date.UTC(2026, 10, 23, 12, 0, 0);
  const s = createSession(SECRET, t0);
  assert.ok(verifySession(s.token, SECRET, t0 + (SESSION_TTL_S - 1) * 1000));
  assert.equal(verifySession(s.token, SECRET, t0 + SESSION_TTL_S * 1000), null);
  assert.equal(verifySession(s.token, SECRET, t0 + 13 * 3600 * 1000), null);
});

test("step-up window for Approve is 10 minutes", () => {
  const t0 = Date.UTC(2026, 10, 23, 12, 0, 0);
  const claims = verifySession(createSession(SECRET, t0).token, SECRET, t0);
  assert.equal(recentlyAuthenticated(claims, t0 + 9 * 60 * 1000), true);
  assert.equal(recentlyAuthenticated(claims, t0 + 11 * 60 * 1000), false);
});

test("CSRF token is bound to the session id", () => {
  const a = createSession(SECRET), b = createSession(SECRET);
  assert.equal(verifyCsrf(SECRET, a.sid, a.csrf), true);
  assert.equal(verifyCsrf(SECRET, b.sid, a.csrf), false, "token from another session");
  assert.equal(verifyCsrf(SECRET, a.sid, undefined), false);
  assert.notEqual(csrfToken(SECRET, a.sid), a.token.split(".")[1], "separate keys for CSRF and session");
});

test("short SESSION_SECRET is refused", () => {
  assert.throws(() => createSession("short"), /32 bytes/);
});
