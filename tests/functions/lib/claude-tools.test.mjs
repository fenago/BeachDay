// The agent turn loop + tools against MSW fakes of api.anthropic.com and api.github.com and a fake Blobs store.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import Anthropic from "@anthropic-ai/sdk";
import { createFakeAnthropic } from "./support/fake-anthropic.mjs";
import { createFakeGitHub, blobSha } from "./support/fake-github.mjs";
import { createFakeStore } from "./support/fake-blobs.mjs";
import { runTurn, buildParams, createAnthropicClient, createDeadline, parseChatMessages, assertAllowedModel, mapLimited, ANTHROPIC_BASE_URL } from "../../../netlify/functions/lib/claude.mts";
import { createToolRunner, newTurnState, TOOLS, READ_TOOLS, toolSummary } from "../../../netlify/functions/lib/tools.mts";
import { createGitHubRead } from "../../../netlify/functions/lib/github-read.mts";
import { sseResponse, parseSse, assertEvent } from "../../../netlify/functions/lib/sse.mts";

const GH_TOKEN = ["github", "pat", "TESTONLY"].join("_");
const KEY = ["sk", "ant", "TESTONLY"].join("-"); // too short for the secret scan on purpose
const SEED = { "public/index.html": "<footer></footer>\n", "docs/a.md": "A\n", ".env": "X=1\n" };
const AGENT = { model: "claude-opus-5-5", systemPrompt: "You are a Beach Day agent." };
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => server.close());

let gh, claude, store, events, log;
beforeEach(() => {
  gh = createFakeGitHub({ token: GH_TOKEN, files: SEED });
  claude = createFakeAnthropic();
  server.use(...gh.handlers, claude.handler);
  store = createFakeStore();
  events = [];
  log = [];
});

const client = () => new Anthropic({ baseURL: ANTHROPIC_BASE_URL, apiKey: KEY, timeout: 5_000, maxRetries: 0 });
function turn({ messages = [{ role: "user", content: "Add the NWS link to the footer." }], deadline = createDeadline(55_000, Date.now()), onToolEvent, ...over } = {}) {
  const state = newTurnState();
  const runTool = createToolRunner({ reader: createGitHubRead({ token: GH_TOKEN }), proposals: store, agent: "pwa-mobile-engineer", state, emit: (e) => { events.push(e); onToolEvent?.(e); } });
  return runTurn({ client: client(), agent: AGENT, messages, runTool, emit: (e) => { assertEvent(e); events.push(e); }, effort: "low", deadline, log: (m, d) => log.push([m, d]), ...over }).then((r) => ({ ...r, state }));
}
const tu = (id, name, input) => ({ type: "tool_use", id, name, input });
const NEW_FOOTER = "<footer><a href=\"https://www.weather.gov/beach/mfl\">NWS rip-current risk</a></footer>\n";

