// Local mock of POST /v1/messages with stream:true. Emits SSE events shaped like the
// examples on https://platform.claude.com/docs/en/build-with-claude/streaming
// Scenario is chosen by the last user message text: "refuse" | "overload" | anything else.
import http from "node:http";

const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function startMockAnthropic() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });

    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "Not found" } }));
    }
    // Mirror two real 400s so a regression in the request shape fails loudly.
    if ("temperature" in body || body.thinking?.type === "disabled" || body.thinking?.budget_tokens) {
      res.writeHead(400, { "content-type": "application/json", "request-id": "req_mock_400" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "rejected by mock" }, request_id: "req_mock_400" }));
    }

    const last = body.messages.at(-1);
    const userText = typeof last.content === "string" ? last.content : last.content.map((b) => b.text ?? "").join("");
    res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_mock_1" });

    sse(res, "message_start", { type: "message_start", message: { id: "msg_mock_1", type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 25, output_tokens: 1 } } });
    // Thinking block first; display defaults to "omitted" so the text is empty, only a signature.
    sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
    sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "EqQBmock" } });
    sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sse(res, "ping", { type: "ping" });
    sse(res, "content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });

    if (userText.includes("overload")) {
      sse(res, "content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Part" } });
      sse(res, "error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
      return res.end();
    }
    const chunks = userText.includes("refuse") ? ["Hello.."] : ["Hollywood Beach ", "looks great ", "today."];
    for (const t of chunks) sse(res, "content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } });
    sse(res, "content_block_stop", { type: "content_block_stop", index: 1 });
    if (userText.includes("refuse")) {
      sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: "cyber", explanation: "This request was declined because it could enable cyber harm." } }, usage: { output_tokens: 3 } });
    } else {
      sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 15 } });
    }
    sse(res, "message_stop", { type: "message_stop" });
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() })));
}
