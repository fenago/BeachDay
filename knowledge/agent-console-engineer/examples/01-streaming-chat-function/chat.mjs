// netlify/functions/chat.mts — shape of the Beach Day streaming chat function.
// Netlify Functions v2 syntax: default export (Request, Context) => Response, plus `config.path`.
// Order of work (docs/04 §4.1, §4.6, §8):
//   1. method → 2. token-and-role guard (lib/auth, supabase-auth-engineer's) → 3. production-context
//   check → 4. body size and shape → 5. model allow-list → 6. Claude, with a per-turn deadline.
// It re-emits only the docs/04 §2.1 SSE events; every data line carries `type`:
//   text {delta} · error {code, message, retryable} · done {stopReason}
// The stream ends with exactly one `done` or `error`. Tool rounds, hand-off and limits are not here
// (example 02 shows the tool loop).
import Anthropic from "@anthropic-ai/sdk";

export const ALLOWED_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
export const TURN_DEADLINE_MS = 55_000;    // Netlify stops streaming functions at 60 s
const MAX_BODY_BYTES = 32 * 1024;          // docs/04 §9: user message <= 32 KB

const BASE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const MESSAGES = {
  unauthorized: "Your session ended. Sign in again.",
  forbidden: "This account can't use the Console.",
  unavailable: "Couldn't check your access. Try again in a minute.",
  invalid_request: "That message couldn't be sent.",
  internal: "Something went wrong on our side.",
  method_not_allowed: "Method not allowed.",
};

/**
 * @param {object} deps
 * @param {(req: Request, context: object) => Promise<{ok: true, userId: string} | {ok: false, status: 401|403|503, code: string}>} deps.guard
 * @param {() => Anthropic} deps.getClient  created lazily, only after the production check
 * @param {(name: string) => {model: string, systemPrompt: string} | undefined} deps.getAgent
 */
export function createChatHandler({ guard, getClient, getAgent, deadlineMs = TURN_DEADLINE_MS, now = Date.now }) {
  return async function chat(req, context) {
    const startedAt = now();
    if (req.method !== "POST") return jsonError(405, "method_not_allowed", { allow: "POST" });

    // 2. The guard runs before the body is read and before anything else is touched.
    let auth;
    try { auth = await guard(req, context); } catch { auth = { ok: false, status: 503, code: "unavailable" }; }
    if (!auth?.ok) {
      const status = [401, 403, 503].includes(auth?.status) ? auth.status : 503; // fail closed
      const code = { 401: "unauthorized", 403: "forbidden", 503: "unavailable" }[status];
      return jsonError(status, code, status === 401 ? { "www-authenticate": "Bearer" } : {});
    }

    // 3. Secrets exist only in production (docs/04 §4.6); refuse before reading any.
    if (context?.deploy?.context !== "production") return jsonError(503, "unavailable");

    // 4. Size before parse, then shape. The browser sends plain-text turns only: it never sends
    //    tool_use, tool_result or thinking blocks (agent-console-security).
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return jsonError(413, "invalid_request");
    let body;
    try { body = JSON.parse(raw); } catch { return jsonError(400, "invalid_request"); }
    const msgs = body?.messages;
    const shapeOk = Array.isArray(msgs) && msgs.length > 0 &&
      msgs.every((m, i) => m && typeof m.content === "string" && m.role === (i % 2 === 0 ? "user" : "assistant")) &&
      msgs.at(-1).role === "user";       // no prefill: current models reject a trailing assistant turn
    if (!shapeOk || typeof body.agent !== "string") return jsonError(400, "invalid_request");

    // 5. Model allow-list (docs/04 §11). agents.json is build output, but check anyway.
    const agent = getAgent(body.agent);
    if (!agent) return jsonError(400, "invalid_request");
    if (!ALLOWED_MODELS.has(agent.model)) {
      console.error("model_not_allowed", { requestId: context?.requestId, agent: body.agent });
      return jsonError(500, "internal");
    }

    const client = getClient();
    const encoder = new TextEncoder();
    const send = (ctrl, data) =>
      ctrl.enqueue(encoder.encode(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`));

    const stream = new ReadableStream({
      async start(ctrl) {
        // 6. One deadline for the whole turn. Passed as the SDK request option `signal`, it also
        //    bounds the SDK's own retries; the client-level timeout is only per attempt.
        const signal = AbortSignal.timeout(Math.max(0, deadlineMs - (now() - startedAt)));
        try {
          const s = client.messages.stream({
            model: agent.model,
            max_tokens: 16000,                // covers thinking + text
            thinking: { type: "adaptive" },   // the only accepted type besides omitting it
            output_config: { effort: "low" }, // explicit; Opus 5.5 would default to "medium"
            system: agent.systemPrompt,       // stable prompt from agents.json, no timestamps
            messages: msgs.map(({ role, content }) => ({ role, content })),
            // no temperature/top_p/top_k (400 under 2026-10-21); no tool_choice other than auto
          }, { signal });
          for await (const ev of s) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              send(ctrl, { type: "text", delta: ev.delta.text });
            }
            // thinking_delta / signature_delta / ping / unknown event types are ignored on purpose
          }
          const final = await s.finalMessage();
          if (final.stop_reason === "refusal") {
            // The UI removes the partial bubble. Category/explanation are logged, not shown.
            console.warn("chat_refusal", { requestId: context?.requestId, category: final.stop_details?.category ?? null });
            send(ctrl, { type: "error", code: "refusal", message: "The agent declined this request. Try rephrasing it.", retryable: false });
          } else {
            send(ctrl, { type: "done", stopReason: final.stop_reason === "max_tokens" ? "max_tokens" : "end_turn" });
          }
        } catch (err) {
          const timedOut = signal.aborted;
          // Mid-stream `event: error` (e.g. overloaded_error) surfaces here with status undefined.
          console.error("chat_failed", { requestId: context?.requestId, timedOut, status: err?.status, type: err?.error?.error?.type });
          send(ctrl, timedOut
            ? { type: "error", code: "timeout", message: "The agent took too long. Try again.", retryable: true }
            : { type: "error", code: "upstream", message: "The agent is unavailable right now. Try again in a minute.", retryable: true });
        } finally {
          ctrl.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { ...BASE_HEADERS, "content-type": "text/event-stream; charset=utf-8" },
    });
  };
}

function jsonError(status, code, extra = {}) {
  return new Response(JSON.stringify({ error: { code, message: MESSAGES[code] ?? MESSAGES.internal } }), {
    status,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      ...extra,
    },
  });
}

// --- Production wiring (what netlify/functions/chat.mts would export) ---------------------
let client;
export default createChatHandler({
  // Replace with lib/auth's check (getClaims + iss/aud/is_anonymous/sub + profiles role, plus the
  // Origin check on POST). Until then: fail closed.
  guard: async () => ({ ok: false, status: 503, code: "unavailable" }),
  // Explicit endpoint and key: an injected ANTHROPIC_BASE_URL or AI-Gateway variable can't reroute.
  getClient: () => (client ??= new Anthropic({
    baseURL: "https://api.anthropic.com",
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 50_000,
    maxRetries: 1,
  })),
  getAgent: () => undefined,             // replace with a lookup in the bundled agents.json
});

export const config = {
  path: "/api/chat",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
