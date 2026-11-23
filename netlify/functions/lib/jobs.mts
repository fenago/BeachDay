// Job records (store `jobs`, key j_<ULID>) and the one way a job starts (docs/04 §2, §8; build-contracts §6, R13).
// Used by POST /api/jobs and by the /api/chat hand-off, so the limits, the nonce and the record shape live once.
// The nonce is single-use: only its SHA-256 is stored, and job-run clears it when it claims the job (CAS).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { BlobStore, Stores } from "./blobs.mts";
import { newJobId } from "./ids.mts";
import { hit, windowKey, checkComputeBudget, nextLocalMidnight } from "./limits.mts";
import type { SseEvent } from "./sse.mts";
import type { Settings } from "./handler.mts";

export type JobStatus = "queued" | "running" | "done" | "failed" | "paused";
export interface JobRecord {
  id: string;
  owner: string;                    // Supabase sub
  agent: string;
  status: JobStatus;
  nonceHash: string | null;
  messages: unknown[];              // server-side conversation state (may hold tool/thinking blocks)
  baseSha: string | null;           // pinned main SHA (ADR-0007), carried over on hand-off and Continue
  readShas: Record<string, string>;
  usage: { tokens: number; rounds: number };
  events: SseEvent[];
  proposalId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  continuedBy?: string | { pending: true; at: string }; // CAS claim when a paused job is continued (once); a pending claim older than 60 s may be taken over
}

export const MAX_JOB_EVENTS = 500;  // job-view schema maxItems
export const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;

export const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const newNonce = (): string => randomBytes(32).toString("base64url"); // 256 bits

/** Constant-time check of a presented nonce against the stored hash. */
export function nonceMatches(nonce: unknown, storedHash: unknown): boolean {
  if (typeof nonce !== "string" || !NONCE_RE.test(nonce) || typeof storedHash !== "string" || storedHash.length !== 64) return false;
  return timingSafeEqual(Buffer.from(sha256hex(nonce)), Buffer.from(storedHash));
}

/** CAS update with retries. `change` returns the next record, or null to refuse (nothing is written). */
export async function updateJob(store: BlobStore, id: string, change: (j: JobRecord) => JobRecord | null, maxAttempts = 8): Promise<{ ok: true; job: JobRecord } | { ok: false; reason: "missing" | "refused" | "conflict"; job?: JobRecord }> {
  for (let i = 0; i < maxAttempts; i++) {
    const cur = await store.getWithMetadata(id, { type: "json" });
    if (!cur || !cur.data) return { ok: false, reason: "missing" };
    const next = change(cur.data as JobRecord);
    if (!next) return { ok: false, reason: "refused", job: cur.data as JobRecord };
    const res = await store.setJSON(id, next, { onlyIfMatch: cur.etag });
    if (res.modified) return { ok: true, job: next };
  }
  return { ok: false, reason: "conflict" };
}

/** Append events, keeping one slot free so a terminal event always fits under MAX_JOB_EVENTS. */
export function appendEvents(events: SseEvent[], add: SseEvent[]): SseEvent[] {
  const out = [...events];
  for (const ev of add) {
    const terminal = ev.type === "done" || ev.type === "error";
    if (out.length < MAX_JOB_EVENTS - 1 || (terminal && out.length < MAX_JOB_EVENTS)) out.push(ev);
  }
  return out;
}

export const CONTINUE_CLAIM_STALE_MS = 60_000;
/** May this paused job be claimed for Continue now? A finished claim (a job id) never; a pending one after 60 s. */
export function continueClaimFree(c: JobRecord["continuedBy"], nowMs: number): boolean {
  if (c === undefined || c === null) return true;
  if (typeof c === "object" && c.pending === true) {
    const at = Date.parse(c.at);
    return Number.isFinite(at) && nowMs - at > CONTINUE_CLAIM_STALE_MS; // malformed time counts as held
  }
  return false;
}

/** A job still `running` with no progress write for this long died (15 min background limit + margin). */
export const JOB_STALE_RUNNING_MS = 16 * 60_000;

/**
 * job-view (schema): never messages, owner, nonceHash, baseSha, readShas or usage. Display only (R11, R13-2):
 * a `running` job whose last write is over 16 min old is shown as failed with an internal error. Nothing is written.
 */
