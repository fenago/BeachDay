// node --test agent-loop.test.mjs — the loop against a local mock; no network, no real key.
import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "./agent-loop.mjs";
import { makeToolRunner, TOOLS, checkPath } from "./tools.mjs";
import { startMockAnthropic } from "./mock-anthropic.mjs";

const mock = await startMockAnthropic();
test.after(() => mock.close());
const client = new Anthropic({ apiKey: "sk-ant-EXAMPLE", baseURL: mock.url, maxRetries: 0, timeout: 5_000 });

function fixtures() {
  const files = { "public/index.html": "<h1>Beach Day</h1>\n", "public/app.js": "export {}\n" };
  const repo = { read: (p) => files[p], list: (d) => Object.keys(files).filter((p) => p.startsWith(d + "/")) };
  const stored = [];
  const proposals = { put: (p) => (stored.push(p), `prop_${stored.length}`) };
  return { repo, proposals, stored };
}
const user = [{ role: "user", content: "Add the NWS rip-current link to the footer." }];

test("happy path: parallel calls, is_error recovery, proposal stored, never committed", async () => {
  const f = fixtures();
  const lines = [];
  const out = await runAgent({ client, runTool: makeToolRunner(f), system: "Beach Day agent [scenario:happy]", messages: user, log: (l) => lines.push(l) });
  console.log(lines.join("\n"));
  assert.equal(out.status, "done");
  assert.equal(out.text, "I stored a proposal for your review.");
  assert.equal(f.stored.length, 1);
  assert.equal(f.stored[0].status, "pending");
  assert.equal(f.stored[0].files[0].path, "public/index.html");

  // Round 2 request: both results in ONE user message, matched by id, results only.
  const r2 = mock.requests.at(-3).messages;
  const toolMsg = r2.at(-1);
  assert.equal(toolMsg.role, "user");
  assert.deepEqual(toolMsg.content.map((b) => [b.type, b.tool_use_id]), [["tool_result", "toolu_01"], ["tool_result", "toolu_02"]]);
  assert.equal(r2.at(-2).content[0].type, "thinking", "assistant content (incl. thinking) passed back unchanged");

  // Round 3 request: the denied netlify.toml proposal came back as is_error.
  const denied = mock.requests.at(-2).messages.at(-1).content[0];
  assert.equal(denied.is_error, true);
  assert.match(denied.content, /deny list/);
});

test("max rounds stops a runaway loop", async () => {
  const out = await runAgent({ client, runTool: makeToolRunner(fixtures()), system: "x [scenario:loop]", messages: user, maxRounds: 3 });
  assert.equal(out.status, "max_rounds");
});

test("tool_use cut off by max_tokens is never executed", async () => {
  const f = fixtures();
  const out = await runAgent({ client, runTool: makeToolRunner(f), system: "x [scenario:truncated]", messages: user });
  assert.equal(out.status, "truncated");
  assert.equal(f.stored.length, 0);
});

test("tool definitions are strict and closed", () => {
  for (const t of TOOLS) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
  }
  assert.equal(TOOLS[2].input_schema.properties.files.items.additionalProperties, false);
});

test("mock rejects forced tool_choice like the real API", async () => {
  await assert.rejects(
    client.messages.create({ model: "claude-opus-5-5", max_tokens: 100, system: "x", tools: TOOLS, tool_choice: { type: "any" }, messages: user }),
    (e) => e.status === 400 && /not supported/.test(e.message));
});

test("checkPath basics", () => {
  assert.equal(checkPath("public/index.html"), null);
  assert.match(checkPath("netlify/functions/approve.mts"), /deny/);
  assert.match(checkPath("public/../netlify.toml"), /normalized/);
});
