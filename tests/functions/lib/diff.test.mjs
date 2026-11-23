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
