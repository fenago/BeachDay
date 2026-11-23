// Proves the matrix itself: the same cells, run against STAND-IN handlers that use the real guard/origin/http libs (so the
// cells are checked against real behaviour while Remy's handlers are being written), and against planted-bug mutants that a
// correct matrix must fail (docs/06 §3.1: "a route that skips the guard ... must each make the matrix fail").
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_ROUTES } from "../harness/routes.mjs";
import { CELLS, applies, runCell, runHangCase, mutantGuards, startMatrixHarness, pendingRoutes } from "../helpers/matrix.mjs";

const standin = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures", "site", "standin");
let h;
beforeAll(async () => { h = await startMatrixHarness({ functionsDir: standin }); });
afterAll(async () => { await h.close(); });

async function failures(routes = API_ROUTES) {
  const out = [];
  for (const route of routes) for (const cell of CELLS) { if (!applies(cell, route)) continue; const p = await runCell(h, cell, route); if (p.length) out.push(`${route.key} [${cell.id}]: ${p[0]}`); }
  return out;
}

describe("matrix against stand-in handlers (real guard, real origin check)", () => {
  it("all 8 stand-ins exist", () => { expect(pendingRoutes(h)).toEqual([]); });
  it("every cell passes for every route, except cells carrying a recorded product bug (the bug must still reproduce)", async () => {
    h.clearDepsAdapters();
    const bugs = CELLS.filter((c) => c.knownBug);
    const got = await failures();
    const unexpected = got.filter((g) => !bugs.some((b) => g.includes(`[${b.id}]`)));
    expect(unexpected).toEqual([]);
    // when the owner fixes the bug this fails: delete knownBug from the cell in tests/helpers/matrix.mjs
    for (const b of bugs) expect(got.some((g) => g.includes(`[${b.id}]`)), `knownBug "${b.id}" no longer reproduces: remove the flag`).toBe(true);
  }, 120_000);
  it("hang: 503 on every route within the 5 s guard timeout", async () => { h.clearDepsAdapters(); expect(await runHangCase(h, API_ROUTES)).toEqual([]); }, 20_000);
  it("cell count: 8 routes x the applicable cells", () => {
    const n = API_ROUTES.reduce((a, r) => a + CELLS.filter((c) => applies(c, r)).length, 0);
    expect(n).toBeGreaterThan(8 * 25);
  });
});

describe("planted-bug mutants are caught by at least one cell", () => {
  for (const [name, make] of Object.entries(mutantGuards())) {
    it(`mutant: guard ${name}`, async () => {
      for (const r of API_ROUTES) h.registerDeps(r.module, (bag) => ({ ...bag, guard: make() }));
      try {
        const f = await failures([API_ROUTES[0], API_ROUTES[7]]); // one GET and one POST route are enough to prove sensitivity
        expect(f.length, `no cell caught "${name}"`).toBeGreaterThan(0);
      } finally { h.clearDepsAdapters(); }
    }, 120_000);
  }
});
