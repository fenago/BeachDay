// GET /api/jobs/:id: poll a background job (docs/04 §2, §8; job-view schema). Owner only: any other caller gets the
// same 404 as a missing job, so ids can't be probed. Never returns messages, owner, nonceHash or baseSha.
import type { Config } from "@netlify/functions";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { realStores, type Stores } from "./lib/blobs.mts";
import { error, json } from "./lib/http.mts";
import { isJobId } from "./lib/ids.mts";
import { jobView, type JobRecord } from "./lib/jobs.mts";
import { authorize, methodNotAllowed, badRequest, unavailable, type Ctx } from "./lib/handler.mts";

const ROUTE = "GET /api/jobs/:id";

export interface JobStatusDeps { guard: Guard; stores: Stores }

export function createJobStatusHandler(deps: JobStatusDeps) {
  return async function jobStatus(req: Request, context: Ctx): Promise<Response> {
    if (req.method !== "GET") return methodNotAllowed("GET");
    const g = await authorize(deps.guard, req, ROUTE, context?.requestId);
    if (g instanceof Response) return g;
    const id = context?.params?.id;
    if (!isJobId(id)) return badRequest("That job id isn't valid."); // before any Blobs read
    let job: JobRecord | null;
    try {
      job = ((await deps.stores.jobs.getWithMetadata(id, { type: "json" }))?.data as JobRecord) ?? null;
    } catch {
      return unavailable();
    }
    if (!job || job.owner !== g.userId) return error(404, "not_found", "That job no longer exists.");
    return json(200, jobView(job));
  };
}

export function realDeps(): JobStatusDeps {
  return { guard: guardFromEnv(), stores: realStores() };
}

export default createJobStatusHandler(realDeps());

export const config: Config = { path: "/api/jobs/:id", method: "GET" };
