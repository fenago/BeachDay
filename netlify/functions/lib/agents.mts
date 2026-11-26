// Agent registry from the build-generated agents.json (scripts/build-agents.mjs, build_plan §5, docs/04 §11).
// The file is git-ignored and bundled via netlify.toml included_files / the JSON import. It is DATA:
// every entry is re-checked here (the model allow-list again, docs/04 §8), and GET /api/agents never
// returns systemPrompt.
import { SETTINGS } from "./settings.mts";

export interface AgentKnowledge { path: string; title: string; docs: Array<{ file: string; title: string }>; examples: Array<{ dir: string; title: string }> }
export interface Agent {
  name: string;
  persona: string;
  description: string;
  personality: string;
  model: string;
  modelLabel: "Opus" | "Sonnet" | "Haiku";
  color: string;
  skills: string[];
  knowledge: AgentKnowledge;
  systemPrompt: string;
}
/** `teamLead: true` only on SETTINGS.team.leadAgent ("Ask the team", team_plan R-4); the UI keys on it, not the name. */
export type PublicAgent = Omit<Agent, "systemPrompt"> & { teamLead?: true };

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LABEL: Readonly<Record<string, Agent["modelLabel"]>> = Object.freeze({
  "claude-opus-5-5": "Opus",
  "claude-sonnet-5-5": "Sonnet",
  "claude-haiku-5-5": "Haiku",
});

export const isAllowedModel = (id: unknown): id is string => typeof id === "string" && SETTINGS.allowedModels.includes(id);

/** Throws with the agent name on a bad entry (never prints the prompt). */
export function validateAgent(a: any): Agent {
  const who = typeof a?.name === "string" ? a.name.slice(0, 64) : "<unnamed>";
  if (!a || typeof a !== "object") throw new Error("agents.json: entry is not an object");
  if (typeof a.name !== "string" || !NAME.test(a.name)) throw new Error(`agents.json: bad name ${JSON.stringify(who)}`);
  if (!isAllowedModel(a.model)) throw new Error(`agents.json: ${who} has a model outside the Console allow-list`);
  if (typeof a.systemPrompt !== "string" || a.systemPrompt.length === 0) throw new Error(`agents.json: ${who} has no systemPrompt`);
  if (typeof a.description !== "string") throw new Error(`agents.json: ${who} has no description`);
  return {
    name: a.name,
    persona: typeof a.persona === "string" ? a.persona : "",
    description: a.description,
    personality: typeof a.personality === "string" && a.personality ? a.personality : a.description,
    model: a.model,
    modelLabel: LABEL[a.model],
    color: typeof a.color === "string" ? a.color : "",
    skills: Array.isArray(a.skills) ? a.skills.filter((s: unknown) => typeof s === "string") : [],
    knowledge: a.knowledge && typeof a.knowledge === "object"
      ? {
          path: String(a.knowledge.path ?? ""),
          title: String(a.knowledge.title ?? ""),
          docs: Array.isArray(a.knowledge.docs) ? a.knowledge.docs.map((d: any) => ({ file: String(d?.file ?? ""), title: String(d?.title ?? "") })) : [],
          examples: Array.isArray(a.knowledge.examples) ? a.knowledge.examples.map((d: any) => ({ dir: String(d?.dir ?? ""), title: String(d?.title ?? "") })) : [],
        }
      : { path: "", title: "", docs: [], examples: [] },
    systemPrompt: a.systemPrompt,
  };
}

export function publicAgent(a: Agent, leadAgent: string = SETTINGS.team.leadAgent): PublicAgent {
  const { systemPrompt: _omit, ...rest } = a;
  return a.name === leadAgent ? { ...rest, teamLead: true } : rest;
}

export interface AgentRegistry {
  list(): PublicAgent[];
  get(name: unknown): Agent | undefined;
  names(): string[];
}

export function createAgentRegistry(raw: unknown, { leadAgent = SETTINGS.team.leadAgent }: { leadAgent?: string } = {}): AgentRegistry {
  if (!Array.isArray(raw)) throw new Error("agents.json: not an array");
  const agents = raw.map(validateAgent).sort((x, y) => (x.name < y.name ? -1 : 1));
  const byName = new Map(agents.map((a) => [a.name, a]));
  if (byName.size !== agents.length) throw new Error("agents.json: duplicate agent name");
  return {
    list: () => agents.map((a) => publicAgent(a, leadAgent)),
    get: (name) => (typeof name === "string" ? byName.get(name) : undefined),
    names: () => agents.map((a) => a.name),
  };
}

let cached: Promise<AgentRegistry> | null = null;

/** Production loader: lazy JSON import (esbuild bundles it). A missing or bad file rejects -> handler 500. */
export function loadAgentRegistry(): Promise<AgentRegistry> {
  cached ??= import("./agents.json", { with: { type: "json" } })
    .then((m: any) => createAgentRegistry(m.default))
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
}
