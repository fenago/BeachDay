import { describe, it, expect } from "vitest";
import { sseResponse, encodeEvent, parseSse, errorEvent, assertEvent } from "../../../netlify/functions/lib/sse.mts";

const body = async (res) => parseSse(await res.text());

describe("sse", () => {
  it("headers: event-stream, no-store, nosniff, no CORS", async () => {
    const res = sseResponse(async (w) => w.done("end_turn"));
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    for (const [k] of res.headers) expect(k.startsWith("access-control-")).toBe(false);
    expect((await body(res)).map((e) => e.event)).toEqual(["done"]);
  });
  it("event: equals data.type; exactly one terminal event; later sends ignored", async () => {
    const res = sseResponse(async (w) => {
      w.send({ type: "text", delta: "Hi" });
      w.send({ type: "tool", name: "read_file", phase: "start", summary: "Read public/index.html" });
      w.error("refusal");
      w.send({ type: "text", delta: "after" });
      w.done("end_turn");
    });
    const ev = await body(res);
    for (const e of ev) expect(e.event).toBe(e.data.type);
    expect(ev.map((e) => e.event)).toEqual(["text", "tool", "error"]);
    expect(ev.at(-1).data).toEqual({ type: "error", code: "refusal", message: "The agent declined this request. Try rephrasing it.", retryable: false });
  });
  it("a throw or a missing terminal becomes one internal error with no details", async () => {
    const a = await body(sseResponse(async () => { throw new Error("secret detail"); }, () => {}));
    expect(a).toEqual([{ event: "error", data: { type: "error", code: "internal", message: "Something went wrong on our side.", retryable: true } }]);
    const b = await body(sseResponse(async (w) => w.send({ type: "text", delta: "x" }), () => {}));
    expect(b.map((e) => e.data.code ?? e.event)).toEqual(["text", "internal"]);
  });
  it("rejects events outside the §2.1 contract and splits long text", async () => {
    expect(() => encodeEvent({ type: "thinking", thinking: "x" })).toThrow();
    expect(() => encodeEvent({ type: "done", stopReason: "refusal" })).toThrow();
    expect(() => encodeEvent({ type: "tool", name: "commit", phase: "start" })).toThrow();
    expect(() => encodeEvent({ type: "tool", name: "read_file", phase: "start", summary: "x".repeat(201) })).toThrow();
    expect(() => assertEvent({ type: "handoff", jobId: "p_" + "A".repeat(26) })).toThrow();
    expect(encodeEvent({ type: "text", delta: "a\nb" }).split("\n").filter((l) => l.startsWith("data:"))).toHaveLength(1);
    const ev = await body(sseResponse(async (w) => { w.send({ type: "text", delta: "z".repeat(10_000) }); w.done(); }));
    expect(ev.filter((e) => e.event === "text").map((e) => e.data.delta).join("")).toHaveLength(10_000);
    expect(ev.at(-1).data).toEqual({ type: "done" });
    expect(errorEvent("upstream").retryable).toBe(true);
    expect(errorEvent("refusal", "x".repeat(900)).message).toHaveLength(500);
  });
});
