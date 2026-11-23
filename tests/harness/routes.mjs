// The /api/* route table, from docs/04 §2 and build_plan §5/§2 (file names: agents, chat, jobs, job-run, job-status,
// proposal, approve, reject). tests/functions/matrix.test.mjs checks this registry against the docs/04 §2 table.
export const API_ROUTES = Object.freeze([
  { key: "GET /api/agents",                 method: "GET",  pattern: "/api/agents",                       module: "agents",     factory: "createAgentsHandler" },
  { key: "POST /api/chat",                  method: "POST", pattern: "/api/chat",                         module: "chat",       factory: "createChatHandler" },
  { key: "POST /api/jobs",                  method: "POST", pattern: "/api/jobs",                         module: "jobs",       factory: "createJobsHandler" },
  { key: "POST /api/jobs-run",              method: "POST", pattern: "/api/jobs-run",                     module: "job-run",    factory: "createJobRunHandler", background: true },
  { key: "GET /api/jobs/:id",               method: "GET",  pattern: "/api/jobs/:id",                     module: "job-status", factory: "createJobStatusHandler" },
  { key: "GET /api/proposals/:id",          method: "GET",  pattern: "/api/proposals/:id",                module: "proposal",   factory: "createProposalHandler" },
  { key: "POST /api/proposals/:id/approve", method: "POST", pattern: "/api/proposals/:id/approve",        module: "approve",    factory: "createApproveHandler" },
  { key: "POST /api/proposals/:id/reject",  method: "POST", pattern: "/api/proposals/:id/reject",         module: "reject",     factory: "createRejectHandler" },
]);

const compile = (pattern) => new RegExp("^" + pattern.replace(/:([A-Za-z_]+)/g, "(?<$1>[^/]+)") + "/?$");
const COMPILED = API_ROUTES.map((r) => ({ ...r, re: compile(r.pattern) }));

/** Match a path. The method is NOT part of the match (a handler answers 400 invalid_request for a wrong method itself). */
export function matchRoute(pathname) {
  for (const r of COMPILED) {
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: { ...(m.groups ?? {}) } };
  }
  return null;
}
