// netlify/functions/chat.mts — shape of the Beach Day streaming chat function.
// Netlify Functions v2 syntax: default export (Request, Context) => Response, plus `config.path`.
// It calls Claude with the Anthropic SDK and re-emits a SIMPLIFIED SSE stream to the browser:
//   event: text     {"text":"..."}                      text deltas only (thinking is never forwarded)
//   event: refusal  {"category":..., "explanation":...}  discard any partial text already shown
//   event: error    {"message":"..."}                   generic, no internals
//   event: done     {"stop_reason":"end_turn","usage":{...}}
// Tool rounds and long jobs are NOT handled here (see example 02 and the background job).
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
const MAX_USER_BYTES = 32 * 1024; // docs/04 §9: user message <= 32 KB

export function createChatHandler({ client, requireSession, system }) {
  return async function chat(req, context) {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    const session = await requireSession(req, context); // checks cookie + CSRF header + Origin
    if (!session) return json(401, { error: "unauthorized" });

    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_USER_BYTES) return json(413, { error: "too_large" });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: "bad_json" }); }
    if (!Array.isArray(body.messages) || body.messages.length === 0 ||
        body.messages.at(-1).role !== "user") {
      // Prefill is rejected by current models, so the conversation must end with a user turn.
      return json(400, { error: "last_message_must_be_user" });
    }

    const encoder = new TextEncoder();
    const send = (ctrl, event, data) =>
      ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

    const stream = new ReadableStream({
      async start(ctrl) {
        try {
          const s = client.messages.stream({
            model: MODEL,
            max_tokens: 16000,              // covers thinking + text
            thinking: { type: "adaptive" }, // the only accepted type besides omitting it
            output_config: { effort: "low" }, // explicit; Opus 5.5 would default to "medium"
            system,                          // stable prompt from agents.json, no timestamps
            messages: body.messages,
            // no temperature/top_p/top_k: removed in API version 2026-10-21 (400)
          });
          for await (const ev of s) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              send(ctrl, "text", { text: ev.delta.text });
            }
            // thinking_delta / signature_delta / ping / unknown event types are ignored on purpose
          }
          const final = await s.finalMessage();
          if (final.stop_reason === "refusal") {
            send(ctrl, "refusal", {
              category: final.stop_details?.category ?? null,
              explanation: final.stop_details?.explanation ?? null,
            });
          } else {
            send(ctrl, "done", { stop_reason: final.stop_reason, usage: final.usage });
          }
        } catch (err) {
          // Mid-stream `event: error` (e.g. overloaded_error) surfaces here as an APIError.
          console.error("chat_failed", { requestId: context?.requestId, status: err?.status, type: err?.error?.error?.type });
          send(ctrl, "error", { message: "The agent is unavailable right now. Try again in a minute." });
        } finally {
          ctrl.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  };
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

// --- Production wiring (what netlify/functions/chat.mts would export) ---------------------
// The key is read from process.env.ANTHROPIC_API_KEY by the SDK; never passed to the browser.
export default createChatHandler({
  // baseURL is pinned: the SDK otherwise honours an ANTHROPIC_BASE_URL env var.
  client: new Anthropic({ baseURL: "https://api.anthropic.com", timeout: 50_000, maxRetries: 1 }),
  requireSession: async () => null, // replace with lib/auth requireSession; deny by default
  system: "You are a Beach Day agent.",
});

export const config = { path: "/api/chat" };
