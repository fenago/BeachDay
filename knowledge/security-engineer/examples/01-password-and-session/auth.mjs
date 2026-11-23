// lib/auth shape for the Beach Day Console: scrypt password hash + HMAC-signed session cookie.
// Node built-ins only. Parameters follow the OWASP Password Storage Cheat Sheet (scrypt N=2^17, r=8, p=1).
import { scrypt, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keyLen: 32 };
// Node's default maxmem is 32 MiB; scrypt needs ~128*N*r bytes = 128 MiB here, so raise it.
const MAXMEM = 256 * 1024 * 1024;

const scryptAsync = (pw, salt, keyLen, opts) =>
  new Promise((res, rej) => scrypt(pw, salt, keyLen, opts, (e, k) => (e ? rej(e) : res(k))));
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");

/** Returns "scrypt$N$r$p$<salt b64url>$<hash b64url>" — the value stored in CONSOLE_PASSWORD_HASH. */
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) throw new Error("password must be 12-1024 chars");
  const salt = randomBytes(16);
  const { N, r, p, keyLen } = SCRYPT;
  const hash = await scryptAsync(password.normalize("NFC"), salt, keyLen, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(hash)}`;
}

/** Constant-time verify. Never throws on a wrong password; returns false. */
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") throw new Error("bad CONSOLE_PASSWORD_HASH format");
  const [N, r, p] = parts.slice(1, 4).map(Number);
  // Bound the parameters so a corrupted env value can't become a memory/CPU DoS.
  if (!(N >= 2 ** 14 && N <= 2 ** 20 && (N & (N - 1)) === 0 && r >= 8 && r <= 16 && p >= 1 && p <= 4)) throw new Error("scrypt params out of range");
  const salt = unb64u(parts[4]);
  const expected = unb64u(parts[5]);
  const actual = await scryptAsync(password.normalize("NFC"), salt, expected.length, { N, r, p, maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------------------
// Session cookie: base64url(JSON{sid, iat, exp, auth}) + "." + base64url(HMAC-SHA256(key, payload))
// Separate keys derived from SESSION_SECRET for session and CSRF (key separation).
function keys(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) throw new Error("SESSION_SECRET must be >= 32 bytes");
  return {
    session: createHmac("sha256", secret).update("bd-session-v1").digest(),
    csrf: createHmac("sha256", secret).update("bd-csrf-v1").digest(),
  };
}
const sign = (key, data) => createHmac("sha256", key).update(data).digest();

export const SESSION_TTL_S = 12 * 60 * 60; // 12 h absolute timeout (docs/04 §4)

export function createSession(secret, now = Date.now()) {
  const sid = b64u(randomBytes(18)); // 144 bits from the CSPRNG (OWASP: >= 64 bits of entropy)
  const iat = Math.floor(now / 1000);
  const payload = b64u(JSON.stringify({ sid, iat, exp: iat + SESSION_TTL_S, auth: iat }));
  const token = `${payload}.${b64u(sign(keys(secret).session, payload))}`;
  return { sid, token, csrf: csrfToken(secret, sid) };
}

/** Returns the session claims or null. Checks shape, signature (constant time) and expiry. */
export function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = sign(keys(secret).session, parts[0]);
  const given = unb64u(parts[1]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims;
  try { claims = JSON.parse(unb64u(parts[0]).toString("utf8")); } catch { return null; }
  const t = Math.floor(now / 1000);
  if (typeof claims.exp !== "number" || t >= claims.exp || typeof claims.sid !== "string") return null;
  return claims;
}

/** Step-up for Approve: the last password entry must be within 10 minutes. */
export const recentlyAuthenticated = (claims, now = Date.now(), maxAgeS = 600) =>
  Math.floor(now / 1000) - claims.auth <= maxAgeS;

/** CSRF token = HMAC(csrfKey, sid). Sent by the page in X-BD-CSRF; never read from a cookie. */
export function csrfToken(secret, sid) {
  return b64u(sign(keys(secret).csrf, `sid:${sid}`));
}
export function verifyCsrf(secret, sid, header) {
  if (typeof header !== "string") return false;
  const a = Buffer.from(header), b = Buffer.from(csrfToken(secret, sid));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookie(token) {
  return `bd_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL_S}`;
}
export const clearCookie = () => "bd_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0";
