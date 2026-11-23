// Proves the matrix itself: the same cells, run against STAND-IN handlers that use the real guard/origin/http libs (so the
// cells are checked against real behaviour while Remy's handlers are being written), and against planted-bug mutants that a
// correct matrix must fail (docs/06 §3.1: "a route that skips the guard ... must each make the matrix fail").
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_ROUTES } from "../harness/routes.mjs";
import { CELLS, applies, runCell, runHangCase, mutantGuards, MUTANT_CAUGHT_BY, startMatrixHarness, pendingRoutes } from "../helpers/matrix.mjs";

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
  it("every cell passes for every route", async () => { h.clearDepsAdapters(); expect(await failures()).toEqual([]); }, 120_000);
  it("hang: 503 on every route within the 5 s guard timeout", async () => { h.clearDepsAdapters(); expect(await runHangCase(h, API_ROUTES)).toEqual([]); }, 20_000);
  it("cell count: 8 routes x the applicable cells", () => {
    const n = API_ROUTES.reduce((a, r) => a + CELLS.filter((c) => applies(c, r)).length, 0);
    expect(n).toBeGreaterThan(8 * 25);
  });
});

describe("planted-bug mutants are caught by the cells that exist to catch them", () => {
  for (const [name, make] of Object.entries(mutantGuards())) {
    it(`mutant: guard ${name}`, async () => {
      h.clearDepsAdapters();
      for (const r of API_ROUTES) h.registerDeps(r.module, (bag) => ({ ...bag, guard: make() }));
      try {
        const caught = [];
        for (const r of [API_ROUTES[0], API_ROUTES[7]]) for (const c of CELLS) { if (!applies(c, r) || c.group === "control") continue; if ((await runCell(h, c, r)).length) caught.push(c.group); }
        expect(caught.length, `no cell caught "${name}"`).toBeGreaterThan(0);
        expect(MUTANT_CAUGHT_BY[name].some((g) => caught.includes(g)), `"${name}" was caught only by ${[...new Set(caught)]}, expected group ${MUTANT_CAUGHT_BY[name]}`).toBe(true);
      } finally { h.clearDepsAdapters(); }
    }, 120_000);
  }
});
