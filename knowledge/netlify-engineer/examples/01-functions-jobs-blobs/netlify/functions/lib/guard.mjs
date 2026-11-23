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
