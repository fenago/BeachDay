import { describe, it, expect } from "vitest";
import { createFakeBlobs } from "./fake-blobs.mjs";

describe("fake-blobs", () => {
  it("onlyIfNew refuses an existing key, onlyIfMatch needs the current etag", async () => {
    const s = createFakeBlobs().getStore("t");
    expect((await s.setJSON("k", { a: 1 }, { onlyIfNew: true })).modified).toBe(true);
    expect((await s.setJSON("k", { a: 2 }, { onlyIfNew: true })).modified).toBe(false);
    const { etag } = await s.getWithMetadata("k", { type: "json" });
    expect((await s.setJSON("k", { a: 3 }, { onlyIfMatch: "stale" })).modified).toBe(false);
    expect((await s.setJSON("k", { a: 3 }, { onlyIfMatch: etag })).modified).toBe(true);
    expect(await s.get("k", { type: "json" })).toEqual({ a: 3 });
  });
  it("exactly one of 20 concurrent onlyIfNew writers wins (calls interleave)", async () => {
    const s = createFakeBlobs().getStore("t");
    const wins = (await Promise.all(Array.from({ length: 20 }, (_, i) => s.setJSON("k", { i }, { onlyIfNew: true })))).filter((r) => r.modified);
    expect(wins).toHaveLength(1);
  });
  it("counts every call so 'touched nothing' is assertable", async () => {
    const b = createFakeBlobs();
    expect(b.callCount).toBe(0);
    await b.getStore("a").get("x");
    await b.getStore({ name: "b" }).list({ prefix: "p" });
    expect(b.callCount).toBe(2);
    b.resetCalls();
    expect(b.callCount).toBe(0);
  });
  it("same name = same store; list filters by prefix; delete removes", async () => {
    const b = createFakeBlobs();
    await b.getStore("s").set("p_1", "x"); await b.getStore("s").set("q_1", "y");
    expect((await b.getStore("s").list({ prefix: "p_" })).blobs.map((x) => x.key)).toEqual(["p_1"]);
    await b.getStore("s").delete("p_1");
    expect(await b.getStore("s").get("p_1")).toBeNull();
  });
});
