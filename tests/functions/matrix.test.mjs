// The function auth matrix against the REAL handlers in netlify/functions/ (docs/06 §3.1-§3.2, docs/04 §12).
// Cells live in tests/helpers/matrix.mjs. A route whose handler file does not exist yet is PENDING: its cells are skipped
// (visible in the summary) and the "no pending handlers" test fails the moment you run with MATRIX_STRICT=1 (the W3 gate does).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { API_ROUTES } from "../harness/routes.mjs";
import { CELLS, applies, runCell, runHangCase, pendingRoutes, startMatrixHarness, setup, mutantGuards, MUTANT_CAUGHT_BY } from "../helpers/matrix.mjs";

let h;
beforeAll(async () => { h = await startMatrixHarness(); });
beforeEach(() => { h.clearDepsAdapters(); });
afterAll(async () => { h?.clearDepsAdapters?.(); await h?.close(); });

describe("registry: the route table, the harness and the handler files agree", () => {
  it("the routes in docs/04 §2 equal the harness route table (a new route cannot ship untested)", () => {
    const doc = readFileSync(new URL("../../docs/04-agent-console.md", import.meta.url), "utf8");
    const sec = doc.slice(doc.indexOf("## 2. Endpoints"), doc.indexOf("### 2.1 Shared contracts"));
    const fromDoc = [...sec.matchAll(/^\| `((?:GET|POST) \/api\/[^`]+)` \|/gm)].map((m) => m[1]);
    expect(fromDoc.length).toBe(8);
    expect(API_ROUTES.map((r) => r.key)).toEqual(fromDoc);
  });
  it("every file in netlify/functions/*.mts is a registered route (no untested function)", () => {
    const files = readdirSync(new URL("../../netlify/functions/", import.meta.url)).filter((f) => f.endsWith(".mts")).map((f) => f.slice(0, -4));
    const known = new Set(API_ROUTES.map((r) => r.module));
    expect(files.filter((f) => !known.has(f))).toEqual([]);
  });
  it("PENDING handlers (no matrix cell can run for them yet)", () => {
    const pending = pendingRoutes(h);
    if (pending.length) console.warn(`[matrix] PENDING, handler file missing: ${pending.join(", ")}`);
    if (process.env.MATRIX_STRICT) expect(pending).toEqual([]);
    else expect(pending.every((k) => API_ROUTES.some((r) => r.key === k))).toBe(true);
  });
});

for (const route of API_ROUTES) {
  describe(`${route.key}`, () => {
    for (const cell of CELLS) {
      if (!applies(cell, route)) continue;
      it(`[${cell.group}] ${cell.id}`, async (ctx) => {
        if (!h.hasHandler(route.key)) return ctx.skip(`PENDING: netlify/functions/${route.module}.mts does not exist yet`);
        expect(await runCell(h, cell, route)).toEqual([]);
      });
    }
  });
}

describe("hang: Supabase never answers (5 s abort), every route answers 503", () => {
  it("all existing handlers answer 503 with no downstream call", async (ctx) => {
    const have = API_ROUTES.filter((r) => h.hasHandler(r.key));
    if (!have.length) return ctx.skip("PENDING: no handler file exists yet");
    expect(await runHangCase(h, have)).toEqual([]);
  }, 20_000);
});

describe("jobs-run: rejected callers leave no job record (the nonce cases live with Remy-A's handler tests)", () => {
  it("a forged forwarded token on /api/jobs-run reads and writes nothing", async (ctx) => {
    if (!h.hasHandler("POST /api/jobs-run")) return ctx.skip("PENDING: job-run.mts does not exist yet");
    await setup(h);
    const route = API_ROUTES.find((r) => r.key === "POST /api/jobs-run");
    const req = new Request(`${h.url}${route.pattern}`, { method: "POST", headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json", origin: h.url }, body: JSON.stringify({ jobId: "j_01ARZ3NDEKTSV4RRFFQ69G5FAV", nonce: "x".repeat(32) }) });
    const res = await h.callHandler(route.key, req);
    await res.text();
    expect([401, 202]).toContain(res.status);
    expect(h.blobs.callCount).toBe(0);
    expect(h.anthropic.requests.length).toBe(0);
  });
});

describe("mutants against the REAL handlers: a guard that is wrong must make the matrix fail (docs/06 §3.1)", () => {
  for (const [name, make] of Object.entries(mutantGuards())) {
    it(`guard ${name} is caught on /api/agents and /api/proposals/:id/reject`, async (ctx) => {
      const routes = API_ROUTES.filter((r) => ["GET /api/agents", "POST /api/proposals/:id/reject"].includes(r.key));
      if (routes.some((r) => !h.hasHandler(r.key))) return ctx.skip("PENDING: handler file missing");
      for (const r of routes) h.registerDeps(r.module, (bag) => ({ ...bag, guard: make() }));
      try {
        const caught = [];
        for (const r of routes) for (const c of CELLS) if (applies(c, r) && c.group !== "control" && (await runCell(h, c, r)).length) caught.push(c.group);
        expect(caught.length, `no cell caught the mutant "${name}"`).toBeGreaterThan(0);
        expect(MUTANT_CAUGHT_BY[name].some((g) => caught.includes(g)), `"${name}" caught only by ${[...new Set(caught)]}`).toBe(true);
      } finally { h.clearDepsAdapters(); }
    }, 60_000);
  }
});
