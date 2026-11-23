// Origin / Sec-Fetch-Site check on state-changing routes (docs/04 §4.4). Defence in depth: Bearer tokens are
// not ambient and we send no Access-Control-Allow-* headers, so classic CSRF is already gone.
//   403 when Sec-Fetch-Site is present and not "same-origin";
//   403 when Origin is present and not the site origin (including "null");
//   both absent (server to server, e.g. /api/jobs -> /api/jobs-run): passes, no browser credential rides along.
// siteOrigin defaults to the request's own origin, so the check holds on the custom domain and on the
// *.netlify.app name alike. A browser cannot forge Host or Origin.
// Reference: knowledge/security-engineer/examples/01-bearer-step-up-and-origin/stepup.mjs (checkOrigin).
import { error } from "./http.mts";

export type OriginResult = { ok: true } | { ok: false; status: 403; code: "bad_origin"; reason: "cross_site" | "bad_origin" };

const SAFE = new Set(["GET", "HEAD"]);

export function checkOrigin(req: Request, siteOrigin?: string): OriginResult {
  if (SAFE.has(req.method)) return { ok: true };
  const expected = siteOrigin ?? new URL(req.url).origin;
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs !== null && sfs !== "same-origin") return { ok: false, status: 403, code: "bad_origin", reason: "cross_site" };
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== expected) return { ok: false, status: 403, code: "bad_origin", reason: "bad_origin" };
  return { ok: true };
}

export function originDenyResponse(r: Extract<OriginResult, { ok: false }>): Response {
  return error(r.status, r.code, "This request must come from the Beach Day site.");
}
