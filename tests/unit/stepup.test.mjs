// netlify/functions/lib/stepup.mts: the Approve step-up (docs/04 §4.2 rules 1-4, §12).
// Rows ported from knowledge/security-engineer/examples/01-bearer-step-up-and-origin/, with auth-js's own
// isAuthRetryableFetchError and real AuthRetryableFetchError / AuthApiError objects.
import { describe, it, expect } from "vitest";
import { AuthRetryableFetchError, AuthApiError, AuthUnknownError } from "@supabase/auth-js";
import { checkStepUp, approveStepUp, PRIMARY_METHODS } from "../../netlify/functions/lib/stepup.mts";
import { SETTINGS } from "../../netlify/functions/lib/settings.mts";

const NOW = 1_800_000_000;
const SUB = "5b0c7a52-0000-4000-8000-000000000001";
const iso = (s) => new Date(s * 1000).toISOString();
const claims = (over = {}) => ({ sub: SUB, aal: "aal1", amr: [{ method: "password", timestamp: NOW - 120 }], ...over });
const user = (over = {}) => ({ id: SUB, last_sign_in_at: iso(NOW - 120), factors: [], ...over });
const run = (c, u) => checkStepUp({ claims: c, user: u, now: NOW });

describe("checkStepUp: the no paths (401 step_up_required)", () => {
  const rows = [
    ["primary sign-in 601 s old", claims({ amr: [{ method: "password", timestamp: NOW - 601 }] }), user(), "primary_sign_in_too_old"],
    ["only token_refresh is fresh", claims({ amr: [{ method: "token_refresh", timestamp: NOW - 5 }, { method: "password", timestamp: NOW - 4000 }] }), user(), "primary_sign_in_too_old"],
    ["fresh totp with a stale sign-in (token thief enrols own factor)", claims({ aal: "aal2", amr: [{ method: "totp", timestamp: NOW - 5 }, { method: "password", timestamp: NOW - 4000 }] }), user(), "primary_sign_in_too_old"],
    ["recovery / otp / magiclink do not count", claims({ amr: [{ method: "recovery", timestamp: NOW }, { method: "otp", timestamp: NOW }, { method: "magiclink", timestamp: NOW }] }), user(), "primary_sign_in_too_old"],
    ["amr missing", claims({ amr: undefined }), user(), "primary_sign_in_too_old"],
    ["amr not an array", claims({ amr: { method: "password", timestamp: NOW } }), user(), "primary_sign_in_too_old"],
    ["timestamp as a string", claims({ amr: [{ method: "password", timestamp: String(NOW) }] }), user(), "primary_sign_in_too_old"],
    ["timestamp more than 60 s in the future", claims({ amr: [{ method: "password", timestamp: NOW + 61 }] }), user(), "primary_sign_in_too_old"],
    ["last_sign_in_at 601 s old", claims(), user({ last_sign_in_at: iso(NOW - 601) }), "last_sign_in_too_old"],
    ["last_sign_in_at missing", claims(), user({ last_sign_in_at: null }), "last_sign_in_too_old"],
    ["last_sign_in_at not a date", claims(), user({ last_sign_in_at: "yesterday" }), "last_sign_in_too_old"],
    ["verified factor with aal1", claims(), user({ factors: [{ status: "verified", factor_type: "totp" }] }), "aal2_required"],
    ["getUser returned a different user", claims(), user({ id: "someone-else" }), "user_mismatch"],
    ["banned user", claims(), user({ banned_until: iso(NOW + 3600) }), "banned"],
    ["no user", claims(), null, "user_mismatch"],
  ];
  for (const [why, c, u, reason] of rows) {
    it(why, () => expect(run(c, u)).toEqual({ ok: false, status: 401, code: "step_up_required", reason }));
  }
});

describe("checkStepUp: the yes paths", () => {
  it("fresh password sign-in (2 min)", () => expect(run(claims(), user())).toEqual({ ok: true }));
  it("fresh oauth (Google) sign-in", () => expect(run(claims({ amr: [{ method: "oauth", timestamp: NOW - 10 }] }), user())).toEqual({ ok: true }));
  it("exactly 600 s old still passes", () =>
    expect(run(claims({ amr: [{ method: "password", timestamp: NOW - 600 }] }), user({ last_sign_in_at: iso(NOW - 600) }))).toEqual({ ok: true }));
  it("array order is not trusted: the newest primary entry wins", () =>
    expect(run(claims({ amr: [{ method: "password", timestamp: NOW - 9000 }, { method: "oauth", timestamp: NOW - 30 }] }), user())).toEqual({ ok: true }));
  it("verified factor with aal2 passes; an unverified factor does not require aal2", () => {
    expect(run(claims({ aal: "aal2" }), user({ factors: [{ status: "verified" }] }))).toEqual({ ok: true });
    expect(run(claims(), user({ factors: [{ status: "unverified" }] }))).toEqual({ ok: true });
  });
  it("an expired ban does not block", () => expect(run(claims(), user({ banned_until: iso(NOW - 10) }))).toEqual({ ok: true }));
  it("the window is SETTINGS.stepUpWindowS (600) and only password and oauth are primary", () => {
    expect(SETTINGS.stepUpWindowS).toBe(600);
    expect([...PRIMARY_METHODS].sort()).toEqual(["oauth", "password"]);
  });
});

