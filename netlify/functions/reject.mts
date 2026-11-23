// POST /api/proposals/:id/reject {} | {reason}: pending -> rejected by CAS (docs/04 §1 step 7, §2.1).
// Reads no secret and never calls GitHub, so there is no production check. `reason` is display text only (<= 500).
import type { Config } from "@netlify/functions";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { realStores, type Stores } from "./lib/blobs.mts";
import { error, json } from "./lib/http.mts";
import { isProposalId } from "./lib/ids.mts";
import { loadProposal, transition, writeAudit } from "./lib/proposals.mts";
import { authorize, methodNotAllowed, badRequest, readJson, isPlainObject, onlyKeys, unavailable, MAX_SMALL_BODY, type Ctx } from "./lib/handler.mts";

const ROUTE = "POST /api/proposals/:id/reject";

export interface RejectDeps { guard: Guard; stores: Stores; now: () => number }

export function createRejectHandler(deps: RejectDeps) {
  return async function reject(req: Request, context: Ctx): Promise<Response> {
    const requestId = context?.requestId;
    if (req.method !== "POST") return methodNotAllowed("POST");
    const g = await authorize(deps.guard, req, ROUTE, requestId);
    if (g instanceof Response) return g;
    const id = context?.params?.id;
    if (!isProposalId(id)) return badRequest("That proposal id isn't valid.");
    const body = await readJson(req, MAX_SMALL_BODY, { allowEmpty: true });
    if (!body.ok || !isPlainObject(body.value) || !onlyKeys(body.value, ["reason"])) return badRequest();
    const reason = body.value.reason;
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 500 || !reason.isWellFormed())) return badRequest("The reason must be text of at most 500 characters.");

    try {
      const loaded = await loadProposal(deps.stores.proposals, id);
      if (!loaded) return error(404, "not_found", "That proposal no longer exists.");
      if (loaded.record.status !== "pending") return error(409, "conflict", "This proposal isn't waiting any more. Reload it.");
      const decidedAt = new Date(deps.now()).toISOString();
      const t = await transition(deps.stores.proposals, loaded, "rejected", { decidedAt, decidedBy: g.userId, ...(reason ? { rejectReason: reason } : {}) });
      if (!t.ok) return error(409, "conflict", "This proposal changed while you were looking. Reload it.");
      await writeAudit(deps.stores.audit, { action: "rejected", actor: g.userId, proposalId: id, requestId }, new Date(deps.now())).catch(() => {});
      return json(200, { proposal: { id, status: "rejected", decidedAt } });
    } catch {
      return unavailable();
    }
  };
}

export function realDeps(): RejectDeps {
  return { guard: guardFromEnv(), stores: realStores(), now: Date.now };
}

export default createRejectHandler(realDeps());

export const config: Config = { path: "/api/proposals/:id/reject", method: "POST" };
