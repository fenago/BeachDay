// Local mock of POST /v1/messages (non-streaming) that scripts a tool-using agent and
// enforces the documented request rules, answering 400 invalid_request_error like the API would.
import http from "node:http";

const SCRIPTS = {
  happy: [
    [{ type: "text", text: "Let me look at the front page." },
     { type: "tool_use", id: "toolu_01", name: "list_files", input: { dir: "public" } },
     { type: "tool_use", id: "toolu_02", name: "read_file", input: { path: "public/index.html" } }],
    [{ type: "tool_use", id: "toolu_03", name: "propose_change", input: { summary: "Try netlify.toml", files: [{ path: "netlify.toml", content: "[build]\n" }] } }],
    [{ type: "tool_use", id: "toolu_04", name: "propose_change", input: { summary: "Add NWS rip-current link to the footer.", files: [{ path: "public/index.html", content: "<footer><a href=\"https://www.weather.gov/beach/mfl\">NWS rip-current risk</a></footer>\n" }] } }],
    [{ type: "text", text: "I stored a proposal for your review." }],
  ],
};

function validate(body) {
  if (body.tool_choice && ["any", "tool"].includes(body.tool_choice.type)) return 'tool_choice: type "tool" and "any" are not supported for this model.';
  if ("temperature" in body) return "temperature is not supported";
  for (const t of body.tools ?? []) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(t.name)) return `bad tool name ${t.name}`;
    if (t.strict && !allObjectsClosed(t.input_schema)) return `strict tool ${t.name}: every object needs additionalProperties: false`;
  }
  const m = body.messages;
  if (m.at(-1).role !== "user") return "This model does not support assistant message prefill. The conversation must end with a user message.";
  for (let i = 0; i < m.length; i++) {
    if (m[i].role !== "assistant" || !Array.isArray(m[i].content)) continue;
    const ids = m[i].content.filter((b) => b.type === "tool_use").map((b) => b.id);
    if (!ids.length) continue;
    const next = m[i + 1];
    const blocks = Array.isArray(next?.content) ? next.content : [];
    const firstNonResult = blocks.findIndex((b) => b.type !== "tool_result");
    const results = blocks.filter((b) => b.type === "tool_result");
    if (firstNonResult !== -1 && blocks.slice(firstNonResult).some((b) => b.type === "tool_result")) return "tool_result blocks must come first";
    if (ids.some((id) => !results.find((r) => r.tool_use_id === id))) return "tool_use ids were found without tool_result blocks immediately after";
  }
  return null;
}
function allObjectsClosed(s) {
  if (!s || typeof s !== "object") return true;
  if (s.type === "object" && s.additionalProperties !== false) return false;
  return Object.values(s.properties ?? {}).every(allObjectsClosed) && allObjectsClosed(s.items);
}

export function startMockAnthropic() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    requests.push(body);
    const err = validate(body);
    if (err) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: err }, request_id: "req_mock" }));
    }
    const scenario = body.system.match(/\[scenario:(\w+)\]/)?.[1] ?? "happy";
    const round = body.messages.filter((x) => x.role === "assistant").length;
    const thinking = { type: "thinking", thinking: "", signature: `sig_${round}` }; // display: "omitted"
    let content, stop_reason;
    if (scenario === "loop") {
      content = [thinking, { type: "tool_use", id: `toolu_loop_${round}`, name: "list_files", input: { dir: "" } }]; stop_reason = "tool_use";
    } else if (scenario === "truncated") {
      content = [thinking, { type: "tool_use", id: "toolu_trunc", name: "propose_change", input: { summary: "half" } }]; stop_reason = "max_tokens";
    } else {
      const step = SCRIPTS.happy[round];
      content = [thinking, ...step];
      stop_reason = step.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `msg_${round}`, type: "message", role: "assistant", model: body.model, content, stop_reason, stop_sequence: null, stop_details: null, usage: { input_tokens: 100, output_tokens: 20 } }));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() })));
}
