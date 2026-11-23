// Shape of the security checks that sit AFTER the token-and-role guard
// (knowledge/supabase-auth-engineer/examples/01-token-and-role-check) in Beach Day functions.
//   checkOrigin(req, siteOrigin)          - defence in depth on POST routes (CSRF is mostly gone with Bearer tokens)
//   checkStepUp({claims, user, now})      - the Approve step-up rule (docs/04 §4.2)
//   approveStepUp(token, claims, getUser) - wires getUser(token) in and maps failures to 401 / 503
// Node built-ins only. No secrets. Claims and user objects are plain data, as returned by
// supabase.auth.getClaims(token) and supabase.auth.getUser(token).

export const STEP_UP_WINDOW_S = 600;  // 10 minutes since the last primary sign-in
export const CLOCK_SKEW_S = 60;       // tolerate a timestamp up to 60 s in the future
// Only a real sign-in proves someone just typed a password or passed the provider's login.
// token_refresh, recovery, otp, magiclink, email/signup, invite... do not count.
// totp is deliberately NOT a primary method: a token thief could enrol their own factor.
export const PRIMARY_METHODS = new Set(["password", "oauth"]);

const SAFE = new Set(["GET", "HEAD"]);

/** Reject cross-site state-changing requests. Absent headers are allowed: Bearer tokens are not ambient. */
export function checkOrigin(req, siteOrigin) {
  if (SAFE.has(req.method)) return { ok: true };
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs !== null && sfs !== "same-origin") return { ok: false, status: 403, reason: "cross_site" };
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== siteOrigin) return { ok: false, status: 403, reason: "bad_origin" };
  return { ok: true };
}

function latestPrimary(amr) {
  if (!Array.isArray(amr)) return null;
  let best = null;
  for (const e of amr) {
    if (!e || !PRIMARY_METHODS.has(e.method) || !Number.isInteger(e.timestamp)) continue;
    if (best === null || e.timestamp > best) best = e.timestamp;   // never rely on array order
  }
  return best;
}

const fresh = (t, now, win = STEP_UP_WINDOW_S) => t !== null && now - t <= win && t - now <= CLOCK_SKEW_S;

/**
 * Step-up rule for POST /api/proposals/:id/approve. All must hold:
 *  1. getUser(token) returned this same user, and the user is not banned;
 *  2. the session's newest password/oauth `amr` entry is at most 10 min old;
 *  3. user.last_sign_in_at is at most 10 min old (server-side corroboration);
 *  4. if the user has any verified MFA factor, the token is aal2.
 * now: seconds since the epoch.
 */
export function checkStepUp({ claims, user, now }) {
  const deny = (reason) => ({ ok: false, status: 401, code: "step_up_required", reason });
  if (!claims || !user || typeof claims.sub !== "string" || user.id !== claims.sub) return deny("user_mismatch");
  if (user.banned_until && Date.parse(user.banned_until) / 1000 > now) return deny("banned");
  if (!fresh(latestPrimary(claims.amr), now)) return deny("primary_sign_in_too_old");
  const last = user.last_sign_in_at ? Math.floor(Date.parse(user.last_sign_in_at) / 1000) : null;
  if (!fresh(Number.isFinite(last) ? last : null, now)) return deny("last_sign_in_too_old");
  const hasFactor = Array.isArray(user.factors) && user.factors.some((f) => f?.status === "verified");
  if (hasFactor && claims.aal !== "aal2") return deny("aal2_required");
  return { ok: true };
}

/** getUser is injected: (token) => Promise<{data:{user}, error}>. A throw means the network failed. */
export async function approveStepUp(token, claims, getUser, now = Math.floor(Date.now() / 1000)) {
  let res;
  try {
    res = await getUser(token);
  } catch {
    return { ok: false, status: 503, code: "unavailable" };          // fail closed, never echo
  }
  if (res?.error || !res?.data?.user) return { ok: false, status: 401, code: "unauthorized" };
  return checkStepUp({ claims, user: res.data.user, now });
}
