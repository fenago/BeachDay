// node --test chat.test.mjs  — runs the chat function against the local mock (no network, no key).
import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { createChatHandler, ALLOWED_MODELS } from "./chat.mjs";
import { startMockAnthropic } from "./mock-anthropic.mjs";

const mock = await startMockAnthropic();
test.after(() => mock.close());

const KEY = "sk-ant-EXAMPLE";
const PROD = { requestId: "test-req", deploy: { context: "production" } };
const AGENTS = {
  "agent-console-engineer": { model: "claude-opus-5-5", systemPrompt: "You are a Beach Day agent." },
  "rogue": { model: "claude-fable-5-2", systemPrompt: "x" },
};

// Fake guard: the Bearer value picks the outcome lib/auth would return.
const fakeGuard = async (req) => {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (token === "admin") return { ok: true, userId: "u_admin" };
  if (token === "user") return { ok: false, status: 403, code: "forbidden" };
  if (token === "down") throw new Error("supabase unreachable");
  return { ok: false, status: 401, code: "unauthorized" };
};

let clientsMade = 0;
const makeHandler = (opts = {}) => createChatHandler({
  guard: fakeGuard,
  getClient: () => { clientsMade++; return new Anthropic({ apiKey: KEY, baseURL: mock.url, timeout: 5_000, maxRetries: 0 }); },
  getAgent: (n) => AGENTS[n],
  ...opts,
});
const handler = makeHandler();

const post = (text, { token = "admin", agent = "agent-console-engineer", h = handler, ctx = PROD, messages } = {}) =>
  h(new Request("https://beachday.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ agent, messages: messages ?? [{ role: "user", content: text }] }),
  }), ctx);

async function readEvents(res) {
  const text = await res.text();
  return text.trim().split("\n\n").map((frame) => {
    const [ev, data] = frame.split("\n");
    return { event: ev.slice(7), data: JSON.parse(data.slice(6)) };
  });
}

test("streams text deltas and ends with exactly one done (docs/04 §2.1 shapes)", async () => {
  const res = await post("Is Hollywood Beach good today?");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const events = await readEvents(res);
  console.log(events.map((e) => `${e.event} ${JSON.stringify(e.data)}`).join("\n"));
  for (const e of events) assert.equal(e.event, e.data.type, "event: equals data.type");
  assert.equal(events.filter((e) => e.event === "text").map((e) => e.data.delta).join(""), "Hollywood Beach looks great today.");
  assert.deepEqual(events.at(-1).data, { type: "done", stopReason: "end_turn" });
  assert.equal(events.filter((e) => e.event === "done" || e.event === "error").length, 1);
  assert.ok(!events.some((e) => e.event === "thinking"), "thinking is never forwarded");
});

test("request sent to Claude has the required shape", async () => {
  const sent = mock.requests.at(-1);
  assert.equal(sent.url, "/v1/messages");
  // SDK 1.12.0 sends the key as `Authorization: Bearer`; the docs also show `x-api-key`.
  assert.ok(sent.headers.authorization === `Bearer ${KEY}` || sent.headers["x-api-key"] === KEY);
  assert.equal(sent.headers["anthropic-version"], "2026-10-21");
  assert.ok(ALLOWED_MODELS.has(sent.body.model));
  assert.equal(sent.body.stream, true);
  assert.deepEqual(sent.body.thinking, { type: "adaptive" });
  assert.deepEqual(sent.body.output_config, { effort: "low" });
  for (const k of ["temperature", "top_p", "top_k", "tool_choice"]) assert.ok(!(k in sent.body), `${k} must not be sent`);
  assert.ok(!JSON.stringify(sent.body).includes("admin"), "the user's bearer token never reaches Claude");
});

test("refusal ends with error{code:refusal}, no done, no category shown", async () => {
  const events = await readEvents(await post("please refuse this"));
  assert.deepEqual(events.at(-1).data.code, "refusal");
  assert.equal(events.at(-1).data.retryable, false);
  assert.ok(!events.some((e) => e.event === "done"));
  assert.ok(!JSON.stringify(events.at(-1)).includes("cyber"));
});

test("mid-stream error event becomes a generic upstream error", async () => {
  const events = await readEvents(await post("simulate overload"));
  assert.deepEqual(events.at(-1).data, { type: "error", code: "upstream", message: "The agent is unavailable right now. Try again in a minute.", retryable: true });
  assert.ok(!JSON.stringify(events).includes("overloaded_error"), "no upstream internals leak");
});

test("guard outcomes: 401 / 403 / 503, JSON error shape, and Claude is never called", async () => {
  const before = mock.requests.length;
  const made = clientsMade;
  for (const [token, status, code] of [["", 401, "unauthorized"], ["garbage", 401, "unauthorized"], ["user", 403, "forbidden"], ["down", 503, "unavailable"]]) {
    const res = await post("hi", { token });
    assert.equal(res.status, status, token);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("www-authenticate"), status === 401 ? "Bearer" : null);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    const body = await res.json();
    assert.equal(body.error.code, code);
    assert.ok(!JSON.stringify(body).includes("supabase unreachable"), "upstream error never echoed");
  }
  assert.equal(mock.requests.length, before, "no Claude request");
  assert.equal(clientsMade, made, "no SDK client created");
});

test("outside production: 503 before the client (and the key) is touched", async () => {
  const made = clientsMade;
  const res = await post("hi", { ctx: { requestId: "x", deploy: { context: "deploy-preview" } } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "unavailable");
  assert.equal(clientsMade, made);
});

test("bad input: trailing assistant turn, smuggled block content, unknown agent → 400; fable model → 500", async () => {
  const before = mock.requests.length;
  assert.equal((await post("", { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "Sure" }] })).status, 400);
  assert.equal((await post("", { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x" }] }] })).status, 400);
  assert.equal((await post("hi", { agent: "nobody" })).status, 400);
  assert.equal((await post("hi", { agent: "rogue" })).status, 500);
  assert.equal((await handler(new Request("https://beachday.example/api/chat"), PROD)).status, 405);
  assert.equal(mock.requests.length, before, "none of these reached Claude");
});

test("per-turn deadline aborts a slow upstream and ends with error{code:timeout}", async () => {
  const quick = makeHandler({ deadlineMs: 300 });
  const t0 = Date.now();
  const events = await readEvents(await post("slow please", { h: quick }));
  const took = Date.now() - t0;
  console.log(`deadline 300 ms, stream closed after ${took} ms`);
  assert.equal(events.at(-1).data.code, "timeout");
  assert.equal(events.at(-1).data.retryable, true);
  assert.ok(took < 1500, "closed well before the mock's 2 s delay");
});
