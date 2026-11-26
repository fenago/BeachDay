// Claude client + the agent turn loop (docs/05 §4–7, docs/04 §8–9; claude-api skill).
// - Endpoint and key are EXPLICIT (baseURL hard-coded, apiKey passed), so ANTHROPIC_BASE_URL or an AI-Gateway
//   variable can't reroute calls. The key is read only in createAnthropicClient(), after the production check.
// - Model must be one of SETTINGS.allowedModels (re-checked here; build-agents checks it too).
// - adaptive thinking, explicit effort, strict tools, tool_choice auto, no sampling params, no prefill.
// - System prompt cached (cache_control ephemeral); it carries no timestamps.
// - One deadline per turn as the request option `signal`, so SDK retries can't overrun it.
// - Refusals: stop_reason "refusal" -> discard the round, report error{code:"refusal"} (never done).
import Anthropic from "@anthropic-ai/sdk";
import { SETTINGS } from "./settings.mts";
import { TOOLS, type RunTool, type ToolUseBlock } from "./tools.mts";
import type { DoneReason, ErrorCode, SseEvent } from "./sse.mts";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const STREAM_MAX_TOKENS = 64_000;     // streaming: room for thinking + text (docs/05 §4)
export const MIN_ROUND_MS = 15_000;          // a new tool round starts only with ≥ 15 s left (docs/04 §8)
export const JOB_SDK_TIMEOUT_MS = 840_000;

export type Effort = "low" | "medium" | "high";
export const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 10;
const toolError = (id: string, content: string) => ({ type: "tool_result" as const, tool_use_id: id, content, is_error: true });

export class ModelNotAllowed extends Error {
  constructor() {
    super("model not on the Console allow-list");
    this.name = "ModelNotAllowed";
  }
}
export function assertAllowedModel(id: unknown): asserts id is string {
  if (typeof id !== "string" || !SETTINGS.allowedModels.includes(id)) throw new ModelNotAllowed();
}

/** chat: 50 s per attempt, 1 retry. job: 840 s, 2 retries (docs/04 §8). Call only in production. */
export function createAnthropicClient(kind: "chat" | "job", apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): Anthropic {
  if (!apiKey) throw new Error("Anthropic key is not configured");
  return new Anthropic({
    baseURL: ANTHROPIC_BASE_URL,
    apiKey,
    authToken: null, // a stray ANTHROPIC_AUTH_TOKEN env var is never sent (R2-S6)
    timeout: kind === "chat" ? SETTINGS.chatSdkTimeoutMs : JOB_SDK_TIMEOUT_MS,
    maxRetries: kind === "chat" ? 1 : 2,
  });
}

export interface AgentForCall { model: string; systemPrompt: string }

/** The exact request body. No temperature/top_p/top_k, no budget_tokens, no forced tool_choice. */
export function buildParams(agent: AgentForCall, messages: unknown[], effort: Effort, maxTokens = STREAM_MAX_TOKENS, tools: ReadonlyArray<unknown> = TOOLS) {
  assertAllowedModel(agent.model);
  return {
    model: agent.model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" as const },
    output_config: { effort },
    system: [{ type: "text" as const, text: agent.systemPrompt, cache_control: { type: "ephemeral" as const } }],
    tools: tools as unknown as Anthropic.Tool[],
    tool_choice: { type: "auto" as const },
    messages: messages as Anthropic.MessageParam[],
  };
}

// ---- Browser transcript: plain-text turns only (the browser never sends tool/thinking blocks) ----
export const MAX_TRANSCRIPT_TURNS = 200;
export function parseChatMessages(raw: unknown, maxUserBytes: number = SETTINGS.perTurn.maxUserMessageBytes): Array<{ role: "user" | "assistant"; content: string }> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRANSCRIPT_TURNS) return null;
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    const want = i % 2 === 0 ? "user" : "assistant";
    if (!m || typeof m !== "object" || m.role !== want || typeof m.content !== "string" || m.content.length === 0) return null;
    if (Object.keys(m).some((k) => k !== "role" && k !== "content")) return null;
    if (!m.content.isWellFormed()) return null;
    out.push({ role: want, content: m.content });
  }
  if (out.at(-1)!.role !== "user") return null; // no prefill
  if (Buffer.byteLength(out.at(-1)!.content, "utf8") > maxUserBytes) return null;
  return out;
}

