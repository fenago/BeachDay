// netlify/functions/lib/origin.mts: defence in depth on POST routes (docs/04 §4.4, §12).
import { describe, it, expect } from "vitest";
import { checkOrigin, originDenyResponse } from "../../netlify/functions/lib/origin.mts";

const SITE = "https://beachday.example";
const post = (headers = {}, url = `${SITE}/api/chat`, method = "POST") => new Request(url, { method, headers, body: method === "POST" ? "{}" : undefined });

describe("checkOrigin: the no paths (403 forbidden)", () => {
  const rows = [
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }, "cross_site"],
    ["Sec-Fetch-Site same-site (a sibling subdomain)", { "sec-fetch-site": "same-site" }, "cross_site"],
    ["Sec-Fetch-Site none (typed URL / bookmark)", { "sec-fetch-site": "none" }, "cross_site"],
    ["foreign Origin", { origin: "https://evil.example" }, "bad_origin"],
    ["Origin null (sandboxed frame, data: URL)", { origin: "null" }, "bad_origin"],
    ["Origin on another port", { origin: "https://beachday.example:8443" }, "bad_origin"],
    ["Origin over http", { origin: "http://beachday.example" }, "bad_origin"],
    ["same-origin fetch metadata but a foreign Origin", { "sec-fetch-site": "same-origin", origin: "https://evil.example" }, "bad_origin"],
    ["Origin with a trailing slash (not an origin serialisation)", { origin: "https://beachday.example/" }, "bad_origin"],
  ];
  for (const [why, headers, reason] of rows) {
    it(why, () => expect(checkOrigin(post(headers), SITE)).toEqual({ ok: false, status: 403, code: "forbidden", reason }));
  }
  it("PUT, PATCH and DELETE are checked like POST", () => {
    for (const m of ["PUT", "PATCH", "DELETE"]) {
      expect(checkOrigin(new Request(`${SITE}/api/x`, { method: m, headers: { origin: "https://evil.example" } }), SITE).ok).toBe(false);
    }
  });
  it("with no configured site origin, a foreign Origin is still compared against the request's own origin", () => {
    expect(checkOrigin(post({ origin: "https://evil.example" })).ok).toBe(false);
  });
});

describe("checkOrigin: the yes paths", () => {
  it("same-origin fetch from the Console", () =>
    expect(checkOrigin(post({ "sec-fetch-site": "same-origin", origin: SITE }), SITE)).toEqual({ ok: true }));
  it("both headers absent (server to server: /api/jobs -> /api/jobs-run) passes", () =>
    expect(checkOrigin(post({}), SITE)).toEqual({ ok: true }));
  it("GET and HEAD are not checked", () => {
    expect(checkOrigin(new Request(`${SITE}/api/agents`, { headers: { "sec-fetch-site": "cross-site" } }), SITE)).toEqual({ ok: true });
    expect(checkOrigin(new Request(`${SITE}/api/agents`, { method: "HEAD", headers: { origin: "https://evil.example" } }), SITE)).toEqual({ ok: true });
  });
  it("defaults the site origin to the request's own origin (works on the custom domain and the netlify.app name)", () => {
    expect(checkOrigin(post({ origin: "https://beachday.netlify.app" }, "https://beachday.netlify.app/api/chat")).ok).toBe(true);
  });
  it("never reads the body", () => {
    const r = post({ origin: SITE });
    checkOrigin(r, SITE);
    expect(r.bodyUsed).toBe(false);
  });
});

describe("originDenyResponse", () => {
  it("403 forbidden with no reason in the body and no CORS headers", async () => {
    const res = originDenyResponse({ ok: false, status: 403, code: "forbidden", reason: "bad_origin" });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("forbidden");
    expect(text).not.toContain("bad_origin");
    expect([...res.headers.keys()].some((k) => k.startsWith("access-control-"))).toBe(false);
  });
});
