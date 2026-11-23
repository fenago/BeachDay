// node --test stepup.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { checkOrigin, checkStepUp, approveStepUp } from "./stepup.mjs";

const NOW = 1_800_000_000;                       // fixed clock (seconds)
const iso = (s) => new Date(s * 1000).toISOString();
const SUB = "11111111-2222-3333-4444-555555555555";

const claims = (amr, extra = {}) => ({ sub: SUB, aal: "aal1", amr, ...extra });
const user = (extra = {}) => ({ id: SUB, last_sign_in_at: iso(NOW - 120), factors: [], ...extra });

test("step-up table", () => {
  const rows = [
    ["fresh password sign-in (2 min)", claims([{ method: "password", timestamp: NOW - 120 }]), user(), true],
    ["fresh Google sign-in (9 min 59 s)", claims([{ method: "oauth", timestamp: NOW - 599 }]), user({ last_sign_in_at: iso(NOW - 599) }), true],
    ["exactly 10 min", claims([{ method: "password", timestamp: NOW - 600 }]), user({ last_sign_in_at: iso(NOW - 600) }), true],
    ["10 min 1 s: too old", claims([{ method: "password", timestamp: NOW - 601 }]), user(), false],
    ["only token_refresh is fresh", claims([{ method: "token_refresh", timestamp: NOW - 5 }, { method: "password", timestamp: NOW - 7200 }]), user(), false],
    ["recovery link is not a step-up", claims([{ method: "recovery", timestamp: NOW - 5 }]), user(), false],
    ["otp / magic link is not a step-up", claims([{ method: "otp", timestamp: NOW - 5 }]), user(), false],
    ["array order is not trusted (fresh entry last)", claims([{ method: "password", timestamp: NOW - 7200 }, { method: "password", timestamp: NOW - 60 }]), user(), true],
    ["timestamp 2 min in the future", claims([{ method: "password", timestamp: NOW + 120 }]), user(), false],
    ["timestamp 30 s in the future (skew ok)", claims([{ method: "password", timestamp: NOW + 30 }]), user(), true],
    ["amr missing", claims(undefined), user(), false],
    ["amr malformed", claims("password"), user(), false],
    ["timestamp as string", claims([{ method: "password", timestamp: String(NOW) }]), user(), false],
    ["fresh amr but last_sign_in_at stale", claims([{ method: "password", timestamp: NOW - 60 }]), user({ last_sign_in_at: iso(NOW - 3600) }), false],
    ["last_sign_in_at missing", claims([{ method: "password", timestamp: NOW - 60 }]), user({ last_sign_in_at: null }), false],
    ["verified TOTP factor, token aal1", claims([{ method: "password", timestamp: NOW - 60 }]), user({ factors: [{ status: "verified" }] }), false],
    ["verified TOTP factor, token aal2", claims([{ method: "totp", timestamp: NOW - 30 }, { method: "password", timestamp: NOW - 60 }], { aal: "aal2" }), user({ factors: [{ status: "verified" }] }), true],
    ["unverified factor only, aal1 ok", claims([{ method: "password", timestamp: NOW - 60 }]), user({ factors: [{ status: "unverified" }] }), true],
    ["token thief enrols own TOTP: fresh totp + aal2 but old sign-in", claims([{ method: "totp", timestamp: NOW - 10 }, { method: "password", timestamp: NOW - 86400 }], { aal: "aal2" }), user({ factors: [{ status: "verified" }], last_sign_in_at: iso(NOW - 86400) }), false],
    ["getUser returned another user", claims([{ method: "password", timestamp: NOW - 60 }]), user({ id: "someone-else" }), false],
    ["banned user", claims([{ method: "password", timestamp: NOW - 60 }]), user({ banned_until: iso(NOW + 3600) }), false],
  ];
  for (const [why, c, u, want] of rows) {
    const got = checkStepUp({ claims: c, user: u, now: NOW });
    console.log(`${got.ok === want ? "PASS" : "FAIL"}  ${String(got.ok).padEnd(5)} ${why}${got.ok ? "" : ` -> ${got.reason}`}`);
    assert.equal(got.ok, want, why);
    if (!got.ok) { assert.equal(got.status, 401); assert.equal(got.code, "step_up_required"); }
  }
});

test("approveStepUp: getUser failures fail closed", async () => {
  const c = claims([{ method: "password", timestamp: NOW - 60 }]);
  const down = await approveStepUp("t", c, async () => { throw new TypeError("fetch failed"); }, NOW);
  assert.deepEqual([down.status, down.code], [503, "unavailable"]);
  const revoked = await approveStepUp("t", c, async () => ({ data: { user: null }, error: { status: 401 } }), NOW);
  assert.deepEqual([revoked.status, revoked.code], [401, "unauthorized"]);
  const ok = await approveStepUp("t", c, async () => ({ data: { user: user() }, error: null }), NOW);
  assert.equal(ok.ok, true);
});

test("Origin / Sec-Fetch-Site defence in depth", () => {
  const SITE = "https://beachday.example";
  const req = (method, h) => new Request(`${SITE}/api/proposals/p_X/approve`, { method, headers: h });
  const rows = [
    ["same-origin fetch", req("POST", { origin: SITE, "sec-fetch-site": "same-origin" }), true],
    ["cross-site POST", req("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), false],
    ["same-site sibling subdomain", req("POST", { origin: "https://x.beachday.example", "sec-fetch-site": "same-site" }), false],
    ["foreign Origin, no Fetch Metadata", req("POST", { origin: "https://evil.example" }), false],
    ["Origin null (sandboxed iframe)", req("POST", { origin: "null" }), false],
    ["no Origin, no Fetch Metadata (server-to-server, jobs -> jobs-run)", req("POST", {}), true],
    ["GET is not checked", req("GET", { "sec-fetch-site": "cross-site" }), true],
  ];
  for (const [why, r, want] of rows) {
    const got = checkOrigin(r, SITE);
    console.log(`${got.ok === want ? "PASS" : "FAIL"}  ${String(got.ok).padEnd(5)} ${why}${got.ok ? "" : ` -> ${got.reason}`}`);
    assert.equal(got.ok, want, why);
  }
});