// ---- Deadline: one per turn (chat 55 s) or per job (wall clock) ----
export interface Deadline { signal: AbortSignal; remainingMs(): number; canStartRound(): boolean }
export function createDeadline(totalMs: number, startedAt: number, now: () => number = Date.now, minRoundMs = MIN_ROUND_MS): Deadline {
  const remainingMs = () => Math.max(0, totalMs - (now() - startedAt));
  return {
    signal: AbortSignal.timeout(Math.max(1, remainingMs())),
    remainingMs,
    canStartRound: () => remainingMs() >= minRoundMs,
  };
}

// ---- The loop ----
export interface Usage { tokens: number; rounds: number }
/** A token counter shared by a team turn: Kai and every expert it consults add to ONE meter (team_plan R-3). */
export interface TokenMeter { tokens: number }
/** Tools whose calls in one round run concurrently (consult_expert), at most `limit` at a time; others stay serial. */
export interface ParallelTools { names: ReadonlySet<string>; limit: number }
export type TurnOutcome =
  | { kind: "done"; stopReason: DoneReason }
  | { kind: "error"; code: ErrorCode }
  | { kind: "handoff" }; // out of time: save messages + turn state, continue in /api/jobs-run (paused for a job)

export interface TurnResult { outcome: TurnOutcome; messages: unknown[]; usage: Usage }

export interface RunTurnDeps {
  client: Pick<Anthropic, "messages">;
  agent: AgentForCall;
  messages: unknown[];               // full conversation; may hold tool_use/tool_result/thinking blocks (server state)
  runTool: RunTool;
  emit: (ev: SseEvent) => void;      // text/tool/proposal events; terminal events are the caller's
  effort: Effort;
  deadline: Deadline;
  usage?: Usage;                     // carried in when a job resumes
  maxRounds?: number;
  maxTokens?: number;
  maxToolCallsPerRound?: number;     // R2-2: default SETTINGS.perTurn.maxToolCallsPerRound, else 10
  log?: (msg: string, data: object) => void;
  tools?: ReadonlyArray<unknown>;    // this agent's tool definitions (default TOOLS; the team lead: lib/team.mts)
  meter?: TokenMeter;                // shared token meter (team turns); default: this turn's own count
  parallel?: ParallelTools;          // default: every tool runs serially
}

