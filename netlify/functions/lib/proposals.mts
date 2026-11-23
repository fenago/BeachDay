// Proposal records in Blobs (store `proposals`, strong consistency) and the integrity rules around them:
// summary check, content hash, CAS status transitions, approve lock, commit message, reconciler match.
// docs/04 §2.1, §6, §7; agent-console-security "Proposal integrity"; security-engineer example 02 (commitmsg).
// No function here talks to GitHub; the store is injected so tests use a fake.
import { createHash } from "node:crypto";
import { checkProposal, type PolicyOptions } from "./allowlist.mts";
import { scanProposal, type Finding } from "./secretscan.mts";
import { isProposalId, newProposalId } from "./ids.mts";

import type { BlobStore, WriteResult } from "./blobs.mts";
export type { BlobStore, WriteResult };

/** Etag after a successful write. Real Blobs may report "" (R3-1): then re-read; "" if even that fails. */
async function etagAfterWrite(store: BlobStore, key: string, res: WriteResult): Promise<string> {
  if (res.etag) return res.etag;
  try {
    return (await store.getWithMetadata(key, { type: "json" }))?.etag ?? "";
  } catch {
    return "";
  }
}

export type ProposalStatus = "pending" | "committing" | "committed" | "failed" | "stale" | "rejected";
export interface ProposalFile { path: string; content: string; readBlobSha: string | null }
export interface ProposalRecord {
  id: string;
  agent: string;
  status: ProposalStatus;
  createdAt: string;
  baseSha: string;
  summary: string;
  files: ProposalFile[];
  contentHash: string;
  decidedAt?: string;
  decidedBy?: string;
  commitSha?: string;
  rejectReason?: string;
  error?: string;
}

export const TRAILER = "Beach-Day-Proposal";
const SHA1 = /^[0-9a-f]{40}$/;
const BAD_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const BAD_CHARS_G = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Thrown by createProposal; `reasons` are agent-safe (paths, rule ids, redacted previews only). */
export class ProposalRejected extends Error {
  reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join("; ").slice(0, 2000));
    this.name = "ProposalRejected";
    this.reasons = reasons;
  }
}

// ---- Summary (docs/04 §6): reject, never repair ----
export function checkSummary(s: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof s !== "string") return { ok: false, reason: "summary must be a string" };
  if (!s.isWellFormed()) return { ok: false, reason: "summary has a lone surrogate (not valid UTF-8)" };
  const n = [...s].length;
  if (n < 20 || n > 2000) return { ok: false, reason: "summary must be one line of 20-2000 characters" };
  if (BAD_CHARS.test(s)) return { ok: false, reason: "summary has a control, format or line-break character" };
  if (s.toLowerCase().includes(TRAILER.toLowerCase())) return { ok: false, reason: `summary must not contain ${TRAILER}` };
  return { ok: true };
}

