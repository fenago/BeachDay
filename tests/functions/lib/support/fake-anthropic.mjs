// MSW fake of POST https://api.anthropic.com/v1/messages with stream:true.
// Each request pops the next scripted round: { content: [blocks], stop_reason, stop_details?, usage? }
// or { error: {status, type} } (HTTP error) or { midStreamError: type } or { delayMs }.
// It answers 400 like the real API on request-shape violations (sampling params, non-adaptive thinking,
// forced tool_choice, non-strict/open tool schemas, prefill, missing tool_results).
import { http, HttpResponse } from "msw";

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function violations(body) {
  for (const k of ["temperature", "top_p", "top_k"]) if (k in body) return `${k} is not supported`;
  if (body.thinking && body.thinking.type !== "adaptive") return `"thinking.type.${body.thinking.type}" is not supported for this model.`;
  if (body.tool_choice && ["any", "tool"].includes(body.tool_choice.type)) return 'tool_choice: type "tool" and "any" are not supported for this model.';
  const closed = (s) => !s || typeof s !== "object" || ((s.type !== "object" || s.additionalProperties === false) && Object.values(s.properties ?? {}).every(closed) && closed(s.items));
  for (const t of body.tools ?? []) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(t.name)) return "bad tool name";
    if (t.strict && !closed(t.input_schema)) return "strict tool needs additionalProperties:false";
    if (JSON.stringify(t.input_schema).match(/"max(Length|Items)"/)) return "maxLength/maxItems unsupported in strict schemas";
  }
  const m = body.messages ?? [];
  if (!m.length || m.at(-1).role !== "user") return "This model does not support assistant message prefill. The conversation must end with a user message.";
  for (let i = 0; i < m.length; i++) {
    if (m[i].role !== "assistant" || !Array.isArray(m[i].content)) continue;
    const ids = m[i].content.filter((b) => b.type === "tool_use").map((b) => b.id);
    if (!ids.length) continue;
    const next = Array.isArray(m[i + 1]?.content) ? m[i + 1].content : [];
    const firstOther = next.findIndex((b) => b.type !== "tool_result");
    if (firstOther !== -1 && next.slice(firstOther).some((b) => b.type === "tool_result")) return "tool_result blocks must come first";
    if (ids.some((id) => !next.find((r) => r.type === "tool_result" && r.tool_use_id === id))) return "tool_use ids were found without tool_result blocks immediately after";
  }
  return null;
}

export function createFakeAnthropic() {
  const script = [];
  const requests = [];
  const handler = http.post("https://api.anthropic.com/v1/messages", async ({ request }) => {
    const body = await request.json();
    requests.push({ headers: Object.fromEntries(request.headers), body });
    const bad = violations(body);
    if (bad) return HttpResponse.json({ type: "error", error: { type: "invalid_request_error", message: bad }, request_id: "req_mock" }, { status: 400 });
    const round = script.shift() ?? { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    if (round.delayMs) await new Promise((r) => setTimeout(r, round.delayMs));
    if (round.error) return HttpResponse.json({ type: "error", error: { type: round.error.type }, request_id: "req_mock" }, { status: round.error.status });
    let out = frame("message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 1 } } });
    const blocks = [{ type: "thinking", thinking: "", signature: "sig" }, ...(round.content ?? [])];
    blocks.forEach((b, index) => {
      if (b.type === "thinking") {
        out += frame("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
        out += frame("content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: b.signature } });
      } else if (b.type === "text") {
        out += frame("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
        out += frame("ping", { type: "ping" });
        out += frame("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
      } else if (b.type === "tool_use") {
        out += frame("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
        out += frame("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
      }
      out += frame("content_block_stop", { type: "content_block_stop", index });
    });
    if (round.midStreamError) {
      out += frame("error", { type: "error", error: { type: round.midStreamError, message: "Overloaded" } });
    } else {
      const usage = round.usage ?? { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      out += frame("message_delta", { type: "message_delta", delta: { stop_reason: round.stop_reason, stop_sequence: null, stop_details: round.stop_details ?? null }, usage });
      out += frame("message_stop", { type: "message_stop" });
    }
    return new HttpResponse(out, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_mock_1" } });
  });
  return { handler, script, requests };
}