/** Run fn over items with at most `limit` in flight; results keep the input order. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

const sumUsage = (u: any): number =>
  (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);

export async function runTurn(d: RunTurnDeps): Promise<TurnResult> {
  const log = d.log ?? ((m, x) => console.error(JSON.stringify({ msg: m, ...x })));
  const maxRounds = d.maxRounds ?? SETTINGS.perTurn.maxToolRounds;
  // Known limit (R2-S7): the token cap is checked between rounds, so a turn can overshoot by one round.
  const maxTokens = d.maxTokens ?? SETTINGS.perTurn.maxTokens;
  const maxCalls = d.maxToolCallsPerRound ?? SETTINGS.perTurn.maxToolCallsPerRound ?? DEFAULT_MAX_TOOL_CALLS_PER_ROUND;
  const rounds = { n: d.usage?.rounds ?? 0 };
  // Tokens go to the shared meter when one is given (a team turn), else to this turn's own count.
  const meter: TokenMeter = d.meter ?? { tokens: d.usage?.tokens ?? 0 };
  const snapshot = (): Usage => ({ tokens: meter.tokens, rounds: rounds.n });
  const convo = [...d.messages];
  try {
    assertAllowedModel(d.agent.model);
  } catch {
    log("model_not_allowed", {});
    return { outcome: { kind: "error", code: "internal" }, messages: convo, usage: snapshot() };
  }

  for (;;) {
    if (rounds.n >= maxRounds) return { outcome: { kind: "done", stopReason: "tool_rounds_exhausted" }, messages: convo, usage: snapshot() };
    if (meter.tokens >= maxTokens) return { outcome: { kind: "done", stopReason: "max_tokens" }, messages: convo, usage: snapshot() };
    if (!d.deadline.canStartRound()) return { outcome: { kind: "handoff" }, messages: convo, usage: snapshot() };

    let final: any;
    try {
      const stream = d.client.messages.stream(buildParams(d.agent, convo, d.effort, STREAM_MAX_TOKENS, d.tools ?? TOOLS), { signal: d.deadline.signal });
      for await (const ev of stream as AsyncIterable<any>) {
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
          d.emit({ type: "text", delta: ev.delta.text });
        }
        // thinking/signature/input_json deltas, ping and unknown events are dropped on purpose
      }
      final = await stream.finalMessage();
    } catch (err: any) {
      if (d.deadline.signal.aborted) {
        log("claude_deadline", { rounds: rounds.n });
        return { outcome: { kind: "error", code: "timeout" }, messages: convo, usage: snapshot() };
      }
      // Log status, type and request id only; never prompts, bodies or keys.
      log("claude_failed", { status: err?.status ?? null, type: err?.error?.error?.type ?? err?.name ?? null, requestId: err?.requestID ?? err?.request_id ?? null });
      return { outcome: { kind: "error", code: "upstream" }, messages: convo, usage: snapshot() };
    }

    meter.tokens += sumUsage(final?.usage);
    const stop = final?.stop_reason;
    const content = Array.isArray(final?.content) ? final.content : [];

    if (stop === "refusal") {
      // Discard this round; the caller resets the turn. Category is logged, never shown.
      log("claude_refusal", { category: final?.stop_details?.category ?? null });
      return { outcome: { kind: "error", code: "refusal" }, messages: convo, usage: snapshot() };
    }
    if (stop === "tool_use") {
      convo.push({ role: "assistant", content }); // unchanged, thinking blocks included
      const calls = content.filter((b: any) => b?.type === "tool_use") as ToolUseBlock[];
      // Every tool_use still gets exactly one tool_result; capped or late calls never reach GitHub or Claude.
      const runOne = async (call: ToolUseBlock, i: number) => {
        if (i >= maxCalls) return toolError(call.id, `too many tool calls in one round (at most ${maxCalls}); ask again for the rest`);
        if (!d.deadline.canStartRound()) return toolError(call.id, "out of time for this turn; not run");
        return d.runTool(call);
      };
      const results: unknown[] = new Array(calls.length);
      const par = d.parallel;
      const isPar = (c: ToolUseBlock) => !!par && par.names.has(c.name);
      const parIdx = calls.map((c, i) => i).filter((i) => isPar(calls[i]));
      const serial = (async () => {
        for (let i = 0; i < calls.length; i++) if (!isPar(calls[i])) results[i] = await runOne(calls[i], i); // serial (GitHub)
      })();
      const parallel = mapLimited(parIdx, par?.limit ?? 1, async (i) => { results[i] = await runOne(calls[i], i); });
      await Promise.all([serial, parallel]);
      convo.push({ role: "user", content: results }); // all results in tool_use order, one message, results only
      rounds.n += 1;
      continue;
    }
    convo.push({ role: "assistant", content });
    if (stop === "max_tokens" || stop === "model_context_window_exceeded") {
      // A tool_use cut off here may be truncated: it is never run.
      return { outcome: { kind: "done", stopReason: "max_tokens" }, messages: convo, usage: snapshot() };
    }
    if (meter.tokens > maxTokens) return { outcome: { kind: "done", stopReason: "max_tokens" }, messages: convo, usage: snapshot() };
    return { outcome: { kind: "done", stopReason: "end_turn" }, messages: convo, usage: snapshot() };
  }
}

/** True when the conversation can be sent to Claude again as-is (ends with a user turn). */
export const canResume = (messages: unknown[]): boolean => (messages.at(-1) as any)?.role === "user";
