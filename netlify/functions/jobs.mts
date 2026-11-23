// POST /api/jobs: start a background agent job (docs/04 §2, §8, §9; build-contracts §2.2, R13). Answers 202 {jobId}.
// Sync wrapper only: guard, Origin, body, limits, the job record with a single-use nonce (hash stored), then it
// starts /api/jobs-run with the caller's Authorization. It reads no secret, so there is no production check here;
// job-run has it.
// Continue (R13, security-engineer): isJobId(continueFrom) BEFORE any Blobs read (else 400); 404 unless the job
// exists AND owner === sub; 409 unless status is "paused"; it is a NEW job (daily limit + compute budget, fresh
// nonce); the conversation comes ONLY from the server-stored messages; baseSha and readShas carry over (ADR-0007).
import type { Config } from "@netlify/functions";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { realStores, type Stores } from "./lib/blobs.mts";
import { SETTINGS } from "./lib/settings.mts";
import { error, json } from "./lib/http.mts";
import { loadAgentRegistry, type AgentRegistry } from "./lib/agents.mts";
import { parseChatMessages, canResume } from "./lib/claude.mts";
import { isJobId } from "./lib/ids.mts";
import { launchJob, createStartJob, updateJob, type StartJob, type JobRecord } from "./lib/jobs.mts";
import {
  authorize, methodNotAllowed, badRequest, readJson, isPlainObject, onlyKeys, unavailable, internal,
  MAX_JSON_BODY, type Ctx, type Settings,
} from "./lib/handler.mts";

const ROUTE = "POST /api/jobs";
const AGENT_RE = /^[a-z][a-z0-9-]{1,63}$/;
const MAX_MESSAGES = 99;
/** A paused conversation that ends on an assistant turn is resumed with a user turn, never a prefill (docs/05). */
export const CONTINUE_TEXT = "Your previous work was paused. Continue from where you left off.";

export interface JobsDeps { guard: Guard; stores: Stores; registry: () => Promise<AgentRegistry>; settings: Settings; startJob: StartJob; now: () => number }

export function createJobsHandler(deps: JobsDeps) {
  return async function jobs(req: Request, context: Ctx): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed("POST");
    const g = await authorize(deps.guard, req, ROUTE, context?.requestId);
    if (g instanceof Response) return g;

    const body = await readJson(req, MAX_JSON_BODY);
    if (!body.ok || !isPlainObject(body.value)) return badRequest();
    const b = body.value;

    let agent: string;
    let messages: unknown[];
    let baseSha: string | null = null;
    let readShas: Record<string, string> = {};

    if ("continueFrom" in b) {
      if (!onlyKeys(b, ["continueFrom"]) || !isJobId(b.continueFrom)) return badRequest(); // before any Blobs read
      let prev: JobRecord | null;
      try {
        prev = ((await deps.stores.jobs.getWithMetadata(b.continueFrom, { type: "json" }))?.data as JobRecord) ?? null;
      } catch {
        return unavailable();
      }
      if (!prev || prev.owner !== g.userId) return error(404, "not_found", "That job no longer exists."); // no existence oracle
      if (prev.status !== "paused" || prev.continuedBy) return error(409, "conflict", "Only a paused job can be continued.");
      agent = prev.agent;
      messages = Array.isArray(prev.messages) ? [...prev.messages] : [];
      if (messages.length === 0) return error(409, "conflict", "That job has nothing to continue.");
      if (!canResume(messages)) messages.push({ role: "user", content: CONTINUE_TEXT });
      baseSha = prev.baseSha ?? null;
      readShas = prev.readShas ?? {};
    } else {
      if (!onlyKeys(b, ["agent", "messages"])) return badRequest();
      if (typeof b.agent !== "string" || !AGENT_RE.test(b.agent)) return badRequest("Unknown agent.");
      if (!Array.isArray(b.messages) || b.messages.length > MAX_MESSAGES) return badRequest();
      const parsed = parseChatMessages(b.messages, deps.settings.perTurn.maxUserMessageBytes);
      if (!parsed) return badRequest();
      agent = b.agent;
      messages = parsed;
    }
    try {
      if (!(await deps.registry()).get(agent)) return badRequest("Unknown agent.");
    } catch {
      return internal();
    }

    // Continue claims the paused job once (CAS), so two clicks can't fork one conversation into two jobs.
    const from = typeof b.continueFrom === "string" ? b.continueFrom : null;
    if (from) {
      const claim = await updateJob(deps.stores.jobs, from, (j) => (j.status === "paused" && !j.continuedBy && j.owner === g.userId ? { ...j, continuedBy: "pending" } : null)).catch(() => null);
      if (!claim) return unavailable();
      if (!claim.ok) return error(409, "conflict", "Only a paused job can be continued.");
    }
    const launched = await launchJob(deps, {
      owner: g.userId, agent, messages, baseSha, readShas,
      authorization: req.headers.get("authorization") ?? "", origin: new URL(req.url).origin,
    });
    if (from) {
      const mark = launched.ok ? launched.jobId : undefined;
      await updateJob(deps.stores.jobs, from, (j) => (j.continuedBy === "pending" ? { ...j, continuedBy: mark } : null)).catch(() => {});
    }
    if (launched.ok) return json(202, { jobId: launched.jobId });
    if (launched.code === "rate_limited") return error(429, "rate_limited", "You've reached today's job limit.", { retryAt: launched.retryAt });
    if (launched.code === "budget_exhausted") return error(429, "budget_exhausted", "The Console's compute budget is used up for now.", { retryAt: launched.retryAt });
    if (launched.code === "upstream") return error(502, "upstream", "The job couldn't start. Try again in a minute.");
    return unavailable();
  };
}

export function realDeps(): JobsDeps {
  return { guard: guardFromEnv(), stores: realStores(), registry: loadAgentRegistry, settings: SETTINGS, startJob: createStartJob(), now: Date.now };
}

export default createJobsHandler(realDeps());

export const config: Config = {
  path: "/api/jobs",
  method: "POST",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
