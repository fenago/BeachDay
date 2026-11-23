import { describe, it, expect } from "vitest";
import { SETTINGS } from "../../netlify/functions/lib/settings.mts";
import { json, error, sseHeaders, SECURITY_HEADERS, ERROR_CODES } from "../../netlify/functions/lib/http.mts";

describe("SETTINGS pins every decision (change deliberately)", () => {
  it("has exactly these values", () => {
    expect(SETTINGS).toEqual({
      computeBudgetMinutes: 180,
      computeNeedChatMs: 60_000,
      computeNeedJobMs: 300_000,
      githubReadTokenEnv: "GITHUB_TOKEN",
      serverRefusalFallback: false,
      denyConsoleUi: false,
      approveCap: { per31Days: 14, perDay: 5, timeZone: "America/New_York" },
      approveEnabled: false,
      jwtHeaderPrecheck: false,
      perUserDaily: { chat: 200, jobs: 20 },
      perTurn: { maxToolRounds: 15, maxToolCallsPerRound: 10, maxTokens: 1_000_000, maxUserMessageBytes: 32_768 },
      chatDeadlineMs: 55_000,
      chatSdkTimeoutMs: 50_000,
      jobWallClockMs: 840_000,
      stepUpWindowS: 600,
      allowedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    });
  });
  it("is deeply frozen", () => {
    expect(Object.isFrozen(SETTINGS)).toBe(true);
    for (const k of ["approveCap", "perUserDaily", "perTurn", "allowedModels"]) expect(Object.isFrozen(SETTINGS[k])).toBe(true);
  });
  it("keeps timing under the platform limits", () => {
    expect(SETTINGS.chatSdkTimeoutMs).toBeLessThan(SETTINGS.chatDeadlineMs);
    expect(SETTINGS.chatDeadlineMs).toBeLessThan(60_000);
    expect(SETTINGS.jobWallClockMs).toBeLessThan(15 * 60_000);
  });
  it("approve cap x 15 credits stays at 70% of 300", () => {
    expect(SETTINGS.approveCap.per31Days * 15).toBe(210);
  });
});

describe("http.mts", () => {
  const forbidden = (res) => {
    for (const [k] of res.headers) {
      expect(k.startsWith("access-control-")).toBe(false);
      expect(k).not.toBe("set-cookie");
    }
  };
  it("json sets the security headers and content type", async () => {
    const res = json(200, { ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
    forbidden(res);
  });
  it("a caller cannot override the content type or drop the security headers by accident", () => {
    const res = json(200, {}, { "content-type": "text/html" });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("401 carries www-authenticate: Bearer; others do not", async () => {
    const r401 = error(401, "unauthorized", "Sign in again.");
    expect(r401.headers.get("www-authenticate")).toBe("Bearer");
    expect(r401.headers.get("cache-control")).toBe("no-store");
    for (const s of [403, 429, 503]) expect(error(s, "forbidden", "x").headers.get("www-authenticate")).toBeNull();
    forbidden(r401);
  });
  it("error body shape: code, message, retryAt, extra", async () => {
    const res = error(429, "approve_cap", "Cap reached.", { retryAt: "2026-12-01T00:00:00.000Z", extra: { approvals: { used: 14 } } });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { approvals: { used: 14 }, code: "approve_cap", message: "Cap reached.", retryAt: "2026-12-01T00:00:00.000Z" },
    });
  });
  it("extra cannot overwrite code or message; message is capped at 500 chars", async () => {
    const res = error(500, "internal", "y".repeat(900), { extra: { code: "evil", message: "evil" } });
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(body.error.message).toHaveLength(500);
  });
  it("sseHeaders", () => {
    expect(sseHeaders()).toEqual({
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });
  it("SECURITY_HEADERS is frozen and holds exactly three headers", () => {
    expect(Object.isFrozen(SECURITY_HEADERS)).toBe(true);
    expect(Object.keys(SECURITY_HEADERS).sort()).toEqual(["cache-control", "content-security-policy", "x-content-type-options"]);
  });
  it("ERROR_CODES is the docs/04 §2.1 table", () => {
    expect(ERROR_CODES).toEqual({
      invalid_request: 400, unauthorized: 401, step_up_required: 401, forbidden: 403, not_found: 404,
      conflict: 409, stale: 409, rate_limited: 429, budget_exhausted: 429, approve_cap: 429,
      refusal: null, upstream: 502, timeout: 504, unavailable: 503, internal: 500,
    });
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
  });
});
