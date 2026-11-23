// POST /api/proposals/:id/approve {contentHash}: ONE atomic commit to main (ADR-0003), then Netlify deploys.
// docs/04 §1 step 5, §2.1, §4.2, §7, §9; ADR-0008; build-contracts §2.2. The only file that imports github-write.
// Order: method -> guard -> Origin -> approveEnabled (D10; off = 503) -> step-up (401 step_up_required) ->
// production (before the write token is read) -> id -> body {contentHash} (^sha256:[0-9a-f]{64}$, else 400) ->
// site-wide approve lock -> reconciler -> pending + hash compare (409) -> cap CHECK, read-only (429 approve_cap) ->
// re-validate allow-list + limits + secret scan -> CAS pending -> committing -> §7 steps 1-6 ->
// RECORD the approval, THEN mark committed ("committed => counted"); failed/stale/unknown never record.
import type { Config } from "@netlify/functions";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { approveStepUp } from "./lib/stepup.mts";
import { realStores, type Stores } from "./lib/blobs.mts";
import { SETTINGS } from "./lib/settings.mts";
import { error, json } from "./lib/http.mts";
import { isProposalId } from "./lib/ids.mts";
import { githubWriteFromEnv, type GitHubWrite } from "./lib/github-write.mts";
import {
  loadProposal, transition, hashMatches, revalidate, acquireApproveLock, releaseApproveLock, writeAudit,
} from "./lib/proposals.mts";
import { reconcile, recordApprovalOnce, type Loaded } from "./lib/reconcile.mts";
import { checkApproveCap } from "./lib/limits.mts";
import { deploysOnCommit } from "./lib/deploys.mts";
import {
  authorize, methodNotAllowed, isProduction, notProduction, badRequest, readJson, isPlainObject, onlyKeys,
  unavailable, internal, approvalsView, logLine, MAX_SMALL_BODY, type Ctx, type Settings, safe } from "./lib/handler.mts";

const ROUTE = "POST /api/proposals/:id/approve";
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
export const APPROVE_GITHUB_DEADLINE_MS = 45_000; // a sync function stops at 60 s; an abort is an UNKNOWN outcome

type StepUp = typeof approveStepUp;
export interface ApproveDeps {
  guard: Guard;
  stores: Stores;
  settings: Settings;
  stepUp: StepUp;
  getWriter: (o?: { signal?: AbortSignal }) => GitHubWrite;
  now: () => number;
}

const conflict = (msg = "This changed while you were looking. Reload it.") => error(409, "conflict", msg);