describe("approveStepUp: getUser failures fail closed, and are never echoed", () => {
  const ok = async () => ({ data: { user: user() }, error: null });
  const step = (getUser) => approveStepUp("tok.en.x", claims(), getUser, NOW);
  it("a RETURNED AuthRetryableFetchError (network, status 0) -> 503 unavailable", async () => {
    expect(await step(async () => ({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) })))
      .toEqual({ ok: false, status: 503, code: "unavailable" });
  });
  it("a RETURNED AuthRetryableFetchError (502 from /user) -> 503 unavailable", async () => {
    expect((await step(async () => ({ data: { user: null }, error: new AuthRetryableFetchError("Bad Gateway", 502) }))).status).toBe(503);
  });
  it("a throw -> 503 unavailable", async () => {
    expect(await step(async () => { throw new Error("socket hang up secret-ish detail"); })).toEqual({ ok: false, status: 503, code: "unavailable" });
  });
  it("returned 403 session_not_found (signed out) -> 401 unauthorized", async () => {
    expect(await step(async () => ({ data: { user: null }, error: new AuthApiError("Session not found", 403, "session_not_found") })))
      .toEqual({ ok: false, status: 401, code: "unauthorized" });
  });
  it("returned user_banned -> 401 unauthorized", async () => {
    expect((await step(async () => ({ data: { user: null }, error: new AuthApiError("banned", 403, "user_banned") }))).code).toBe("unauthorized");
  });
  it("a look-alike error (name only, no auth-js marker) -> 503, fail closed", async () => {
    expect((await step(async () => ({ data: { user: null }, error: Object.assign(new Error("x"), { name: "AuthRetryableFetchError" }) }))).status).toBe(503);
  });
  it("returned 429 from /user (shared IP rate limit) -> 503, never 'sign in again'", async () => {
    expect(await step(async () => ({ data: { user: null }, error: new AuthApiError("Too many", 429, "over_request_rate_limit") })))
      .toEqual({ ok: false, status: 503, code: "unavailable" });
  });
  it("returned 505 -> 503", async () => {
    expect((await step(async () => ({ data: { user: null }, error: new AuthApiError("x", 505, "unexpected_failure") }))).status).toBe(503);
  });
  it("an HTML 403 (WAF page, AuthUnknownError) -> 503", async () => {
    expect((await step(async () => ({ data: { user: null }, error: new AuthUnknownError("<html>", null) }))).status).toBe(503);
  });
  it("returned expired / bad JWT (401) -> 401 unauthorized", async () => {
    expect((await step(async () => ({ data: { user: null }, error: new AuthApiError("expired", 401, "bad_jwt") }))).code).toBe("unauthorized");
  });
  it("accepts now in seconds, as the approve handler passes Math.floor(deps.now()/1000)", async () => {
    const deps = { now: () => NOW * 1000 };
    expect(await approveStepUp("t", claims(), async () => ({ data: { user: user() }, error: null }), Math.floor(deps.now() / 1000))).toEqual({ ok: true });
  });
  it("no error and no user, or an undefined result -> 401 unauthorized", async () => {
    expect((await step(async () => ({ data: { user: null }, error: null }))).code).toBe("unauthorized");
    expect((await step(async () => undefined)).code).toBe("unauthorized");
  });
  it("getUser succeeds but the sign-in is stale -> 401 step_up_required", async () => {
    const r = await approveStepUp("t", claims({ amr: [{ method: "password", timestamp: NOW - 700 }] }), ok, NOW);
    expect([r.status, r.code]).toEqual([401, "step_up_required"]);
  });
  it("fresh sign-in -> ok, and getUser got the token it was given", async () => {
    let seen;
    expect(await approveStepUp("the.token.here", claims(), async (t) => { seen = t; return ok(); }, NOW)).toEqual({ ok: true });
    expect(seen).toBe("the.token.here");
  });
  it("results never carry the upstream message", async () => {
    const r = await step(async () => ({ data: { user: null }, error: new AuthApiError("Session not found xyz", 403, "session_not_found") }));
    expect(JSON.stringify(r)).not.toContain("xyz");
  });
});
