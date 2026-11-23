// Server-sent events for POST /api/chat, exactly the docs/04 §2.1 events: text, tool, proposal, handoff, error, done.
// Every stream ends with exactly ONE `done` or `error`. A refusal is error{code:"refusal",retryable:false}, never done.
// Raw Anthropic events, thinking blocks, signatures and upstream error bodies never reach the browser.
import { sseHeaders, ERROR_CODES as HTTP_ERROR_CODES } from "./http.mts";

export type ToolName = "read_file" | "list_files" | "propose_change";
export type DoneReason = "end_turn" | "max_tokens" | "handoff" | "tool_rounds_exhausted";
export type ErrorCode =
  | "invalid_request" | "unauthorized" | "step_up_required" | "forbidden" | "not_found" | "conflict" | "stale"
  | "rate_limited" | "budget_exhausted" | "approve_cap" | "refusal" | "upstream" | "timeout" | "unavailable" | "internal";

export type SseEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: ToolName; phase: "start" | "end"; summary?: string }
  | { type: "proposal"; proposalId: string; summary: string; files: Array<{ path: string; bytes: number }> }
  | { type: "handoff"; jobId: string }
  | { type: "error"; code: ErrorCode; message: string; retryable: boolean }
  | { type: "done"; stopReason?: DoneReason };

const TOOL_NAMES = new Set(["read_file", "list_files", "propose_change"]);
const DONE_REASONS = new Set(["end_turn", "max_tokens", "handoff", "tool_rounds_exhausted"]);
const ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(HTTP_ERROR_CODES)); // one list (docs/04 §2.1)
export const MAX_TEXT_DELTA = 8192;

/** User-safe default copy per code (Wren may override in the UI). Never upstream text. */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  invalid_request: "That message couldn't be sent.",
  unauthorized: "Your session ended. Sign in again.",
  step_up_required: "Confirm it's you to continue.",
  forbidden: "This account can't use Agents.",
  not_found: "That item no longer exists.",
  conflict: "This changed while you were looking. Reload it.",
  stale: "Out of date: main changed after this proposal.",
  rate_limited: "You've reached today's limit. Try again later.",
  budget_exhausted: "The Console's compute budget is used up for now.",
  approve_cap: "The approval limit is reached.",
  refusal: "The agent declined this request. Try rephrasing it.",
  upstream: "The agent is unavailable right now. Try again in a minute.",
  timeout: "The agent took too long. Try again.",
  unavailable: "Couldn't check your access. Try again in a minute.",
  internal: "Something went wrong on our side.",
});
const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["upstream", "timeout", "unavailable", "internal"]);

export function errorEvent(code: ErrorCode, message?: string): SseEvent {
  return { type: "error", code, message: (message ?? ERROR_MESSAGES[code]).slice(0, 500), retryable: RETRYABLE.has(code) };
}

/** Throws on anything outside the §2.1 contract, so a bug can't leak a raw object to the browser. */
export function assertEvent(ev: SseEvent): void {
  const e = ev as any;
  switch (e?.type) {
    case "text":
      if (typeof e.delta !== "string" || e.delta.length > MAX_TEXT_DELTA) throw new Error("sse: bad text");
      return;
    case "tool":
      if (!TOOL_NAMES.has(e.name) || (e.phase !== "start" && e.phase !== "end")) throw new Error("sse: bad tool");
      if (e.summary !== undefined && (typeof e.summary !== "string" || e.summary.length > 200)) throw new Error("sse: bad tool summary");
      return;
    case "proposal":
      if (!/^p_[0-9A-Z]{26}$/.test(e.proposalId) || typeof e.summary !== "string" || !Array.isArray(e.files) || e.files.length < 1 || e.files.length > 20) throw new Error("sse: bad proposal");
      return;
    case "handoff":
      if (!/^j_[0-9A-Z]{26}$/.test(e.jobId)) throw new Error("sse: bad handoff");
      return;
    case "error":
      if (!ERROR_CODES.has(e.code) || typeof e.message !== "string" || e.message.length > 500 || typeof e.retryable !== "boolean") throw new Error("sse: bad error");
      return;
    case "done":
      if (e.stopReason !== undefined && !DONE_REASONS.has(e.stopReason)) throw new Error("sse: bad done");
      return;
    default:
      throw new Error("sse: unknown event type");
  }
}

/** One SSE message: `event: <type>` + one `data:` JSON line. JSON escapes newlines, so one line always. */
export function encodeEvent(ev: SseEvent): string {
  assertEvent(ev);
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

/** Split a long text delta so each event stays under the 8 KB contract limit (code-point safe). */
export function textEvents(text: string): SseEvent[] {
  const cps = [...text];
  const out: SseEvent[] = [];
  for (let i = 0; i < cps.length; i += 4096) out.push({ type: "text", delta: cps.slice(i, i + 4096).join("") });
  return out;
}

export interface SseWriter {
  send(ev: SseEvent): void;          // non-terminal events; ignored after the terminal one
  done(stopReason?: DoneReason): void;
  error(code: ErrorCode, message?: string): void;
  readonly closed: boolean;
}

/**
 * Builds the streaming Response. `run` gets a writer; whatever happens, the stream ends with exactly one
 * terminal event: if `run` returns without one, `done{end_turn}` is NOT assumed — an `internal` error is sent,
 * because a missing terminal event is a bug. A throw becomes `internal` (logged without details).
 */
const FORBIDDEN_HEADER = /^(access-control-|set-cookie$)/i;

/** Caller headers first, security headers LAST (they can't be overridden); CORS and cookies throw (R2-4). */
export function sseResponseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  for (const k of Object.keys(extra)) if (FORBIDDEN_HEADER.test(k)) throw new Error(`forbidden response header: ${k}`);
  const lower = Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v]));
  return { ...lower, ...sseHeaders(), "content-type": "text/event-stream; charset=utf-8" };
}

export function sseResponse(
  run: (w: SseWriter) => Promise<void>,
  log: (msg: string, data: object) => void = (m, d) => console.error(JSON.stringify({ msg: m, ...d })),
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = sseResponseHeaders(extraHeaders);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let terminal = false;
      let open = true;
      const write = (ev: SseEvent) => {
        if (!open) return;
        try {
          ctrl.enqueue(enc.encode(encodeEvent(ev)));
        } catch (e) {
          log("sse_drop", { type: (ev as any)?.type, reason: (e as Error)?.message });
        }
      };
      const writer: SseWriter = {
        send(ev) {
          if (terminal) return;
          if (ev.type === "done" || ev.type === "error") throw new Error("use done()/error() for terminal events");
          if (ev.type === "text" && ev.delta.length > MAX_TEXT_DELTA) textEvents(ev.delta).forEach(write);
          else write(ev);
        },
        done(stopReason) {
          if (terminal) return;
          terminal = true;
          write(stopReason ? { type: "done", stopReason } : { type: "done" });
        },
        error(code, message) {
          if (terminal) return;
          terminal = true;
          write(errorEvent(code, message));
        },
        get closed() {
          return terminal;
        },
      };
      try {
        await run(writer);
        if (!terminal) {
          log("sse_no_terminal", {});
          writer.error("internal");
        }
      } catch (e) {
        log("sse_run_failed", { name: (e as Error)?.name });
        writer.error("internal");
      } finally {
        open = false;
        ctrl.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers });
}

/** Parse an SSE body back into events (tests and the harness). */
export function parseSse(body: string): Array<{ event: string; data: any }> {
  return body
    .split("\n\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "";
      const data = lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "null";
      return { event, data: JSON.parse(data) };
    });
}
