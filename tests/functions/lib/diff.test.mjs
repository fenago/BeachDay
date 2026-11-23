import { describe, it, expect } from "vitest";
import { unifiedDiff, proposalDiffs } from "../../../netlify/functions/lib/diff.mts";

describe("diff", () => {
  it("unified diff with +/- markers, /dev/null for new files", () => {
    const d = unifiedDiff("public/a.js", "x\ny\n", "x\nz\n");
    expect(d.split("\n").slice(0, 3)).toEqual(["--- a/public/a.js", "+++ b/public/a.js", "@@ -1,2 +1,2 @@"]);
    expect(d).toContain("-y\n+z");
    expect(unifiedDiff("docs/n.md", null, "hi\n")).toMatch(/^--- \/dev\/null\n\+\+\+ b\/docs\/n.md\n@@ -0,0 \+1(,1)? @@\n\+hi/);
  });
  it("proposalDiffs reads serially and degrades to a note when the old file can't be read", async () => {
    const order = [];
    const out = await proposalDiffs([{ path: "a.md", content: "1\n" }, { path: "b.md", content: "2\n" }], async (p) => {
      order.push(p);
      if (p === "b.md") throw new Error("github down");
      return "0\n";
    });
    expect(order).toEqual(["a.md", "b.md"]);
    expect(out[0].diff).toContain("+1");
    expect(out[1].diff).toMatch(/^Couldn't load the current version of b\.md/);
  });
});

describe("diff bounds (R2-1)", () => {
  const alt = (n, a, b) => Array.from({ length: n }, (_, i) => (i % 2 ? a : b) + i).join("\n") + "\n";
  it("adversarial alternating-line 200 KB input finishes < 2 s with the too-large fallback", () => {
    const before = alt(20_000, "x", "y").slice(0, 200 * 1024), after = alt(20_000, "y", "x").slice(0, 200 * 1024);
    const t0 = Date.now();
    const d = unifiedDiff("docs/big.md", before, after);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(d).toMatch(/^Diff too large to show; new file is \d+ bytes\./);
    expect(d.split("\n").filter((l) => l.startsWith("+")).length).toBeGreaterThan(1000);
  });
  it("20 adversarial files stay within the overall budget; past it every file falls back without diffing", async () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `docs/f${i}.md`, content: alt(8000, "q", "r") }));
    const t0 = Date.now();
    const out = await proposalDiffs(files, async () => alt(8000, "r", "q"), { budgetMs: 1500 });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(out.at(-1).diff).toMatch(/^Diff too large/);
    expect(unifiedDiff("a.md", "x\n", "y\n", 0)).toMatch(/^Diff too large/);
  });
});
