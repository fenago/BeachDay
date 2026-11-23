// POST /api/jobs-run (background, <= 15 min): runs one agent job and writes progress to Blobs (docs/04 §2, §8).
// It always answers 202 (Netlify discards the return value), so it NEVER trusts its caller:
//   guard (forwarded Bearer + super_admin) -> Origin -> production -> body {jobId, nonce} -> claim by CAS
//   (queued -> running, owner === sub, sha256(nonce) === nonceHash; the nonce hash is cleared, so it is single-use).
// Any refusal returns silently: no Blobs write (and before the claim's read, no Blobs read either).
// Idempotent: a Netlify retry finds the job already claimed and exits. It never commits: only Approve does.
import type { Config } from "@netlify/functions";
import type Anthropic from "@anthropic-ai/sdk";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { checkOrigin } from "./lib/origin.mts";
import { realStores, type Stores } from "./lib/blobs.mts";
import { SETTINGS } from "./lib/settings.mts";
import { loadAgentRegistry, type AgentRegistry } from "./lib/agents.mts";
import { createAnthropicClient, createDeadline, runTurn, assertAllowedModel, type Usage } from "./lib/claude.mts";
import { githubReadFromEnv, type GitHubRead } from "./lib/github-read.mts";
import { createToolRunner } from "./lib/tools.mts";
import { textEvents, errorEvent, type SseEvent, type ErrorCode } from "./lib/sse.mts";
import { writeAudit } from "./lib/proposals.mts";
import { checkComputeBudget, recordCompute } from "./lib/limits.mts";
import { isJobId } from "./lib/ids.mts";
import { updateJob, appendEvents, nonceMatches, type JobRecord, type JobStatus } from "./lib/jobs.mts";
import { isProduction, readJson, isPlainObject, onlyKeys, logLine, MAX_SMALL_BODY, type Ctx, type Settings } from "./lib/handler.mts";

