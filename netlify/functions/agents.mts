// GET /api/agents: the agent cards, and the Console's access check (docs/04 §1 step 2, §11; R12 {agents: [...]}).
// Never returns systemPrompt. Reads no secret, so there is no production check (build-contracts §2.2 step 4).
import type { Config } from "@netlify/functions";
import { guardFromEnv, type Guard } from "./lib/guard.mts";
import { loadAgentRegistry, type AgentRegistry } from "./lib/agents.mts";
import { json } from "./lib/http.mts";
import { authorize, methodNotAllowed, internal, logLine, type Ctx } from "./lib/handler.mts";

const ROUTE = "GET /api/agents";

export interface AgentsDeps { guard: Guard; registry: () => Promise<AgentRegistry> }

export function createAgentsHandler(deps: AgentsDeps) {
  return async function agents(req: Request, context: Ctx): Promise<Response> {
    if (req.method !== "GET") return methodNotAllowed("GET");
    const g = await authorize(deps.guard, req, ROUTE, context?.requestId);
    if (g instanceof Response) return g;
    try {
      const reg = await deps.registry();
      return json(200, { agents: reg.list() });
    } catch {
      logLine({ msg: "agents_registry_failed", route: ROUTE, requestId: context?.requestId });
      return internal();
    }
  };
}

export function realDeps(): AgentsDeps {
  return { guard: guardFromEnv(), registry: loadAgentRegistry };
}

export default createAgentsHandler(realDeps());

export const config: Config = { path: "/api/agents", method: "GET" };
