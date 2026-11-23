// Step-up before Approve (docs/04 §4.2). Runs AFTER the guard (guard.mts), only in
// POST /api/proposals/:id/approve. All must hold, else 401 step_up_required and the proposal stays pending:
//   1. getUser(token) returns the same id as sub, and the user is not banned;
//   2. the token's newest password/oauth amr entry is <= 600 s old (and <= 60 s in the future): binds THIS session;
//   3. user.last_sign_in_at is <= 600 s old (per user, so only a cross-check of rule 2);
//   4. any verified MFA factor => aal2.
// getUser: 401 unauthorized only when the token was rejected (tokenRejected, guard.mts); any other returned
// error (retryable, 429, other 5xx, AuthUnknownError, look-alikes) or any throw => 503 unavailable.
// Reference: knowledge/security-engineer/examples/01-bearer-step-up-and-origin/stepup.mjs.
import { SETTINGS } from "./settings.mts";
import { tokenRejected } from "./guard.mts";

export const CLOCK_SKEW_S = 60;
// totp is deliberately NOT primary: a token thief could enrol their own factor. token_refresh, recovery, otp,
// magiclink, email/signup and invite don't prove a fresh sign-in either.
export const PRIMARY_METHODS: ReadonlySet<string> = new Set(["password", "oauth"]);

export type StepUpResult =
  | { ok: true }
  | { ok: false; status: 401; code: "step_up_required"; reason: string }
  | { ok: false; status: 401; code: "unauthorized" }
  | { ok: false; status: 503; code: "unavailable" };

type Claims = Record<string, unknown>;
type User = Record<string, unknown>;
export type GetUser = (token: string) => Promise<{ data?: { user?: User | null } | null; error?: unknown } | undefined | null>;

function latestPrimary(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let best: number | null = null;
  for (const e of amr) {
    if (!e || typeof e !== "object") continue;
    const { method, timestamp } = e as { method?: unknown; timestamp?: unknown };
    if (typeof method !== "string" || !PRIMARY_METHODS.has(method) || !Number.isInteger(timestamp)) continue;
    if (best === null || (timestamp as number) > best) best = timestamp as number; // never trust array order
  }
  return best;
}

function fresh(t: number | null, now: number, windowS: number): boolean {
  return t !== null && now - t <= windowS && t - now <= CLOCK_SKEW_S;
}

export function checkStepUp({ claims, user, now, windowS = SETTINGS.stepUpWindowS }:
  { claims: Claims | null | undefined; user: User | null | undefined; now: number; windowS?: number }): StepUpResult {
  const deny = (reason: string): StepUpResult => ({ ok: false, status: 401, code: "step_up_required", reason });
  if (!claims || !user || typeof claims.sub !== "string" || user.id !== claims.sub) return deny("user_mismatch");
  if (typeof user.banned_until === "string" && Date.parse(user.banned_until) / 1000 > now) return deny("banned");
  if (!fresh(latestPrimary(claims.amr), now, windowS)) return deny("primary_sign_in_too_old");
  const lastMs = typeof user.last_sign_in_at === "string" ? Date.parse(user.last_sign_in_at) : NaN;
  if (!fresh(Number.isFinite(lastMs) ? Math.floor(lastMs / 1000) : null, now, windowS)) return deny("last_sign_in_too_old");
  const hasFactor = Array.isArray(user.factors) && user.factors.some((f) => (f as { status?: unknown } | null)?.status === "verified");
  if (hasFactor && claims.aal !== "aal2") return deny("aal2_required");
  return { ok: true };
}

// getUser is the guard's (guard.getUser), so it shares the client, the publishable key and the 5 s timeout.
// now: seconds since the epoch (the approve handler passes Math.floor(deps.now() / 1000)).
export async function approveStepUp(token: string, claims: Claims, getUser: GetUser,
  now: number = Math.floor(Date.now() / 1000)): Promise<StepUpResult> {
  let res: Awaited<ReturnType<GetUser>>;
  try {
    res = await getUser(token);
  } catch {
    return { ok: false, status: 503, code: "unavailable" };
  }
  if (res?.error) {
    return tokenRejected(res.error)
      ? { ok: false, status: 401, code: "unauthorized" }
      : { ok: false, status: 503, code: "unavailable" };
  }
  if (!res?.data?.user) return { ok: false, status: 401, code: "unauthorized" };
  return checkStepUp({ claims, user: res.data.user, now });
}