const ROUTE = "POST /api/jobs-run";
const accepted = (): Response => new Response(null, { status: 202, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export interface JobRunDeps {
  guard: Guard;
  stores: Stores;
  registry: () => Promise<AgentRegistry>;
  settings: Settings;
  getClient: () => Pick<Anthropic, "messages">;
  getReader: (o: { signal: AbortSignal }) => GitHubRead;
  now: () => number;
}

export function createJobRunHandler(deps: JobRunDeps) {
  return async function jobRun(req: Request, context: Ctx): Promise<Response> {
    const requestId = context?.requestId;
    const quiet = (why: string) => { logLine({ msg: "job_run_refused", route: ROUTE, requestId, why }); return accepted(); };
    if (req.method !== "POST") return quiet("method");
    let g;
    try { g = await deps.guard.check(req, { route: ROUTE, requestId }); } catch { return quiet("guard_exception"); }
    if (!g.ok) return quiet("guard");
    if (!checkOrigin(req).ok) return quiet("origin");
    if (!isProduction(context)) return quiet("not_production");
    const body = await readJson(req, MAX_SMALL_BODY);
    if (!body.ok || !isPlainObject(body.value) || !onlyKeys(body.value, ["jobId", "nonce"])) return quiet("body");
    const { jobId, nonce } = body.value;
    if (!isJobId(jobId) || typeof nonce !== "string") return quiet("body");

    const S = deps.settings;
    const startedAt = deps.now();
    const iso = () => new Date(deps.now()).toISOString();
    const jobs = deps.stores.jobs;

    // Claim exactly once. A wrong nonce, another owner, or a retry of a claimed job writes nothing.
    let claimed: JobRecord;
    try {
      const c = await updateJob(jobs, jobId, (j) => (j.status === "queued" && j.owner === g.userId && nonceMatches(nonce, j.nonceHash)
        ? { ...j, status: "running", nonceHash: null, startedAt: iso(), updatedAt: iso() }
        : null));
      if (!c.ok) return quiet(`claim_${c.reason}`);
      claimed = c.job;
    } catch {
      return quiet("claim_unavailable");
    }

    // From here every outcome is written to the job record.
    let pending: SseEvent[] = [];
    let text = "";
    let proposalId: string | null = claimed.proposalId ?? null;
    let lastComputeAt = startedAt;
    let queue: Promise<unknown> = Promise.resolve();
    const flushText = () => { if (text) { pending.push(...textEvents(text)); text = ""; } };
    const recordElapsed = async () => {
      const t = deps.now();
      const ms = t - lastComputeAt;
      lastComputeAt = t;
      await recordCompute(deps.stores.ratelimit, ms, new Date(t)).catch(() => logLine({ msg: "compute_record_failed", route: ROUTE, requestId, jobId }));
    };
    const persist = (patch: Partial<JobRecord> = {}) => {
      flushText();
      const add = pending;
      pending = [];
      queue = queue.then(async () => {
        await updateJob(jobs, jobId, (j) => ({ ...j, ...patch, proposalId, events: appendEvents(j.events ?? [], add), updatedAt: iso() }));
        await recordElapsed(); // compute is recorded at each progress write, new milliseconds only
      }).catch(() => logLine({ msg: "job_progress_write_failed", route: ROUTE, requestId, jobId }));
      return queue;
    };
    const finish = async (status: JobStatus, terminal: SseEvent | null, patch: Partial<JobRecord> = {}) => {
      if (terminal) pending.push(terminal);
      await persist({ ...patch, status });
    };
    const fail = (code: ErrorCode) => finish("failed", errorEvent(code));

    try {
      const agent = (await deps.registry()).get(claimed.agent);
      if (!agent) return (await fail("internal"), accepted());
      try { assertAllowedModel(agent.model); } catch { return (await fail("internal"), accepted()); }

      // Wall clock = min(14 min, compute budget left) (docs/04 §9). Unreadable record: fail closed.
      let wallMs = S.jobWallClockMs;
      try {
        const b = await checkComputeBudget(deps.stores.ratelimit, S.computeNeedJobMs, new Date(startedAt), { windowMinutes: S.computeBudgetMinutes });
        if (!b.allowed) return (await fail("budget_exhausted"), accepted());
        wallMs = Math.min(wallMs, b.remainingMs);
      } catch {
        return (await fail("unavailable"), accepted());
      }
      const deadline = createDeadline(wallMs, startedAt, deps.now);
      let client: Pick<Anthropic, "messages">;
      let reader: GitHubRead;
      try {
        client = deps.getClient();
        reader = deps.getReader({ signal: deadline.signal });
      } catch {
        return (await fail("unavailable"), accepted());
      }

      const state = { baseSha: claimed.baseSha ?? null, readShas: { ...(claimed.readShas ?? {}) } };
      const emit = (ev: SseEvent) => {
        if (ev.type === "text") { text += ev.delta; return; } // stored per finished block, not per token
        pending.push(ev);
        if (ev.type === "tool" && ev.phase === "end") persist(); // progress after each tool call
      };
      const runTool = createToolRunner({
        reader, proposals: deps.stores.proposals, agent: agent.name, state, now: () => new Date(deps.now()),
        policy: { denyConsoleUi: S.denyConsoleUi }, createdBy: g.userId,
        emit: (ev) => { flushText(); emit(ev); },
        onProposal: async (p) => {
          proposalId = p.id;
          await writeAudit(deps.stores.audit, { action: "proposed", actor: g.userId, proposalId: p.id, jobId, requestId }, new Date(deps.now())).catch(() => {});
        },
      });
      const usage: Usage = claimed.usage ?? { tokens: 0, rounds: 0 };
      const r = await runTurn({
        client, agent, messages: claimed.messages, runTool, emit, effort: "high", deadline, usage,
        maxRounds: S.perTurn.maxToolRounds, maxTokens: S.perTurn.maxTokens, maxToolCallsPerRound: S.perTurn.maxToolCallsPerRound,
      });
      const save = { messages: r.messages, usage: r.usage, readShas: state.readShas, baseSha: state.baseSha };
      const o = r.outcome;
      if (o.kind === "error") await finish("failed", errorEvent(o.code), save);             // refusal ends `failed`
      else if (o.kind === "handoff") await finish("paused", null, save);                     // wall clock: Continue later
      else if (o.stopReason === "end_turn") await finish("done", { type: "done", stopReason: "end_turn" }, save);
      else await finish("paused", { type: "done", stopReason: o.stopReason }, save);         // a cap: Continue later
    } catch {
      logLine({ msg: "job_run_failed", route: ROUTE, requestId, jobId });
      await fail("internal").catch(() => {});
    }
    await queue;
    return accepted();
  };
}

export function realDeps(): JobRunDeps {
  let client: Anthropic | undefined;
  return {
    guard: guardFromEnv(),
    stores: realStores(),
    registry: loadAgentRegistry,
    settings: SETTINGS,
    getClient: () => (client ??= createAnthropicClient("job")),
    getReader: ({ signal }) => githubReadFromEnv({ signal }),
    now: Date.now,
  };
}

export default createJobRunHandler(realDeps());

export const config: Config = { path: "/api/jobs-run", method: "POST", background: true };