describe("request shape (claude-api skill)", () => {
  it("adaptive thinking, explicit effort, cached system, strict closed tools, tool_choice auto, no sampling params", async () => {
    claude.script.push({ content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" });
    await turn();
    const { body, headers } = claude.requests[0];
    expect(headers["anthropic-version"]).toBe("2026-10-21");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.system).toEqual([{ type: "text", text: AGENT.systemPrompt, cache_control: { type: "ephemeral" } }]);
    expect(body.max_tokens).toBe(64000);
    for (const t of body.tools) { expect(t.strict).toBe(true); expect(t.eager_input_streaming).toBe(true); expect(t.input_schema.additionalProperties).toBe(false); }
    for (const k of ["temperature", "top_p", "top_k"]) expect(k in body).toBe(false);
    expect(TOOLS.map((t) => t.name)).toEqual(["read_file", "list_files", "propose_change"]);
  });
  it("the three 5.5 model ids are accepted by SDK 1.12.0 and the API mock; anything else never reaches Claude", async () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
      claude.script.push({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
      const r = await turn({ agent: { ...AGENT, model } });
      expect(r.outcome).toEqual({ kind: "done", stopReason: "end_turn" });
      expect(claude.requests.at(-1).body.model).toBe(model);
    }
    const n = claude.requests.length;
    for (const model of ["claude-fable-5-2", "opus", "claude-opus-5-5-20261101"]) {
      expect(() => buildParams({ ...AGENT, model }, [], "low")).toThrow();
      expect((await turn({ agent: { ...AGENT, model } })).outcome).toEqual({ kind: "error", code: "internal" });
    }
    expect(claude.requests.length).toBe(n);
    expect(() => assertAllowedModel("claude-sonnet-5-5")).not.toThrow();
  });
  it("createAnthropicClient pins baseURL and refuses a missing key; ANTHROPIC_BASE_URL can't reroute it", () => {
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://evil.example";
    try {
      const c = createAnthropicClient("chat", KEY);
      expect(c.baseURL).toBe("https://api.anthropic.com");
      expect(c.timeout).toBe(50_000);
      expect(c.maxRetries).toBe(1);
      expect(c.authToken).toBeNull();
      const j = createAnthropicClient("job", KEY);
      expect([j.timeout, j.maxRetries]).toEqual([840_000, 2]);
      expect(() => createAnthropicClient("chat", "")).toThrow(/not configured/);
    } finally { if (prev === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = prev; }
  });
});

describe("tool loop", () => {
  it("happy path: pins one SHA, parallel calls answered in ONE user message, is_error recovery, pending proposal, never commits", async () => {
    claude.script.push(
      { content: [{ type: "text", text: "Looking." }, tu("toolu_01", "list_files", { dir: "public" }), tu("toolu_02", "read_file", { path: "public/index.html" })], stop_reason: "tool_use" },
      { content: [tu("toolu_03", "propose_change", { summary: "Try the Netlify config instead of the page", files: [{ path: "netlify.toml", content: "[build]\n" }] })], stop_reason: "tool_use" },
      { content: [tu("toolu_04", "read_file", { path: ".env" })], stop_reason: "tool_use" },
      { content: [tu("toolu_05", "propose_change", { summary: "Add the NWS rip-current link to the footer", files: [{ path: "public/index.html", content: NEW_FOOTER }] })], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "I stored a proposal for your review." }], stop_reason: "end_turn" },
    );
    const mainBefore = gh.state.main;
    const r = await turn();
    expect(r.outcome).toEqual({ kind: "done", stopReason: "end_turn" });
    expect(r.usage.rounds).toBe(4);
    expect(r.state.baseSha).toBe(mainBefore);
    expect(gh.state.calls.filter((c) => c === "GET /git/ref/heads/main")).toHaveLength(1); // pinned once per turn
    expect(gh.state.calls.some((c) => /^(POST|PATCH)/.test(c))).toBe(false); // agents never write to GitHub
    expect(gh.state.main).toBe(mainBefore);

    const r2 = claude.requests[1].body.messages;
    expect(r2.at(-2).content[0].type).toBe("thinking"); // assistant content passed back unchanged
    expect(r2.at(-1).content.map((b) => [b.type, b.tool_use_id])).toEqual([["tool_result", "toolu_01"], ["tool_result", "toolu_02"]]);
    expect(r2.at(-1).content[1].content).toBe(SEED["public/index.html"]);
    const denied = claude.requests[2].body.messages.at(-1).content[0];
    expect(denied.is_error).toBe(true);
    expect(denied.content).toMatch(/deny list/);
    expect(claude.requests[3].body.messages.at(-1).content[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/can't read/) });

    const proposals = [...store.rows.values()].map((x) => JSON.parse(x.raw));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ status: "pending", baseSha: mainBefore, agent: "pwa-mobile-engineer", files: [{ path: "public/index.html", content: NEW_FOOTER, readBlobSha: blobSha(SEED["public/index.html"]) }] });
    const types = events.map((e) => e.type + (e.phase ? ":" + e.phase : ""));
    expect(types).toContain("proposal");
    expect(events.find((e) => e.type === "proposal")).toEqual({ type: "proposal", proposalId: proposals[0].id, summary: "Add the NWS rip-current link to the footer", files: [{ path: "public/index.html", bytes: Buffer.byteLength(NEW_FOOTER) }] });
    for (const e of events.filter((x) => x.type === "tool")) expect(e.summary.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(events)).not.toContain("X=1"); // .env never read
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Looking.I stored a proposal for your review.");
  });
  it("stops after 15 tool rounds with tool_rounds_exhausted and a resumable conversation", async () => {
    for (let i = 0; i < 20; i++) claude.script.push({ content: [tu(`toolu_l${i}`, "list_files", { dir: "" })], stop_reason: "tool_use" });
    const r = await turn();
    expect(r.outcome).toEqual({ kind: "done", stopReason: "tool_rounds_exhausted" });
    expect(claude.requests).toHaveLength(15);
    expect(r.messages.at(-1).role).toBe("user");
  });
  it("max_tokens with a tool_use present: the possibly truncated tool is never run", async () => {
    claude.script.push({ content: [tu("toolu_t", "propose_change", { summary: "half a proposal that got cut", files: [{ path: "docs/x.md", content: "x" }] })], stop_reason: "max_tokens" });
    const r = await turn();
    expect(r.outcome).toEqual({ kind: "done", stopReason: "max_tokens" });
    expect(store.rows.size).toBe(0);
  });
  it("token cap (sum of input, output and cache tokens) stops before the next call", async () => {
    claude.script.push({ content: [tu("toolu_a", "list_files", { dir: "" })], stop_reason: "tool_use", usage: { input_tokens: 600_000, output_tokens: 1000, cache_read_input_tokens: 300_000, cache_creation_input_tokens: 99_000 } });
    const r = await turn();
    expect(r.outcome).toEqual({ kind: "done", stopReason: "max_tokens" });
    expect(r.usage.tokens).toBe(1_000_000);
    expect(claude.requests).toHaveLength(1);
  });
  it("hand-off: with < 15 s left no new round starts; state ends with a user turn", async () => {
    let t = 0;
    const deadline = createDeadline(55_000, 0, () => t);
    claude.script.push({ content: [tu("toolu_a", "read_file", { path: "docs/a.md" })], stop_reason: "tool_use" });
    const r = await turn({ deadline, onToolEvent: (e) => { if (e.phase === "end") t = 41_000; } }); // after the read, 14 s left
    expect(r.outcome).toEqual({ kind: "handoff" });
    expect(r.messages.at(-1).role).toBe("user");
    expect(r.state.readShas).toEqual({ "docs/a.md": blobSha("A\n") });
  });
});

