// GET /api/proposals/:id: {proposal, diffs, deploys, approveEnabled, approvals} for the card and the Approve sheet
// (docs/04 §1 step 5, §2.1; proposal-view schema). It runs the §7 reconciler and reads files for the diffs, so it
// reads GitHub: production check FIRST, and the READ-ONLY module only (never github-write; ADR-0007).
// One deadline signal bounds every GitHub read (the 8 s diff budget only bounds diff CPU, not the reads).
import type { Config } from "@netlify/functions";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { realStores, type Stores } from "./lib/blobs.mts";
import { SETTINGS } from "./lib/settings.mts";
import { error, json } from "./lib/http.mts";
import { isProposalId } from "./lib/ids.mts";
import { githubReadFromEnv, type GitHubRead } from "./lib/github-read.mts";
import { loadProposal, needsReconcile, acquireApproveLock, releaseApproveLock } from "./lib/proposals.mts";
import { reconcile, type Loaded } from "./lib/reconcile.mts";
import { proposalDiffs } from "./lib/diff.mts";
import { deploysOnCommit } from "./lib/deploys.mts";
import { checkApproveCap } from "./lib/limits.mts";
import { authorize, methodNotAllowed, isProduction, notProduction, badRequest, unavailable, approvalsView, type Ctx, type Settings } from "./lib/handler.mts";

const ROUTE = "GET /api/proposals/:id";
export const PROPOSAL_DEADLINE_MS = 45_000; // a sync function stops at 60 s

export interface ProposalDeps { guard: Guard; stores: Stores; settings: Settings; getReader: (o: { signal: AbortSignal }) => GitHubRead; now: () => number }

export function createProposalHandler(deps: ProposalDeps) {
  return async function proposal(req: Request, context: Ctx): Promise<Response> {
    const startedAt = deps.now();
    const requestId = context?.requestId;
    if (req.method !== "GET") return methodNotAllowed("GET");
    const g = await authorize(deps.guard, req, ROUTE, requestId);
    if (g instanceof Response) return g;
    if (!isProduction(context)) return notProduction(); // before the GitHub token is read
    const id = context?.params?.id;
    if (!isProposalId(id)) return badRequest("That proposal id isn't valid.");

    let loaded: Loaded | null;
    try {
      loaded = await loadProposal(deps.stores.proposals, id);
    } catch {
      return unavailable();
    }
    if (!loaded) return error(404, "not_found", "That proposal no longer exists.");

    const signal = AbortSignal.timeout(Math.max(1, PROPOSAL_DEADLINE_MS - (deps.now() - startedAt)));
    let reader: GitHubRead;
    try {
      reader = deps.getReader({ signal });
    } catch {
      return unavailable();
    }

    // Reconciler: only for a stuck `committing` record, only under the approve lock (skip if it is held).
    if (needsReconcile(loaded.record, deps.now())) {
      const lock = await acquireApproveLock(deps.stores.proposals, `get:${requestId ?? "x"}`, deps.now()).catch(() => null);
      if (lock) {
        try {
          const fresh = await loadProposal(deps.stores.proposals, id);
          if (fresh) loaded = await reconcile(deps, fresh, (p) => reader.findProposalCommit(p), { actor: g.userId, requestId });
        } catch {
          /* leave it committing; the next GET tries again */
        } finally {
          await releaseApproveLock(deps.stores.proposals, lock);
        }
      }
    }

    const record = loaded.record;
    const diffs = await proposalDiffs(record.files, async (path) => (await reader.readFile(path, record.baseSha))?.text ?? null, { now: deps.now });

    let approvals = null; // advisory display only; a failed read never blocks Approve
    try {
      approvals = approvalsView(await checkApproveCap(deps.stores.ratelimit, new Date(deps.now()), deps.settings.approveCap), deps.settings.approveCap);
    } catch {
      approvals = null;
    }

    return json(200, {
      proposal: record,
      diffs,
      deploys: deploysOnCommit(record.files.map((f) => f.path)),
      approveEnabled: deps.settings.approveEnabled === true,
      approvals,
    });
  };
}

export function realDeps(): ProposalDeps {
  return { guard: guardFromEnv(), stores: realStores(), settings: SETTINGS, getReader: ({ signal }) => githubReadFromEnv({ signal }), now: Date.now };
}

export default createProposalHandler(realDeps());

export const config: Config = { path: "/api/proposals/:id", method: "GET" };
