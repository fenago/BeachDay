// STAND-IN handlers (NOT product code). They follow the check order in docs/design/build-contracts.md §2.2
// (method, guard, Origin on POST, production check, :id shape) so tests/functions/matrix-selftest.test.mjs can prove the
// matrix cells and the planted-bug mutants against the REAL guard, origin and http libs and the fake Supabase.
// The real matrix (tests/functions/matrix.test.mjs) runs the same cells against netlify/functions/*.mts.
import { guardFromEnv, denyResponse } from "../../../../netlify/functions/lib/guard.mts";
import { checkOrigin, originDenyResponse } from "../../../../netlify/functions/lib/origin.mts";
import { json, error } from "../../../../netlify/functions/lib/http.mts";
import { isProposalId, isJobId } from "../../../../netlify/functions/lib/ids.mts";

type Opts = { method: "GET" | "POST"; secretReader?: boolean; id?: "proposal" | "job" };
export function standIn(name: string, o: Opts) {
  return (deps: any) => {
    const guard = deps.guard ?? guardFromEnv();
    return async (req: Request, ctx: any): Promise<Response> => {
      if (req.method !== o.method) return error(400, "invalid_request", "Wrong method.");
      const g = await guard.check(req, { route: name, requestId: ctx.requestId });
      if (!g.ok) return denyResponse(g);
      if (o.method === "POST") { const r = checkOrigin(req); if (!r.ok) return originDenyResponse(r); }
      if (o.secretReader && ctx.deploy.context !== "production") return error(503, "unavailable", "Not available here.");
      if (o.id) {
        const id = ctx.params.id ?? "";
        const ok = o.id === "proposal" ? isProposalId(id) : isJobId(id);
        if (!ok) return error(400, "invalid_request", "Bad id.");
        if (o.method === "GET") return error(404, "not_found", "No such record.");
      }
      return json(200, { ok: true, route: name });
    };
  };
}
