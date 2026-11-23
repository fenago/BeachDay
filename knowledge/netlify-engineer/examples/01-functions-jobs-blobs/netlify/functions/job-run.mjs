// POST /api/jobs-run — background function (config.background: true).
// The client gets an empty 202 immediately; the return value is discarded,
// so ALL output goes to Blobs. Netlify retries a failed invocation after
// 1 min and again 2 min later, so this handler must be idempotent.
//
// Flow: the sync POST /api/jobs (jobs.mjs) runs the auth guard, writes
// jobs/<id> = { status: "queued", tokenHash } with onlyIfNew, then POSTs
// { jobId, token } here. The one-time token stops strangers starting jobs,
// because a background function cannot send an error back to its caller.
import { createHash } from "node:crypto";
import { store } from "./lib/blobs.mjs";

const ID_RE = /^[a-z0-9-]{8,64}$/;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// Compare-and-swap helper: read with etag, write only if unchanged.
async function update(jobs, id, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await jobs.getWithMetadata(id, { type: "json" });
    if (!cur) return { ok: false, reason: "missing" };
    const next = change(cur.data);
    if (!next) return { ok: false, reason: "rejected", job: cur.data };
    const res = await jobs.setJSON(id, next, { onlyIfMatch: cur.etag });
    if (res.modified) return { ok: true, job: next };
  }
  return { ok: false, reason: "conflict" };
}

// Stand-in for the real work (Claude tool rounds, building a proposal).
export async function doWork(job, emit) {
  await emit("planning");
  await emit("drafting proposal");
  return { proposalId: `p-${job.id}` };
}

export default async (req, _context) => {
  let input;
  try {
    input = await req.json();
  } catch {
    return; // nothing to report to; a bad body is simply ignored
  }
  const { jobId, token } = input ?? {};
  if (typeof jobId !== "string" || !ID_RE.test(jobId) || typeof token !== "string") return;

  const jobs = store("jobs");

  // Claim the job exactly once: queued -> running, only with the right token.
  const claim = await update(jobs, jobId, (j) =>
    j.status === "queued" && j.tokenHash === sha256(token)
      ? { ...j, status: "running", tokenHash: null, startedAt: new Date().toISOString() }
      : null,
  );
  if (!claim.ok) return; // already claimed (a retry), wrong token, or missing

  const emit = (msg) =>
    update(jobs, jobId, (j) => ({ ...j, events: [...(j.events ?? []), { at: Date.now(), msg }] }));

  try {
    const result = await doWork(claim.job, emit);
    await update(jobs, jobId, (j) => ({ ...j, status: "done", result, finishedAt: new Date().toISOString() }));
  } catch (err) {
    // Record a safe message only; never the raw error (may contain headers/keys).
    await update(jobs, jobId, (j) => ({ ...j, status: "failed", error: "job_failed" }));
  }
};

export const config = {
  path: "/api/jobs-run",
  method: "POST",
  background: true, // 15 min limit, 256 KB request payload, cannot stream
};
