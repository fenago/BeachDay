// GET /api/jobs/:id — the Console polls this every 2–3 s while a
// background job runs. Named path group -> context.params.id.
import { store } from "./lib/blobs.mjs";
import { json } from "./lib/http.mjs";
import { guard } from "./lib/guard.mjs";

const ID_RE = /^[a-z0-9-]{8,64}$/;

export default async (req, context) => {
  const auth = await guard(req); // FIRST line of every /api/* handler
  if (auth.response) return auth.response;
  const id = context.params?.id ?? "";
  if (!ID_RE.test(id)) return json(400, { error: "invalid_id" });

  const job = await store("jobs").get(id, { type: "json" });
  if (job === null) return json(404, { error: "not_found" });

  // Never return the token hash or internal fields.
  const { status, events = [], result = null, error = null } = job;
  return json(200, { id, status, events, result, error });
};

export const config = {
  path: "/api/jobs/:id",
  excludedPath: "/api/jobs/run", // the background function owns that path
  method: "GET",
};
