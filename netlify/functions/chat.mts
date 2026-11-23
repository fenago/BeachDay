// POST /api/chat: one streaming chat turn (docs/04 §1 step 3, §2.1, §8, §9; build-contracts §2.2).
// Order: method -> guard -> Origin -> production (before any secret) -> body (<= 64 KB before parse) -> shape ->
// agent + model -> limits (compute budget read-only, then the per-user daily counter) -> client + reader -> stream.
// Failures before the stream opens are JSON with the HTTP status; after it opens, exactly one SSE error or done.
// Out of time: the conversation (tool and thinking blocks included) moves to a background job: handoff, then done.
import type { Config } from "@netlify/functions";
import type Anthropic from "@anthropic-ai/sdk";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { realStores, type Stores } from "./lib/blobs.mts";
import { SETTINGS } from "./lib/settings.mts";
import { error } from "./lib/http.mts";
import { loadAgentRegistry, type AgentRegistry } from "./lib/agents.mts";
import { createAnthropicClient, createDeadline, parseChatMessages, runTurn, assertAllowedModel } from "./lib/claude.mts";
import { githubReadFromEnv, type GitHubRead } from "./lib/github-read.mts";
import { sseResponse } from "./lib/sse.mts";
import { createToolRunner, newTurnState } from "./lib/tools.mts";
import { writeAudit } from "./lib/proposals.mts";
import { hit, windowKey, checkComputeBudget, recordCompute, nextLocalMidnight } from "./lib/limits.mts";
import { launchJob, createStartJob, type StartJob } from "./lib/jobs.mts";
import {
  authorize, methodNotAllowed, isProduction, notProduction, badRequest, readJson, isPlainObject, onlyKeys,
  unavailable, internal, logLine, MAX_JSON_BODY, type Ctx, type Settings, safe } from "./lib/handler.mts";

const ROUTE = "POST /api/chat";
const AGENT_RE = /^[a-z][a-z0-9-]{1,63}$/;
const MAX_MESSAGES = 99; // chat-request schema

export interface ChatDeps {
  guard: Guard;
  stores: Stores;
  registry: () => Promise<AgentRegistry>;
  settings: Settings;
  getClient: () => Pick<Anthropic, "messages">;
  getReader: (o: { signal: AbortSignal }) => GitHubRead;
  startJob: StartJob;
  now: () => number;
}

export function createChatHandler(deps: ChatDeps) {
  return safe(ROUTE, async function chat(req: Request, context: Ctx): Promise<Response> {
    const startedAt = deps.now();
    const requestId = context?.requestId;
    if (req.method !== "POST") return methodNotAllowed("POST");
    const g = await authorize(deps.guard, req, ROUTE, requestId);
    if (g instanceof Response) return g;
    if (!isProduction(context)) return notProduction();
    const S = deps.settings;

    // Body: size before parse, then shape. Plain-text turns only (the browser never sends tool/thinking blocks).
    const body = await readJson(req, MAX_JSON_BODY);
    if (!body.ok || !isPlainObject(body.value) || !onlyKeys(body.value, ["agent", "messages"])) return badRequest("That message couldn't be sent.");
    const { agent: agentName, messages: rawMessages } = body.value;
    if (typeof agentName !== "string" || !AGENT_RE.test(agentName)) return badRequest("Unknown agent.");
    if (!Array.isArray(rawMessages) || rawMessages.length > MAX_MESSAGES) return badRequest("That message couldn't be sent.");
    const messages = parseChatMessages(rawMessages, S.perTurn.maxUserMessageBytes);
    if (!messages) return badRequest("That message couldn't be sent.");

    let agent;
    try {
      agent = (await deps.registry()).get(agentName);
    } catch {
      return internal();
    }
    if (!agent) return badRequest("Unknown agent.");
    try {
      assertAllowedModel(agent.model);
    } catch {
      logLine({ msg: "model_not_allowed", route: ROUTE, requestId, agent: agentName });
      return internal(); // never reaches Claude (docs/04 §8)
    }

    // Limits (docs/04 §9). The compute check is read-only, so a 429 budget_exhausted doesn't use a daily turn.
    const now = new Date(deps.now());
    try {
      const budget = await checkComputeBudget(deps.stores.ratelimit, S.computeNeedChatMs, now, { windowMinutes: S.computeBudgetMinutes });
      if (!budget.allowed) return error(429, "budget_exhausted", "The Console's compute budget is used up for now.", { retryAt: budget.retryAt ?? nextLocalMidnight(now).toISOString() });
      const daily = await hit(deps.stores.ratelimit, windowKey(g.userId, "chat", now), S.perUserDaily.chat);
      if (!daily.allowed) return error(429, "rate_limited", "You've reached today's chat limit.", { retryAt: nextLocalMidnight(now).toISOString() });
    } catch {
      return unavailable(); // unreadable limit record: fail closed
    }

    // Secrets are read only now, after the production check. One deadline bounds Claude AND GitHub reads (R2-2).
    const deadline = createDeadline(S.chatDeadlineMs, startedAt, deps.now);
    let client: Pick<Anthropic, "messages">;
    let reader: GitHubRead;
    try {
      client = deps.getClient();
      reader = deps.getReader({ signal: deadline.signal });
    } catch {
      logLine({ msg: "chat_not_configured", route: ROUTE, requestId });
      return unavailable();
    }

    const authorization = req.headers.get("authorization") ?? "";
    const origin = new URL(req.url).origin;
    const auditAt = () => new Date(deps.now());

    return sseResponse(async (w) => {
      try {
        const state = newTurnState();
        const runTool = createToolRunner({
          reader, proposals: deps.stores.proposals, agent: agent.name, state, emit: (ev) => w.send(ev),
          now: auditAt, policy: { denyConsoleUi: S.denyConsoleUi }, createdBy: g.userId,
          onProposal: (p) => writeAudit(deps.stores.audit, { action: "proposed", actor: g.userId, proposalId: p.id, requestId }, auditAt()).catch(() => {}),
        });
        const result = await runTurn({
          client, agent, messages, runTool, emit: (ev) => w.send(ev), effort: "low", deadline,
          maxRounds: S.perTurn.maxToolRounds, maxTokens: S.perTurn.maxTokens, maxToolCallsPerRound: S.perTurn.maxToolCallsPerRound,
        });
        const o = result.outcome;
        if (o.kind === "done") return w.done(o.stopReason);
        if (o.kind === "error") return w.error(o.code); // refusal: error{refusal}, never done
        // Hand-off: same limits as a new job; the browser never holds tool state.
        const launched = await launchJob(deps, {
          owner: g.userId, agent: agent.name, messages: result.messages, baseSha: state.baseSha, readShas: state.readShas,
          usage: result.usage, authorization, origin,
        });
        if (!launched.ok) return w.error(launched.code);
        w.send({ type: "handoff", jobId: launched.jobId });
        w.done("handoff");
      } finally {
        await recordCompute(deps.stores.ratelimit, deps.now() - startedAt, new Date(deps.now())).catch(() => logLine({ msg: "compute_record_failed", route: ROUTE, requestId }));
      }
    });
  });
}

export function realDeps(): ChatDeps {
  let client: Anthropic | undefined;
  return {
    guard: guardFromEnv(),
    stores: realStores(),
    registry: loadAgentRegistry,
    settings: SETTINGS,
    getClient: () => (client ??= createAnthropicClient("chat")),
    getReader: ({ signal }) => githubReadFromEnv({ signal }),
    startJob: createStartJob(),
    now: Date.now,
  };
}

export default createChatHandler(realDeps());

export const config: Config = {
  path: "/api/chat",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