describe("per-round tool cap and mid-round deadline (R2-2)", () => {
  it("25 calls in one round -> 10 GitHub reads, 15 is_error results, all answered in one message", async () => {
    claude.script.push({ content: Array.from({ length: 25 }, (_, i) => tu(`toolu_${i}`, "list_files", { dir: "" })), stop_reason: "tool_use" });
    claude.script.push({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    await turn();
    expect(gh.state.calls.filter((c) => c.startsWith("GET /contents"))).toHaveLength(10);
    const results = claude.requests[1].body.messages.at(-1).content;
    expect(results).toHaveLength(25);
    expect(results.filter((b) => b.is_error && /too many tool calls/.test(b.content))).toHaveLength(15);
  });
  it("deadline expiry mid-round: remaining calls get 'out of time' and make no request", async () => {
    let t = 0;
    const deadline = createDeadline(55_000, 0, () => t);
    claude.script.push({ content: [tu("a", "read_file", { path: "docs/a.md" }), tu("b", "read_file", { path: "public/index.html" }), tu("c", "list_files", { dir: "" })], stop_reason: "tool_use" });
    const r = await turn({ deadline, onToolEvent: (e) => { if (e.phase === "end") t = 50_000; } });
    expect(gh.state.calls.filter((c) => c.startsWith("GET /contents"))).toHaveLength(1);
    const res = r.messages.at(-1).content;
    expect(res.map((b) => !!b.is_error)).toEqual([false, true, true]);
    expect(res[1].content).toMatch(/out of time/);
    expect(r.outcome).toEqual({ kind: "handoff" });
  });
});

describe("refusals, upstream errors, deadline", () => {
  it("refusal: one error{refusal}, the refused round is discarded, the category is logged, never shown", async () => {
    claude.script.push({ content: [{ type: "text", text: "Hello.." }], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "x" } });
    const r = await turn();
    expect(r.outcome).toEqual({ kind: "error", code: "refusal" });
    expect(r.messages).toHaveLength(1);
    expect(log.find(([m]) => m === "claude_refusal")).toBeTruthy();
    expect(JSON.stringify(events)).not.toContain("cyber");
  });
  it("mid-stream error event and HTTP errors become upstream; no internals in the outcome", async () => {
    claude.script.push({ content: [{ type: "text", text: "Part" }], midStreamError: "overloaded_error" });
    expect((await turn()).outcome).toEqual({ kind: "error", code: "upstream" });
    claude.script.push({ error: { status: 429, type: "rate_limit_error" } });
    expect((await turn()).outcome).toEqual({ kind: "error", code: "upstream" });
    claude.script.push({ error: { status: 400, type: "invalid_request_error" } });
    expect((await turn()).outcome).toEqual({ kind: "error", code: "upstream" });
    expect(JSON.stringify(log)).not.toContain(KEY);
  });
  it("the per-turn deadline signal aborts a slow upstream -> timeout", async () => {
    claude.script.push({ delayMs: 1500, content: [{ type: "text", text: "late" }], stop_reason: "end_turn" });
    const t0 = Date.now();
    const r = await turn({ deadline: createDeadline(300, Date.now(), Date.now, 0) });
    expect(r.outcome).toEqual({ kind: "error", code: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1400);
  });
  it("end to end through sseResponse: text..., proposal, exactly one done", async () => {
    claude.script.push(
      { content: [tu("toolu_1", "propose_change", { summary: "Add the NWS rip-current link to the footer", files: [{ path: "docs/n.md", content: "n\n" }] })], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" },
    );
    const res = sseResponse(async (w) => {
      const state = newTurnState();
      const runTool = createToolRunner({ reader: createGitHubRead({ token: GH_TOKEN }), proposals: store, agent: "qa-engineer", state, emit: (e) => w.send(e) });
      const r = await runTurn({ client: client(), agent: AGENT, messages: [{ role: "user", content: "go" }], runTool, emit: (e) => w.send(e), effort: "low", deadline: createDeadline(55_000, Date.now()) });
      if (r.outcome.kind === "done") w.done(r.outcome.stopReason); else if (r.outcome.kind === "error") w.error(r.outcome.code);
    });
    const ev = parseSse(await res.text()).map((e) => e.event);
    expect(ev).toEqual(["tool", "proposal", "tool", "text", "done"]);
  });
});

describe("browser transcript", () => {
  it("accepts alternating plain-text turns ending with user; rejects blocks, prefill, extra fields, > 32 KB", () => {
    expect(parseChatMessages([{ role: "user", content: "hi" }])).toEqual([{ role: "user", content: "hi" }]);
    for (const bad of [
      [], [{ role: "assistant", content: "x" }], [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
      [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x" }] }], [{ role: "user", content: "a", extra: 1 }],
      [{ role: "user", content: "x".repeat(32_769) }], [{ role: "user", content: "" }], [{ role: "system", content: "x" }], "x",
    ]) expect(parseChatMessages(bad)).toBeNull();
    expect(toolSummary("read_file", { path: "<img src=x>" })).toBe("Read a path");
  });
});

describe("tool sets, shared meter, parallel batch (Ask the team plumbing)", () => {
  it("runTurn sends the given tool set; default stays TOOLS", async () => {
    claude.script.push({ content: [{ type: "text", text: "a" }], stop_reason: "end_turn" }, { content: [{ type: "text", text: "b" }], stop_reason: "end_turn" });
    await turn({ tools: READ_TOOLS });
    await turn();
    expect(claude.requests[0].body.tools.map((t) => t.name)).toEqual(["read_file", "list_files"]);
    expect(claude.requests[1].body.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });
  it("a runner with allowedTools answers unknown tool for anything else (no GitHub, nothing stored)", async () => {
    const runTool = createToolRunner({ reader: createGitHubRead({ token: GH_TOKEN }), proposals: store, agent: "orchestrator", state: newTurnState(), allowedTools: ["read_file", "list_files"] });
    const r = await runTool({ type: "tool_use", id: "toolu_x", name: "propose_change", input: { summary: "x".repeat(30), files: [{ path: "docs/a.md", content: "y" }] } });
    expect(r).toMatchObject({ is_error: true, content: "unknown tool: propose_change" });
    expect(store.rows.size).toBe(0);
    expect(gh.state.calls).toEqual([]);
  });
  it("tokens go to a shared meter when given, and the cap reads the meter", async () => {
    const meter = { tokens: 999_000 };
    claude.script.push({ content: [tu("toolu_m", "list_files", { dir: "" })], stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 0 } });
    const r = await turn({ meter });
    expect(meter.tokens).toBe(1_000_000);
    expect(r.usage.tokens).toBe(1_000_000);
    expect(r.outcome).toEqual({ kind: "done", stopReason: "max_tokens" });
  });
  it("mapLimited keeps input order and never exceeds the limit", async () => {
    let live = 0, peak = 0;
    const out = await mapLimited([30, 5, 20, 1, 10], 2, async (ms, i) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, ms)); live--; return i; });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });
  it("without a parallel set every tool stays serial (existing behaviour)", async () => {
    let live = 0, peak = 0;
    const runTool = async (b) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); live--; return { type: "tool_result", tool_use_id: b.id, content: "x" }; };
    claude.script.push({ content: [tu("toolu_p1", "read_file", { path: "a" }), tu("toolu_p2", "read_file", { path: "b" })], stop_reason: "tool_use" }, { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    await turn({ runTool });
    expect(peak).toBe(1);
    claude.script.push({ content: [tu("toolu_p3", "read_file", { path: "a" }), tu("toolu_p4", "read_file", { path: "b" })], stop_reason: "tool_use" }, { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    peak = 0;
    await turn({ runTool, parallel: { names: new Set(["read_file"]), limit: 2 } });
    expect(peak).toBe(2);
    expect(claude.requests.at(-1).body.messages.at(-1).content.map((b) => b.tool_use_id)).toEqual(["toolu_p3", "toolu_p4"]);
  });
});
