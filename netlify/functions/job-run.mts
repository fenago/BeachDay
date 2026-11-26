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
import { createAnthropicClient, createDeadline, runTurn, assertAllowedModel, type Usage, type ParallelTools } from "./lib/claude.mts";
import { githubReadFromEnv, type GitHubRead } from "./lib/github-read.mts";
import { createToolRunner, TOOLS, type RunTool } from "./lib/tools.mts";
import { createTeamRunner } from "./lib/team.mts";
import { textEvents, errorEvent, type SseEvent, type ErrorCode } from "./lib/sse.mts";
import { writeAudit } from "./lib/proposals.mts";
import { checkComputeBudget, recordCompute } from "./lib/limits.mts";
import { isJobId } from "./lib/ids.mts";
import { updateJob, appendEvents, nonceMatches, type JobRecord, type JobStatus } from "./lib/jobs.mts";
import { isProduction, readJson, isPlainObject, onlyKeys, logLine, MAX_SMALL_BODY, type Ctx, type Settings, safe } from "./lib/handler.mts";

const ROUTE = "POST /api/jobs-run";

/**
 * T2 (build-contracts §12.6): low-value events go first. read_file/list_files tool events (the lead's or an expert's)
 * are stored only while the job holds fewer than LOW_VALUE_EVENT_CAP events, so consult, propose_change, proposal,
 * text, error and done events keep the rest of the 500 (appendEvents still keeps the terminal slot).
 * A low-value START is dropped earlier (LOW_VALUE_START_CAP), so a read whose start was stored keeps room for its end
 * and never shows as unfinished.
 */
export const LOW_VALUE_EVENT_CAP = 400;
export const LOW_VALUE_START_CAP = 380;
export const isLowValue = (ev: SseEvent) => ev.type === "tool" && (ev.name === "read_file" || ev.name === "list_files");
export function appendProgress(events: SseEvent[], add: SseEvent[]): SseEvent[] {
  const kept: SseEvent[] = [];
  for (const ev of add) {
    const cap = ev.type === "tool" && ev.phase === "start" ? LOW_VALUE_START_CAP : LOW_VALUE_EVENT_CAP;
    if (!isLowValue(ev) || events.length + kept.length < cap) kept.push(ev);
  }
  return appendEvents(events, kept);
}
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
  return safe(ROUTE, async function jobRun(req: Request, context: Ctx): Promise<Response> {
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
    let storedEvents = claimed.events?.length ?? 0; // from the last successful progress write
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
      // The batch is taken when the write RUNS (not when it is queued), so events put back by a failed earlier write
      // ride on the next one. A failed write (conflict, missing or a throw) is logged and its events go back first.
      let add: SseEvent[] = [];
      const putBack = () => { logLine({ msg: "job_progress_write_failed", route: ROUTE, requestId, jobId }); pending = [...add, ...pending]; };
      queue = queue.then(async () => {
        add = pending;
        pending = [];
        const res = await updateJob(jobs, jobId, (j) => ({ ...j, ...patch, proposalId, events: appendProgress(j.events ?? [], add), updatedAt: iso() }));
        if (!res.ok) return putBack();
        storedEvents = res.job.events.length;
        await recordElapsed(); // compute is recorded at each progress write, new milliseconds only
      }).catch(putBack);
      return queue;
    };
    const finish = async (status: JobStatus, terminal: SseEvent | null, patch: Partial<JobRecord> = {}) => {
      // A refusal discards the partial reply (docs/04 §2.1); otherwise the last text goes BEFORE the terminal event.
      if (terminal?.type === "error" && terminal.code === "refusal") text = "";
      flushText();
      if (terminal) pending.push(terminal);
      await persist({ ...patch, status });
    };
    const fail = (code: ErrorCode) => finish("failed", errorEvent(code));

    try {
      const registry = await deps.registry();
      const agent = registry.get(claimed.agent);
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
        // Progress after each tool call, and also when a consult STARTS, so "Asking Dewey…" shows within one poll.
        // A read/list event at or past the T2 cap would be dropped anyway: no write for it.
        if (ev.type === "tool" && (ev.phase === "end" || ev.name === "consult_expert") && !(isLowValue(ev) && storedEvents >= LOW_VALUE_EVENT_CAP)) persist();
      };
      const toolEmit = (ev: SseEvent) => { flushText(); emit(ev); };
      const onProposal = async (p: { id: string }) => {
        proposalId = p.id; // the last one; the UI uses the proposal events
        await writeAudit(deps.stores.audit, { action: "proposed", actor: g.userId, proposalId: p.id, jobId, requestId }, new Date(deps.now())).catch(() => {});
      };
      // ONE Usage, passed BY REFERENCE to the lead's runTurn and to every expert it consults (R-3).
      const usage: Usage = { tokens: claimed.usage?.tokens ?? 0, rounds: claimed.usage?.rounds ?? 0 };
      const now = () => new Date(deps.now());
      const policy = { denyConsoleUi: S.denyConsoleUi };
      let runTool: RunTool;
      let tools: ReadonlyArray<unknown> = TOOLS;
      let parallel: ParallelTools | undefined;
      if (agent.name === S.team.leadAgent) {
        // The team lead: read tools + consult_expert, no propose_change; consults of one round run in parallel (R-2).
        const team = createTeamRunner({
          client, registry, lead: agent, reader, stores: deps.stores, state, usage, deadline, emit: toolEmit,
          createdBy: g.userId, policy, settings: S, now, onProposal,
        });
        ({ runTool, tools, parallel } = team);
      } else {
        runTool = createToolRunner({ reader, proposals: deps.stores.proposals, agent: agent.name, state, now, policy, createdBy: g.userId, emit: toolEmit, onProposal });
      }
      const r = await runTurn({
        client, agent, messages: claimed.messages, runTool, emit, effort: "high", deadline, usage, tools, parallel,
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
  }, accepted);
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