export function createApproveHandler(deps: ApproveDeps) {
  return safe(ROUTE, async function approve(req: Request, context: Ctx): Promise<Response> {
    const requestId = context?.requestId;
    if (req.method !== "POST") return methodNotAllowed("POST");
    const g = await authorize(deps.guard, req, ROUTE, requestId);
    if (g instanceof Response) return g;
    const S = deps.settings;
    const at = () => new Date(deps.now());
    const audit = (action: string, extra: { proposalId?: string; commitSha?: string; detail?: string } = {}) =>
      writeAudit(deps.stores.audit, { action, actor: g.userId, requestId, ...extra }, at()).catch(() => {});

    // D10: a server constant (docs/04 §4.2 pre-launch tests). Off: nothing else runs.
    if (S.approveEnabled !== true) return error(503, "unavailable", "Approve is off until the pre-launch checks pass.");

    // Step-up (§4.2) with the injected clock in seconds, so tests that move the clock move the check (R4-5).
    const id = context?.params?.id;
    const s = await deps.stepUp(g.token, g.claims, deps.guard.getUser, Math.floor(deps.now() / 1000));
    if (!s.ok) {
      if (s.code === "step_up_required") {
        await audit("step_up_failed", { proposalId: isProposalId(id) ? id : undefined, detail: s.reason });
        return error(401, "step_up_required", "Confirm it's you to approve.");
      }
      return s.status === 401 ? error(401, "unauthorized", "Sign in to continue.") : error(503, "unavailable", "Couldn't check your access. Try again in a minute.");
    }

    if (!isProduction(context)) return notProduction(); // before GITHUB_TOKEN is read
    if (!isProposalId(id)) return badRequest("That proposal id isn't valid.");
    const body = await readJson(req, MAX_SMALL_BODY);
    if (!body.ok || !isPlainObject(body.value) || !onlyKeys(body.value, ["contentHash"]) || typeof body.value.contentHash !== "string" || !HASH_RE.test(body.value.contentHash)) {
      return badRequest("The approval must carry the proposal's content hash.");
    }
    const sentHash = body.value.contentHash;

    let writer: GitHubWrite;
    try {
      writer = deps.getWriter({ signal: AbortSignal.timeout(APPROVE_GITHUB_DEADLINE_MS) });
    } catch {
      logLine({ msg: "approve_not_configured", route: ROUTE, requestId });
      return unavailable();
    }

    // §7 step 0: one approve in flight site-wide.
    let lock;
    try {
      lock = await acquireApproveLock(deps.stores.proposals, `approve:${requestId ?? id}`, deps.now());
    } catch {
      return unavailable();
    }
    if (!lock) return conflict("Another approval is in progress. Try again in a minute.");

    try {
      let loaded: Loaded | null = await loadProposal(deps.stores.proposals, id);
      if (!loaded) return error(404, "not_found", "That proposal no longer exists.");
      loaded = await reconcile(deps, loaded, (p) => writer.reader.findProposalCommit(p), { actor: g.userId, requestId });
      const rec = loaded.record;
      if (rec.status !== "pending") return conflict();
      if (!hashMatches(rec, sentHash)) return conflict("The proposal changed since you reviewed it. Reload it.");

      // Cap CHECK, read-only, inside the lock and before any GitHub call (ADR-0008). Nothing is recorded here.
      let cap;
      try {
        cap = await checkApproveCap(deps.stores.ratelimit, at(), S.approveCap);
      } catch {
        return unavailable(); // unreadable site:approvals: fail closed
      }
      const caps = S.approveCap;
      if (!cap.allowed) {
        const view = approvalsView(cap, caps);
        return json(429, { error: { code: "approve_cap", message: `${cap.used31} of ${caps.per31Days} approvals used. The proposal is still waiting.`, retryAt: view.retryAt }, approvals: view });
      }

      // Re-validate policy at approve time (§6): allow-list, sizes, text-only, summary, secret scan, hash.
      const policy = { denyConsoleUi: S.denyConsoleUi };
      const v = revalidate(rec, policy);

      const decidedAt = at().toISOString();
      const moved = await transition(deps.stores.proposals, loaded, "committing", { decidedAt, decidedBy: g.userId });
      if (!moved.ok) return conflict();
      let cur: Loaded = { record: moved.record, etag: moved.etag };

      if (!v.ok) {
        await transition(deps.stores.proposals, cur, "failed", { error: "The proposal failed its safety checks." });
        await audit("approve_refused_policy", { proposalId: id, detail: v.errors.slice(0, 5).join("; ") });
        return conflict("This proposal failed its safety checks and can't be approved.");
      }

      const out = await writer.commitProposal(cur.record, policy);
      if (out.status === "committed") {
        // 7a RECORD, then 7b MARK. If either fails, main HAS moved: answer 200 with the SHA, leave it committing.
        let status: "committed" | "committing" = "committing";
        try {
          await recordApprovalOnce(deps.stores, id, at()); // idempotent per proposal (R11)
          const done = await transition(deps.stores.proposals, cur, "committed", { commitSha: out.commitSha });
          if (done.ok) { status = "committed"; cur = { record: done.record, etag: done.etag }; }
        } catch {
          /* the reconciler records and marks it */
        }
        await audit(status === "committed" ? "committed" : "approve_record_pending", { proposalId: id, commitSha: out.commitSha });
        let approvals = null;
        try { approvals = approvalsView(await checkApproveCap(deps.stores.ratelimit, at(), caps), caps); } catch { approvals = null; }
        logLine({ msg: "approved", route: ROUTE, requestId, sub: g.userId, proposalId: id, commitSha: out.commitSha, status });
        return json(200, {
          proposal: { id, status, commitSha: out.commitSha, decidedAt },
          deploys: deploysOnCommit(rec.files.map((f) => f.path)),
          approvals,
        });
      }
      if (out.status === "stale") {
        await transition(deps.stores.proposals, cur, "stale", { error: "main changed under a file the agent read." });
        await audit("stale", { proposalId: id, detail: out.path });
        return error(409, "stale", "Out of date: main changed after this proposal. No approval was used.");
      }
      if (out.status === "failed") {
        await transition(deps.stores.proposals, cur, "failed", { error: out.error });
        await audit("commit_failed", { proposalId: id, detail: out.error });
        return error(502, "upstream", out.error);
      }
      // unknown: never assume failure; stay committing, the reconciler decides (§7 6c).
      await audit("commit_unknown", { proposalId: id, commitSha: out.commitSha });
      return error(502, "upstream", "Couldn't confirm the commit yet.");
    } catch {
      logLine({ msg: "approve_failed", route: ROUTE, requestId, proposalId: id });
      return internal();
    } finally {
      await releaseApproveLock(deps.stores.proposals, lock);
    }
  });
}

export function realDeps(): ApproveDeps {
  return {
    guard: guardFromEnv(),
    stores: realStores(),
    settings: SETTINGS,
    stepUp: approveStepUp,
    getWriter: (o = {}) => githubWriteFromEnv(o),
    now: Date.now,
  };
}

export default createApproveHandler(realDeps());

export const config: Config = { path: "/api/proposals/:id/approve", method: "POST" };
