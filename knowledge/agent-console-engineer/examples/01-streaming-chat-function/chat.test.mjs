// node --test chat.test.mjs  — runs the chat function against the local mock (no network, no key).
import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { createChatHandler, MODEL } from "./chat.mjs";
import { startMockAnthropic } from "./mock-anthropic.mjs";

const mock = await startMockAnthropic();
test.after(() => mock.close());

const client = new Anthropic({ apiKey: "sk-ant-EXAMPLE", baseURL: mock.url, timeout: 5_000, maxRetries: 0 });
const handler = createChatHandler({ client, requireSession: async (req) => req.headers.get("x-test-session") === "ok", system: "You are a Beach Day agent." });

const post = (text, session = "ok") => handler(new Request("https://beachday.example/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json", "x-test-session": session },
  body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
}), { requestId: "test-req" });

async function readEvents(res) {
  const text = await res.text();
  return text.trim().split("\n\n").map((frame) => {
    const [ev, data] = frame.split("\n");
    return { event: ev.slice(7), data: JSON.parse(data.slice(6)) };
  });
}

test("streams text deltas and ends with done", async () => {
  const res = await post("Is Hollywood Beach good today?");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const events = await readEvents(res);
  console.log(events.map((e) => `${e.event} ${JSON.stringify(e.data)}`).join("\n"));
  assert.deepEqual(events.filter((e) => e.event === "text").map((e) => e.data.text).join(""), "Hollywood Beach looks great today.");
  assert.equal(events.at(-1).event, "done");
  assert.equal(events.at(-1).data.stop_reason, "end_turn");
  assert.ok(!events.some((e) => e.event === "thinking"), "thinking is never forwarded");
});

test("request sent to Claude has the required shape", async () => {
  const sent = mock.requests.at(-1);
  assert.equal(sent.url, "/v1/messages");
  // SDK 1.12.0 sends the key as `Authorization: Bearer`; the docs also show `x-api-key`.
  assert.ok(sent.headers.authorization === "Bearer sk-ant-EXAMPLE" || sent.headers["x-api-key"] === "sk-ant-EXAMPLE");
  assert.equal(sent.headers["anthropic-version"], "2026-10-21");
  assert.equal(sent.body.model, MODEL);
  assert.equal(sent.body.stream, true);
  assert.deepEqual(sent.body.thinking, { type: "adaptive" });
  assert.deepEqual(sent.body.output_config, { effort: "low" });
  for (const k of ["temperature", "top_p", "top_k", "tool_choice"]) assert.ok(!(k in sent.body), `${k} must not be sent`);
});

test("refusal becomes a refusal event (UI discards partial text)", async () => {
  const events = await readEvents(await post("please refuse this"));
  assert.equal(events.at(-1).event, "refusal");
  assert.equal(events.at(-1).data.category, "cyber");
});

test("mid-stream error event becomes a generic error event", async () => {
  const events = await readEvents(await post("simulate overload"));
  assert.equal(events.at(-1).event, "error");
  assert.ok(!JSON.stringify(events).includes("overloaded_error"), "no upstream internals leak");
});

test("401 without a session, 400 when last turn is not user", async () => {
  assert.equal((await post("hi", "nope")).status, 401);
  const res = await handler(new Request("https://beachday.example/api/chat", {
    method: "POST", headers: { "x-test-session": "ok" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "Sure" }] }),
  }), {});
  assert.equal(res.status, 400);
});
