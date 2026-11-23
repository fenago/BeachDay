import { describe, it, expect } from "vitest";
import { createAgentRegistry, validateAgent, isAllowedModel } from "../../../netlify/functions/lib/agents.mts";

const agent = (over = {}) => ({ name: "qa-engineer", persona: "Tess", description: "Tests.", personality: "Careful.", model: "claude-sonnet-5-5", modelLabel: "Sonnet", color: "green", skills: ["beach-day-context"], knowledge: { path: "knowledge/qa-engineer/", title: "QA", docs: [{ file: "docs/01.md", title: "One" }], examples: [] }, systemPrompt: "You are Tess.", ...over });

describe("agents registry", () => {
  it("lists agents sorted, without systemPrompt; get() returns the prompt server-side", () => {
    const r = createAgentRegistry([agent({ name: "zeta" }), agent()]);
    expect(r.names()).toEqual(["qa-engineer", "zeta"]);
    for (const a of r.list()) expect("systemPrompt" in a).toBe(false);
    expect(JSON.stringify(r.list())).not.toContain("You are Tess.");
    expect(r.get("qa-engineer").systemPrompt).toBe("You are Tess.");
    expect(r.get("nobody")).toBeUndefined();
    expect(r.get({ toString: () => "qa-engineer" })).toBeUndefined();
  });
  it("re-checks the model allow-list and fails on fable, full ids or unknown values", () => {
    for (const m of ["claude-fable-5-2", "opus", "claude-opus-5-5-20261101", undefined]) expect(() => validateAgent(agent({ model: m }))).toThrow(/allow-list/);
    expect(validateAgent(agent({ model: "claude-haiku-5-5" })).modelLabel).toBe("Haiku");
    expect(isAllowedModel("claude-opus-5-5")).toBe(true);
  });
  it("personality falls back to description; bad shapes and duplicates throw", () => {
    expect(validateAgent(agent({ personality: "" })).personality).toBe("Tests.");
    expect(() => createAgentRegistry({})).toThrow();
    expect(() => createAgentRegistry([agent(), agent()])).toThrow(/duplicate/);
    expect(() => validateAgent(agent({ name: "../x" }))).toThrow();
    expect(() => validateAgent(agent({ systemPrompt: "" }))).toThrow();
  });
});