export function jobView(j: JobRecord, nowMs: number = Date.now()) {
  const updated = Date.parse(j.updatedAt);
  const dead = j.status === "running" && Number.isFinite(updated) && nowMs - updated > JOB_STALE_RUNNING_MS;
  const events = j.events ?? [];
  return {
    id: j.id, agent: j.agent,
    status: dead ? "failed" : j.status,
    events: dead ? appendEvents(events, [{ type: "error", code: "internal", message: "The job stopped unexpectedly. Start it again.", retryable: true }]) : events,
    proposalId: j.proposalId ?? null, createdAt: j.createdAt, updatedAt: j.updatedAt,
  };
}

export type StartJob = (authorization: string, body: { jobId: string; nonce: string }, origin: string) => Promise<unknown>;

/** A background function answers 202 at once; 3 s keeps the chat hand-off inside the 60 s streaming limit (R13-1). */
export const START_JOB_TIMEOUT_MS = 3_000;

/** Production startJob: POST <origin>/api/jobs-run with the caller's Authorization. A background function answers 202. */
export function createStartJob(fetchImpl: typeof fetch = fetch, timeoutMs = START_JOB_TIMEOUT_MS): StartJob {
  return async (authorization, body, origin) => {
    const res = await fetchImpl(`${origin}/api/jobs-run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel().catch(() => {});
    if (res.status !== 202) throw new Error(`jobs-run answered ${res.status}`);
    return res;
  };
}

export interface LaunchInput {
  owner: string;
  agent: string;
  messages: unknown[];
  baseSha: string | null;
  readShas: Record<string, string>;
  usage?: { tokens: number; rounds: number };
  authorization: string;
  origin: string;
}
export type LaunchResult =
  | { ok: true; jobId: string }
  | { ok: false; code: "rate_limited" | "budget_exhausted"; retryAt: string }
  | { ok: false; code: "unavailable" | "upstream" };

/**
 * Limits, record, start (docs/04 §8-9): the compute budget (read-only, >= jobNeedMs left), then the per-user daily
 * jobs counter (counted at start, never refunded), then the record with onlyIfNew and a fresh nonce, then job-run.
 * A limit record that can't be read fails closed (unavailable). If job-run can't be started the job is marked failed.
 */
export async function launchJob(
  d: { stores: Stores; settings: Settings; now: () => number; startJob: StartJob },
  input: LaunchInput,
): Promise<LaunchResult> {
  const now = new Date(d.now());
  try {
    const budget = await checkComputeBudget(d.stores.ratelimit, d.settings.computeNeedJobMs, now, { windowMinutes: d.settings.computeBudgetMinutes });
    if (!budget.allowed) return { ok: false, code: "budget_exhausted", retryAt: budget.retryAt ?? nextLocalMidnight(now).toISOString() };
    const daily = await hit(d.stores.ratelimit, windowKey(input.owner, "jobs", now), d.settings.perUserDaily.jobs);
    if (!daily.allowed) return { ok: false, code: "rate_limited", retryAt: nextLocalMidnight(now).toISOString() };
  } catch {
    return { ok: false, code: "unavailable" };
  }

  const nonce = newNonce();
  const at = now.toISOString();
  let record: JobRecord | null = null;
  try {
    for (let i = 0; i < 2 && !record; i++) {
      const r: JobRecord = {
        id: newJobId(now.getTime()), owner: input.owner, agent: input.agent, status: "queued", nonceHash: sha256hex(nonce),
        messages: input.messages, baseSha: input.baseSha, readShas: { ...input.readShas }, usage: input.usage ?? { tokens: 0, rounds: 0 },
        events: [], proposalId: null, createdAt: at, updatedAt: at,
      };
      if ((await d.stores.jobs.setJSON(r.id, r, { onlyIfNew: true })).modified) record = r;
    }
  } catch {
    return { ok: false, code: "unavailable" };
  }
  if (!record) return { ok: false, code: "unavailable" };

  try {
    await d.startJob(input.authorization, { jobId: record.id, nonce }, input.origin);
  } catch {
    const t = new Date(d.now()).toISOString();
    await updateJob(d.stores.jobs, record.id, (j) => (j.status === "queued"
      ? { ...j, status: "failed", nonceHash: null, updatedAt: t, events: appendEvents(j.events, [{ type: "error", code: "upstream", message: "The job couldn't start. Try again in a minute.", retryable: true }]) }
      : null)).catch(() => {});
    return { ok: false, code: "upstream" };
  }
  return { ok: true, jobId: record.id };
}
