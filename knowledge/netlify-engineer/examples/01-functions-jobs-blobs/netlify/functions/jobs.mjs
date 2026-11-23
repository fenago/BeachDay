// POST /api/jobs — the SYNC wrapper in front of the background worker.
// A background function always answers 202, so it cannot say "401". This
// function does the auth check and the limits, creates the job record, and
// only then starts the worker with a one-time token (only its hash is stored).
// Shows: guard first, config.path/method/rateLimit (one of the 2 Free-plan
// rules), own security headers, body-size and shape validation, onlyIfNew.
import { createHash, randomBytes } from "node:crypto";
import { guard } from "./lib/guard.mjs";
import { json } from "./lib/http.mjs";
import { store } from "./lib/blobs.mjs";

const MAX_BODY = 64 * 1024; // docs/04: 64 KB for everything except proposals

let trigger = async () => { throw new Error("trigger not configured"); };
export const setTrigger = (fn) => { trigger = fn; }; // real code: fetch("/api/jobs/run", ...)

export default async (req, _context) => {
  const auth = await guard(req); // FIRST, before reading the body
  if (auth.response) return auth.response;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too_large" });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "invalid_json" }); }
  if (typeof body?.agent !== "string" || !/^[a-z0-9-]{1,64}$/.test(body.agent)) return json(400, { error: "invalid_input" });

  const id = `job-${randomBytes(8).toString("hex")}`;
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const created = await store("jobs").setJSON(id, { id, status: "queued", owner: auth.user.id, agent: body.agent, tokenHash, events: [] }, { onlyIfNew: true });
  if (!created.modified) return json(500, { error: "try_again" });

  await trigger({ jobId: id, token });
  return json(202, { id });
};

export const config = {
  path: "/api/jobs",
  method: "POST",
  // Free plan: 2 code-based rules per project (this one and /api/chat).
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
