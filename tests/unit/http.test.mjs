import { test, expect } from "vitest";
import { json, error, SECURITY_HEADERS } from "../../netlify/functions/lib/http.mts";

test("json: SECURITY_HEADERS always win over a caller header, whatever its case", () => {
  const r = json(200, { ok: true }, { "Cache-Control": "public", "x-content-type-options": "sniff", "content-security-policy": "default-src *", "x-extra": "1" });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers.get(k), k).toBe(v);
  expect(r.headers.get("x-extra")).toBe("1");
  expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
});

test("json: access-control-* and set-cookie are refused (throws), in any case", () => {
  for (const k of ["access-control-allow-origin", "Access-Control-Allow-Credentials", "set-cookie", "Set-Cookie"]) {
    expect(() => json(200, {}, { [k]: "x" }), k).toThrow(/forbidden response header/);
  }
});

test("error and 401: no-store, nosniff, www-authenticate; no CORS or cookie", () => {
  const r = error(401, "unauthorized", "no");
  expect(r.status).toBe(401);
  expect(r.headers.get("www-authenticate")).toBe("Bearer");
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(r.headers.has("access-control-allow-origin") || r.headers.has("set-cookie")).toBe(false);
});

test("ERROR_CODES includes bad_origin: 403 (Origin check)", async () => {
  const { ERROR_CODES } = await import("../../netlify/functions/lib/http.mts");
  expect(ERROR_CODES.bad_origin).toBe(403);
});
