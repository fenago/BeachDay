// SHAPE ONLY: the production verifier is supabase-auth-engineer example 01
// (knowledge/supabase-auth-engineer/examples/01). This file shows order and status codes.
// The auth check that is the FIRST line of every /api/* handler.
//   Authorization: Bearer <access token>  ->  verifier(token)  ->  { sub, role }
//   no/garbled header, or verifier says invalid  -> 401  (www-authenticate: Bearer)
//   valid token but role is not "super_admin"    -> 403
//   verifier not configured, or it fails for any other reason -> 503 (fail closed)
// The verifier is a stand-in. HOW a Supabase token is verified (getClaims vs
// getUser) and where the role comes from is decided by supabase-auth-engineer
// and reviewed by security-engineer; this example only shows the shape, the
// status codes and the order: check first, work second.
import { json } from "./http.mjs";

let verifier = null;
export const setVerifier = (fn) => { verifier = fn; };
export class InvalidToken extends Error {}

// NOTE: this guard's verifier contract is THROW-BASED: resolve with { sub, role },
// throw InvalidToken for a bad token (401), throw anything else for 503.
// Supabase auth-js does NOT throw on a network or 5xx failure: it RETURNS
// { data, error } with error.name === "AuthRetryableFetchError" (real code: auth-js isAuthRetryableFetchError(error); the test below copies it:
// __isAuthError === true plus the name, like looksRetryable in security-engineer example 01). A real verifier must go through an adapter like
// this one, or an outage would look like an invalid token (401 instead of 503).
// `getClaims` here is any function returning { data: { claims } | null, error }.
export function adaptClaimsVerifier(getClaims, roleOf) {
  return async (token) => {
    const res = await getClaims(token);
    if (res?.error) {
      if (res.error.__isAuthError === true && res.error.name === "AuthRetryableFetchError") throw new Error("auth upstream unavailable"); // -> 503
      throw new InvalidToken(); // any other returned auth error: the token is not valid -> 401
    }
    const claims = res?.data?.claims;
    if (!claims?.sub) throw new InvalidToken();
    return { sub: claims.sub, role: await roleOf(claims) };
  };
}

export async function guard(req) {
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{10,4096})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return { response: json(401, { error: "unauthenticated" }, { "www-authenticate": "Bearer" }) };
  if (!verifier) return { response: json(503, { error: "auth_unavailable" }) };
  let who;
  try {
    who = await verifier(m[1]);
  } catch (err) {
    if (err instanceof InvalidToken) return { response: json(401, { error: "unauthenticated" }, { "www-authenticate": "Bearer" }) };
    return { response: json(503, { error: "auth_unavailable" }) }; // never echo err
  }
  if (who?.role !== "super_admin") return { response: json(403, { error: "forbidden" }) };
  return { user: { id: who.sub } };
}
