// Agents list (docs/04 §11, ux-build-spec §3.2): one card per agent from GET /api/agents (no system prompts).
// Name, persona, personality, model as TEXT, knowledge counts with a closed <details> list, skills, and
// "Chat with {persona}". The agent colour is decoration only, set through CSSOM (CSP forbids style="").
// Ask the team (team_plan R-4): the agent the server flags teamLead:true is the "Ask the team" card at the top, selected
// by default, with its chat panel inside; the experts follow under their own h2 and the lead is not repeated there.
import { h, icon, say } from "./dom.js";

/** Agent colours from the frontmatter (claude-code-agent-authoring). Anything else falls back to the accent. */
const COLORS = new Set(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]);

export function skeletonList(count = 4) {
  const list = h("ul", { class: "agent-grid", "aria-hidden": "true" });
  for (let i = 0; i < count; i++) {
    list.append(h("li", { class: "agent-card" },
      h("div", { class: "skeleton" },
        h("div", { class: "skeleton__line skeleton__line--title" }),
        h("div", { class: "skeleton__line" }),
        h("div", { class: "skeleton__line skeleton__line--short" }))));
  }
  return list;
}

function knowledgeBlock(agent) {
  const k = agent.knowledge;
  if (!k || !Array.isArray(k.docs) || !Array.isArray(k.examples)) return null;
  const list = (items, label) => items.length ? [
    h("p", { class: "knowledge-heading" }, label),
    h("ul", { class: "knowledge-list" }, items.map((i) => h("li", {}, i.title || i.file || i.dir))),
  ] : [];
  const skills = Array.isArray(agent.skills) && agent.skills.length
    ? h("p", { class: "agent-card__skills" }, h("strong", {}, `${say("agents.skills")}: `), agent.skills.join(", "))
    : null;
  return h("details", { class: "disclosure", dataset: { testid: "agent-knowledge" } },
    h("summary", {}, icon("chevron-down"),
      say("agents.knowledge.counts", { docs: k.docs.length, examples: k.examples.length })),
    h("div", { class: "disclosure__body" },
      k.title ? h("p", { class: "knowledge-list__label" }, k.title) : null,
      ...list(k.docs, say("agents.knowledge.docs")),
      ...list(k.examples, say("agents.knowledge.examples")),
      skills));
}

/** One card. onChat(agent) opens the chat route. level: the persona heading level (2 alone, 3 under the experts h2). */
export function agentCard(agent, { onChat, level = 2 }) {
  const persona = agent.persona || agent.name;
  const headingId = `agent-${agent.name}`;
  const card = h("li", { class: "agent-card", dataset: { agent: agent.name, testid: "agent-card" } },
    h("div", { class: "agent-card__head" },
      h(level === 3 ? "h3" : "h2", { class: "agent-card__name", id: headingId }, persona),
      h("span", { class: "agent-card__role" }, agent.name),
      h("span", { class: "model-badge agent-card__model" },
        h("span", { class: "visually-hidden" }, `${say("agents.model")}: `), agent.modelLabel)),
    h("p", { class: "agent-card__personality" }, agent.personality || agent.description),
    knowledgeBlock(agent),
    h("div", { class: "agent-card__actions" },
      h("button", { class: "btn btn--primary", type: "button", dataset: { testid: "agent-chat" },
        onclick: () => onChat(agent) }, say("agents.chat.with", { agent: persona }))));
  if (COLORS.has(agent.color)) card.style.setProperty("--agent-color", `var(--agent-${agent.color}, ${agent.color})`);
  return card;
}

/** The team lead is the agent the server flags (GET /api/agents teamLead:true); never matched by name. */
export const findTeamLead = (agents) => (Array.isArray(agents) ? agents.find((a) => a?.teamLead === true) ?? null : null);

/**
 * The "Ask the team" card (visual-system §10, ux-build-spec §3.4): always the selected entry on #/console, and one
 * block with the lead's chat panel (chatEl). Selected = aria-current plus the frame AND the badge word, never colour alone.
 */
export function teamCard(lead, chatEl) {
  return h("section", { class: "team-card team-card--selected", "aria-labelledby": "team-card-title", "aria-current": "true",
    dataset: { testid: "team-card", agent: lead.name, selected: "true" } },
    h("div", { class: "team-card__head" },
      h("h2", { class: "team-card__title", id: "team-card-title" }, say("agents.team.title")),
      h("span", { class: "team-card__badge", dataset: { testid: "team-card-badge" } }, say("agents.team.badge"))),
    h("p", { class: "team-card__sub" }, say("agents.team.sub")),
    chatEl);
}

/**
 * The whole list, in the order served (sorted by name on the server). With a team lead, the lead is left out here
 * (its card sits above): the "Or ask one expert" h2.expert-list__heading sits above ul.expert-list (which it labels),
 * so the expert names are h3. Returns an array of nodes in that case.
 */
export function agentList(agents, { onChat, lead = null }) {
  const experts = lead ? agents.filter((a) => a !== lead) : agents;
  if (lead && !experts.length) return null; // §3.4: heading and list hidden when no other agent exists
  if (!lead) return h("ul", { class: "agent-grid", dataset: { testid: "agent-list" } }, agents.map((a) => agentCard(a, { onChat })));
  return [
    h("h2", { class: "expert-list__heading", id: "experts-heading", dataset: { testid: "experts-heading" } }, say("agents.experts.heading")),
    h("ul", { class: "expert-list", "aria-labelledby": "experts-heading", dataset: { testid: "agent-list" } },
      experts.map((a) => agentCard(a, { onChat, level: 3 }))),
  ];
}
