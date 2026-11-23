// Stand-in (see _standin.mts). Not product code. Like the real background function it ALWAYS answers 202 and refuses silently.
import { standIn } from "./_standin.mts";
const inner = standIn("job-run", { method: "POST", secretReader: true });
export const createJobRunHandler = (deps: any) => {
  const h = inner(deps);
  return async (req: Request, ctx: any): Promise<Response> => { await h(req, ctx); return new Response(null, { status: 202, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); };
};