// ---- Content hash: SHA-256 of canonical JSON of [[path, content], ...] in path order ----
export function canonicalFilesJson(files: ReadonlyArray<{ path: string; content: string }>): string {
  const rows = files.map((f) => [f.path, f.content] as [string, string]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(rows);
}
export function computeContentHash(files: ReadonlyArray<{ path: string; content: string }>): string {
  return "sha256:" + createHash("sha256").update(canonicalFilesJson(files), "utf8").digest("hex");
}
/** Approve: the hash the user saw must equal the hash recomputed from the stored files. */
export function hashMatches(record: ProposalRecord, sent: unknown): boolean {
  return typeof sent === "string" && sent === record.contentHash && computeContentHash(record.files) === record.contentHash;
}

/** Policy checks re-run at Approve: allow-list, sizes, text-only, secret scan, summary, hash. */
export function revalidate(record: ProposalRecord, opts: PolicyOptions = {}): { ok: boolean; errors: string[]; findings: Finding[] } {
  const errors: string[] = [];
  const s = checkSummary(record.summary);
  if (!s.ok) errors.push(s.reason);
  const p = checkProposal(record.files, opts);
  errors.push(...p.errors);
  for (const f of record.files ?? []) {
    if (!(f.readBlobSha === null || (typeof f.readBlobSha === "string" && SHA1.test(f.readBlobSha)))) errors.push(`${f.path}: bad readBlobSha`);
  }
  if (!SHA1.test(record.baseSha ?? "")) errors.push("bad baseSha");
  if (computeContentHash(record.files ?? []) !== record.contentHash) errors.push("content hash mismatch");
  const scan = p.ok ? scanProposal(record.files) : { ok: true, findings: [] as Finding[] };
  if (!scan.ok) errors.push(...scan.findings.map((f) => `${f.path}:${f.line} looks like a secret (${f.rule}, ${f.preview})`));
  return { ok: errors.length === 0, errors, findings: scan.findings };
}

// ---- Create (propose_change) ----
export interface CreateInput {
  agent: string;
  summary: unknown;
  files: unknown;
  baseSha: string;
  readShas: Readonly<Record<string, string>>; // blob SHAs the agent read this turn (ADR-0007)
  now?: () => Date;
  policy?: PolicyOptions;
}

export async function createProposal(store: BlobStore, input: CreateInput): Promise<ProposalRecord> {
  const reasons: string[] = [];
  const s = checkSummary(input.summary);
  if (!s.ok) reasons.push(s.reason);
  const p = checkProposal(input.files, input.policy);
  reasons.push(...p.errors);
  if (!SHA1.test(input.baseSha ?? "")) reasons.push("no pinned main SHA for this turn");
  if (reasons.length) throw new ProposalRejected(reasons);
  const raw = input.files as Array<{ path: string; content: string }>;
  const scan = scanProposal(raw);
  if (!scan.ok) throw new ProposalRejected(scan.findings.map((f) => `${f.path}:${f.line} looks like a secret (${f.rule}, ${f.preview})`));

  const files: ProposalFile[] = raw.map((f) => ({ path: f.path, content: f.content, readBlobSha: input.readShas[f.path] ?? null }));
  const now = (input.now ?? (() => new Date()))();
  for (let attempt = 0; attempt < 2; attempt++) {
    const record: ProposalRecord = {
      id: newProposalId(now.getTime()),
      agent: input.agent,
      status: "pending",
      createdAt: now.toISOString(),
      baseSha: input.baseSha,
      summary: input.summary as string,
      files,
      contentHash: computeContentHash(files),
    };
    const res = await store.setJSON(record.id, record, { onlyIfNew: true });
    if (res.modified) return record;
  }
  throw new Error("could not allocate a proposal id");
}

// ---- Load ----
export async function loadProposal(store: BlobStore, id: string): Promise<{ record: ProposalRecord; etag: string } | null> {
  if (!isProposalId(id)) throw new Error("bad proposal id"); // handlers answer 400 before calling this
  const got = await store.getWithMetadata(id, { type: "json" });
  if (!got || !got.data || typeof got.etag !== "string") return null;
  return { record: got.data as ProposalRecord, etag: got.etag };
}

// ---- CAS transitions (docs/04 §2.1 state diagram) ----
const TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = Object.freeze({
  pending: ["committing", "stale", "rejected"],
  committing: ["committed", "failed", "stale"],
  committed: [],
  failed: [],
  stale: [],
  rejected: [],
});
export const canTransition = (from: ProposalStatus, to: ProposalStatus): boolean => TRANSITIONS[from]?.includes(to) ?? false;

export type TransitionResult =
  | { ok: true; record: ProposalRecord; etag: string }
  | { ok: false; reason: "conflict" | "bad_transition" };

/**
 * Compare-and-swap status change. `from` is the state the caller loaded with `etag`. Only the request that wins
 * the onlyIfMatch write moves the record; a loser gets `conflict` and must not act (docs/04 §7).
 */
export async function transition(
  store: BlobStore,
  current: { record: ProposalRecord; etag: string },
  to: ProposalStatus,
  patch: Partial<Pick<ProposalRecord, "decidedAt" | "decidedBy" | "commitSha" | "rejectReason" | "error">> = {},
): Promise<TransitionResult> {
  const from = current.record.status;
  if (!canTransition(from, to)) return { ok: false, reason: "bad_transition" };
  const next: ProposalRecord = { ...current.record, ...patch, status: to };
  if (to !== "committed") delete next.commitSha; // schema: only committed carries commitSha
  if (next.error !== undefined) next.error = String(next.error).slice(0, 500);
  if (next.rejectReason !== undefined) next.rejectReason = String(next.rejectReason).slice(0, 500);
  const res = await store.setJSON(current.record.id, next, { onlyIfMatch: current.etag });
  if (!res.modified) return { ok: false, reason: "conflict" };
  // modified === true is success even with an empty etag; an "" etag makes the next CAS fail safe (caller reloads).
  return { ok: true, record: next, etag: await etagAfterWrite(store, current.record.id, res) };
}

/** A committing record older than this is reconciled by the next GET or approve (docs/04 §2.1). */
export const RECONCILE_AFTER_MS = 120_000;
export function needsReconcile(record: ProposalRecord, nowMs: number): boolean {
  if (record.status !== "committing" || !record.decidedAt) return false;
  return nowMs - Date.parse(record.decidedAt) > RECONCILE_AFTER_MS;
}

// ---- Site-wide approve lock (docs/04 §7 step 0): key `approve-lock`, onlyIfNew, takeover after 90 s ----
export const APPROVE_LOCK_KEY = "approve-lock";
export const LOCK_STALE_MS = 90_000;
export interface LockHandle { owner: string; etag: string }

export async function acquireApproveLock(store: BlobStore, owner: string, nowMs: number = Date.now()): Promise<LockHandle | null> {
  const value = { owner, at: new Date(nowMs).toISOString() };
  const created = await store.setJSON(APPROVE_LOCK_KEY, value, { onlyIfNew: true });
  if (created.modified) return { owner, etag: await etagAfterWrite(store, APPROVE_LOCK_KEY, created) };
  const cur = await store.getWithMetadata(APPROVE_LOCK_KEY, { type: "json" });
  if (!cur || typeof cur.etag !== "string" || cur.etag === "") return null;
  const d: any = cur.data;
  const free = d && typeof d === "object" && d.released === true;
  const at = d && typeof d.at === "string" ? Date.parse(d.at) : NaN;
  // Fail closed (R3-3): a malformed or missing `at` counts as held, unless the record says released.
  const stale = Number.isFinite(at) && nowMs - at > LOCK_STALE_MS;
  if (!free && !stale) return null;
  const taken = await store.setJSON(APPROVE_LOCK_KEY, value, { onlyIfMatch: cur.etag });
  return taken.modified ? { owner, etag: await etagAfterWrite(store, APPROVE_LOCK_KEY, taken) } : null;
}

/** Release only our own lock (CAS on our etag), by marking it released. Never throws. */
export async function releaseApproveLock(store: BlobStore, lock: LockHandle | null): Promise<void> {
  if (!lock) return;
  try {
    let etag = lock.etag;
    if (!etag) {
      const cur = await store.getWithMetadata(APPROVE_LOCK_KEY, { type: "json" });
      if (!cur || (cur.data as any)?.owner !== lock.owner || cur.etag === "") return; // expires after LOCK_STALE_MS
      etag = cur.etag;
    }
    await store.setJSON(APPROVE_LOCK_KEY, { owner: lock.owner, at: new Date(0).toISOString(), released: true }, { onlyIfMatch: etag });
  } catch {
    /* a lock we couldn't release expires after LOCK_STALE_MS */
  }
}

// ---- Audit (store `audit`, key `<iso>_<id>`): actor = Supabase user id; never tokens or bodies ----
export interface AuditEntry { action: string; actor: string; proposalId?: string; jobId?: string; commitSha?: string; requestId?: string; detail?: string }
export async function writeAudit(store: BlobStore, entry: AuditEntry, now: Date = new Date()): Promise<void> {
  const id = entry.proposalId ?? entry.jobId ?? "site";
  const rec = { ...entry, at: now.toISOString(), detail: entry.detail?.slice(0, 500) };
  for (let i = 0; i < 2; i++) { // a suffix collision retries once with a fresh suffix (R3-4)
    const key = `${now.toISOString()}_${id}_${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
    if ((await store.setJSON(key, rec, { onlyIfNew: true })).modified) return;
  }
}

// ---- Commit message (docs/04 §7 step 5), server-built only ----
export function buildCommitMessage(summary: unknown, id: string): string {
  if (!isProposalId(id)) throw new Error("bad proposal id");
  let line = String(summary ?? "").toWellFormed().replace(BAD_CHARS_G, " ");
  for (let prev: string | undefined; prev !== line; ) {
    prev = line;
    line = line.replace(/beach-day-proposal/gi, "");
  }
  line = [...line.replace(/ {2,}/g, " ").trim()].slice(0, 200).join("").trim();
  if (line === "") line = "Agent proposal";
  return `${line}\n\n${TRAILER}: ${id}`;
}

export const commitAuthorName = (agent: string): string => `Beach Day Agent (${agent})`;
export const COMMIT_AUTHOR_EMAIL = "agent@beachday.invalid";

/** Git blob SHA-1 of the exact UTF-8 bytes GitHub stores. */
export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export interface CandidateCommit { sha: string; message: string; authorName: string; parents: string[]; blobs?: Record<string, string | null> }

/** Final-line trailer only (cheap pre-filter before fetching blob SHAs). */
export function hasFinalTrailer(message: string, id: string): boolean {
  const lines = String(message ?? "").replace(/\n$/, "").split("\n");
  return lines.at(-1) === `${TRAILER}: ${id}`;
}

/** Full §7 match: final-line trailer AND exact author AND one parent AND every blob SHA equal. */
export function isProposalCommit(c: CandidateCommit, proposal: Pick<ProposalRecord, "id" | "agent" | "files">): boolean {
  if (!hasFinalTrailer(c?.message, proposal.id)) return false;
  if (c.authorName !== commitAuthorName(proposal.agent)) return false;
  if (!Array.isArray(c.parents) || c.parents.length !== 1) return false;
  return proposal.files.every((f) => c.blobs?.[f.path] === gitBlobSha(f.content));
}

export type ReconcileVerdict = { verdict: "found"; commitSha: string } | { verdict: "not_found" } | { verdict: "unknown" };

/** A FULL page with no match is "unknown" (stay committing), never "not_found". */
export function reconcileVerdict(commits: CandidateCommit[], proposal: Pick<ProposalRecord, "id" | "agent" | "files">, perPage = 50): ReconcileVerdict {
  const hit = commits.find((c) => isProposalCommit(c, proposal));
  if (hit) return { verdict: "found", commitSha: hit.sha };
  return commits.length >= perPage ? { verdict: "unknown" } : { verdict: "not_found" };
}
