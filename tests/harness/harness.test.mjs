// Self-test of the harness plumbing using throw-away handlers from tests/fixtures/site/functions (not product code).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { startHarness, REPO_ROOT } from "./server.mjs";
import { parseHeadersFile, headersFor } from "./headers.mjs";
import { matchRoute, API_ROUTES } from "./routes.mjs";
import { parseSse } from "../helpers/sse.mjs";

let h;
beforeAll(async () => { h = await startHarness({ functionsDir: join(REPO_ROOT, "tests/fixtures/site/functions") }); });
afterAll(async () => { await h.close(); });

describe("routing", () => {
  it("matches every docs/04 §2 route and nothing else", () => {
    expect(API_ROUTES.map((r) => r.key)).toEqual(["GET /api/agents", "POST /api/chat", "POST /api/jobs", "POST /api/jobs-run", "GET /api/jobs/:id", "GET /api/proposals/:id", "POST /api/proposals/:id/approve", "POST /api/proposals/:id/reject"]);
    expect(matchRoute("/api/proposals/p_X/approve").route.module).toBe("approve");
    expect(matchRoute("/api/proposals/p_X").params).toEqual({ id: "p_X" });
    expect(matchRoute("/api/jobs-run").route.module).toBe("job-run");
    expect(matchRoute("/api/jobs/j_X").route.module).toBe("job-status");
    expect(matchRoute("/api/proposals/p_X/approve/extra")).toBeNull();
    expect(matchRoute("/api/login")).toBeNull();
  });
  it("_headers parser: path rules, splat, later rule overrides, project-ref substitution", () => {
    const rules = parseHeadersFile("# c\n/*\n  A: 1\n  CSP: x <project-ref>.supabase.co\n/sw.js\n  A: 2\n/js/*\n  B: 3\n");
    expect([...headersFor(rules, "/sw.js", { substitutions: { "<project-ref>.supabase.co": "h.test" } })]).toEqual([["a", "2"], ["csp", "x h.test"]]);
    expect(headersFor(rules, "/js/app.js").get("b")).toBe("3");
    expect(headersFor(rules, "/x").has("b")).toBe(false);
  });
});

describe("real handler plumbing", () => {
  it("gives the handler a Request, a production context with params and requestId, DI deps, and passes Origin and Sec-Fetch-Site through", async () => {
    const res = await fetch(`${h.url}/api/agents`, { headers: { origin: h.url, "sec-fetch-site": "same-origin" } });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ method: "GET", url: `${h.url}/api/agents`, context: "production", origin: h.url, secFetchSite: "same-origin", hasEnvKey: true, approveEnabled: true, supabaseUrl: "https://bdlocaltest.supabase.co" });
    expect(j.requestId).toMatch(/^[0-9a-f]{16}$/);
    expect(j.stores).toEqual(["audit", "jobs", "proposals", "ratelimit"]);
    expect(j.startJobIsFn).toBe(true);
    expect(h.blobs.peek("probe", "seen")).toEqual({ n: 1 });
  });
  it("context.params carries :id", async () => {
    expect(await (await fetch(`${h.url}/api/proposals/p_01ARZ3NDEKTSV4RRFFQ69G5FAV`)).json()).toEqual({ id: "p_01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  });
  it("a missing module answers 501 not_implemented (JSON, no-store), never a hang", async () => {
    const r = await fetch(`${h.url}/api/jobs/j_01ARZ3NDEKTSV4RRFFQ69G5FAV`);
    expect(r.status).toBe(501);
    expect((await r.json()).error.code).toBe("not_implemented");
  });
  it("a handler that throws becomes a 500 internal that does not echo the error text", async () => {
    const r = await fetch(`${h.url}/api/chat`, { method: "POST", body: JSON.stringify({ throw: true }) });
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(text).toContain("internal");
    expect(text).not.toContain("secret-looking");
  });
  it("SSE arrives progressively (first event before the stream ends)", async () => {
    const res = await fetch(`${h.url}/api/chat`, { method: "POST", body: JSON.stringify({}) });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body.getReader(); const dec = new TextDecoder();
    const t0 = Date.now();
    const first = dec.decode((await reader.read()).value);
    const tFirst = Date.now() - t0;
    let rest = ""; for (;;) { const { done, value } = await reader.read(); if (done) break; rest += dec.decode(value); }
    expect(parseSse(first)[0]).toMatchObject({ event: "text", data: { delta: "one" } });
    expect(parseSse(rest)[0].event).toBe("done");
    expect(tFirst).toBeLessThan(120);
  });
  it("background function (job-run) answers 202 at once and finishes later; settled waits for it", async () => {
    const t0 = Date.now();
    const r = await fetch(`${h.url}/api/jobs-run`, { method: "POST", body: "{}" });
    expect(r.status).toBe(202);
    expect(Date.now() - t0).toBeLessThan(90);
    expect(h.blobs.peek("probe", "job-ran")).toBeNull();
    await h.state.background.size; await Promise.allSettled([...h.state.background]);
    expect(h.blobs.peek("probe", "job-ran")).toEqual({ ok: true });
  });
  it("deploy context and settings are switchable per test and take effect on the next request", async () => {
    await fetch(`${h.url}/__harness/ctl`, { method: "POST", body: JSON.stringify({ op: "harness.setDeployContext", args: { value: "deploy-preview" } }) });
    expect((await (await fetch(`${h.url}/api/agents`)).json()).context).toBe("deploy-preview");
    await fetch(`${h.url}/__harness/ctl`, { method: "POST", body: JSON.stringify({ op: "harness.reset" }) });
    expect((await (await fetch(`${h.url}/api/agents`)).json()).context).toBe("production");
  });
  it("the control channel never reveals env secrets (harness.env is masked) and rejects unknown ops", async () => {
    expect(JSON.stringify(h.env)).not.toMatch(/sk-ant|github_pat/);
    const r = await fetch(`${h.url}/__harness/ctl`, { method: "POST", body: JSON.stringify({ op: "env.dump" }) });
    expect(r.status).toBe(400);
  });
});

describe("static", () => {
  it("rejects path traversal and serves nothing outside public/ and the fixtures", async () => {
    for (const p of ["/..%2f..%2fpackage.json", "/%2e%2e/package.json", "/generated/..%2f..%2f..%2fpackage.json"]) {
      const r = await fetch(`${h.url}${p}`);
      expect([400, 404]).toContain(r.status);
      expect(await r.text()).not.toContain('"name"');
    }
  });
  it("a directory without a trailing slash redirects (Netlify behaviour)", async () => {
    const r = await fetch(`${h.url}/icons`, { redirect: "manual" });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/icons/");
  });
});
