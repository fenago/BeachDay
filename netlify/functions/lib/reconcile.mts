// The docs/04 §7 reconciler for a proposal stuck in `committing` (decidedAt more than 120 s ago).
// The caller holds the approve lock. The GitHub search is injected (`find`): the proposal GET passes the
// read-only module's findProposalCommit, approve passes its writer's own reader. This file never writes to GitHub.
//   found     -> recordApproval (it COUNTS, ADR-0008), then CAS committed {commitSha}   ("committed => counted")
//   not_found -> CAS failed {error}  (only after a successful read of a page shorter than 50)
//   unknown / GitHub unreachable / record failure -> leave `committing`; the next GET or approve tries again
import type { Stores } from "./blobs.mts";
import { recordApproval } from "./limits.mts";
import { transition, writeAudit, needsReconcile, type ProposalRecord, type ReconcileVerdict } from "./proposals.mts";
import { logLine } from "./handler.mts";

export type Loaded = { record: ProposalRecord; etag: string };

/** Marker key (store `proposals`): never matches ^p_, so proposal listings skip it (R9). */
export const recordedKey = (proposalId: string): string => `approval-recorded/${proposalId}`;

/**
 * Count one committed approval per proposal (R11 idempotency). Record FIRST, then write the marker: if the marker
 * write fails or the function dies in between, a later call records again (overcount by one, the safe direction,
 * ADR-0008); it never undercounts. A marker that is already there means this proposal was counted: skip.
 * Throws when the record can't be written (the caller leaves the proposal `committing`).
 */
export async function recordApprovalOnce(stores: Stores, proposalId: string, now: Date): Promise<"recorded" | "already"> {
  if (await stores.proposals.getWithMetadata(recordedKey(proposalId), { type: "json" })) return "already";
  await recordApproval(stores.ratelimit, now);
  await stores.proposals.setJSON(recordedKey(proposalId), { at: now.toISOString() }, { onlyIfNew: true }).catch(() => {
    logLine({ msg: "approval_marker_write_failed", proposalId });
  });
  return "recorded";
}

export async function reconcile(
  d: { stores: Stores; now: () => number },
  loaded: Loaded,
  find: (p: ProposalRecord) => Promise<ReconcileVerdict>,
  meta: { actor: string; requestId?: string },
): Promise<Loaded> {
  if (!needsReconcile(loaded.record, d.now())) return loaded;
  const id = loaded.record.id;
  let v: ReconcileVerdict;
  try {
    v = await find(loaded.record);
  } catch {
    logLine({ msg: "reconcile_github_unreachable", proposalId: id, requestId: meta.requestId });
    return loaded;
  }
  if (v.verdict === "unknown") {
    logLine({ msg: "reconcile_unknown", proposalId: id, requestId: meta.requestId }); // a human checks main
    return loaded;
  }
  if (v.verdict === "found") {
    try {
      await recordApprovalOnce(d.stores, id, new Date(d.now()));
    } catch {
      logLine({ msg: "reconcile_record_failed", proposalId: id, commitSha: v.commitSha, requestId: meta.requestId });
      return loaded; // never mark committed before it is counted
    }
    const t = await transition(d.stores.proposals, loaded, "committed", { commitSha: v.commitSha });
    if (!t.ok) return loaded;
    await writeAudit(d.stores.audit, { action: "reconciled_committed", actor: meta.actor, proposalId: id, commitSha: v.commitSha, requestId: meta.requestId }, new Date(d.now())).catch(() => {});
    return { record: t.record, etag: t.etag };
  }
  const t = await transition(d.stores.proposals, loaded, "failed", { error: "The commit did not reach main." });
  if (!t.ok) return loaded;
  await writeAudit(d.stores.audit, { action: "reconciled_failed", actor: meta.actor, proposalId: id, requestId: meta.requestId }, new Date(d.now())).catch(() => {});
  return { record: t.record, etag: t.etag };
}
