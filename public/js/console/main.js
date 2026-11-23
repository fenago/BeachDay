// Agents page boot and hash router (build-contracts §4; docs/04 §1).
// Routes: #/console (list) · #/console/agent/:name (chat) · #/console/proposal/:id · #/console/security (Cass's S12).
// - No session → Cass's auth screens (mountAuthScreens). With a session → GET /api/agents is the access check.
// - 403 → S6 (no more /api calls). 503 → "Couldn't check your access" with Try Again, never S6.
// - 401 mid-session → S7 in a separate host; the app host (chat transcripts, drafts) is hidden, not destroyed.
// - Nothing in the URL or in storage ever approves. A Google step-up return only reopens the sheet.
import * as config from "../../generated/config.js";
import * as copy from "../copy/copy-deck.js";
import { createAuth } from "./auth.js";
import { createApi } from "./api.js";
import { h, icon, say, clear, focusHeading, banner } from "./dom.js";
import { agentList, skeletonList } from "./agents.js";
import { createChatView } from "./chat.js";
import { proposalCard } from "./proposal.js";
import { openApproveSheet, takeStepUpProposal } from "./approve-sheet.js";

const PROPOSAL_ID_RE = /^p_[0-9A-Z]{26}$/;
const AGENT_RE = /^[a-z][a-z0-9-]{1,63}$/;

export function parseRoute(hash) {
  const m = /^#\/console(?:\/(agent|proposal|security)(?:\/([A-Za-z0-9_-]{1,64}))?)?\/?$/.exec(hash || "");
  if (!m || !m[1]) return { name: "list" };
  if (m[1] === "agent" && AGENT_RE.test(m[2] ?? "")) return { name: "agent", agent: m[2] };
  if (m[1] === "proposal" && PROPOSAL_ID_RE.test(m[2] ?? "")) return { name: "proposal", id: m[2] };
  if (m[1] === "security" && !m[2]) return { name: "security" };
  return { name: "list" };
}

async function boot() {
  const root = document.getElementById("console-root");
  const authHost = h("div", { class: "console", dataset: { testid: "auth-host" } });
  const appHost = h("div", { class: "console", dataset: { testid: "app-host" } });
  root.replaceChildren(authHost, appHost);

  let auth;
  try { auth = createAuth({ config }); } catch {
    return clear(appHost, stateCard("error", say("agents.title"), say("console.check.failed")));
  }

  // ---- state (memory only) ----
  let access = "unknown";           // unknown | ok | denied
  let agents = [];
  let accountId = null;
  const chats = new Map();          // agent name -> chat view (transcript + draft survive route changes and S7)
  let screens = null;               // mounted auth screens
  let reopenStepUp = null;          // proposal id to reopen confirmed after a Google step-up
  let redirectResult = { kind: "none" };
  let signingOut = false;           // true while a Sign Out button runs (R14-1)
  let pendingNotice = null;         // e.g. auth.reset.done after S5; shown once on the next page bar

  const api = createApi({ auth, onSessionEnded: () => showAuth("sessionExpired"), onNoAccess: () => showNoAccess() });

  // ---- auth screens (Cass) ----
  async function loadScreens() {
    try { return await import("./auth-screens.js"); } catch { return null; }
  }

  /** notice: sessionExpired (S7) | signedOut | signedOutAll | emailConfirmed | undefined */
  async function showAuth(notice) {
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
    const hash = location.hash || "#/console";
    const keepRoute = parseRoute(hash).name !== "list" ? hash : null; // a content route is where sign-in returns to
    appHost.hidden = true;
    screens?.unmount?.();
    screens = null;
    const mod = await loadScreens();
    authHost.hidden = false;
    if (!mod?.mountAuthScreens) {
      clear(authHost, stateCard("error", say("auth.signin.title"), say("console.error.screens")));
      return focusHeading(authHost);
    }
    const route = hash; // auth-screens renders S1 for a content route and keeps it as the return route
    screens = mod.mountAuthScreens(authHost, {
      auth, copy, route, notice, redirectResult, returnRoute: keepRoute, draftKept: hasAnyDraft(),
      onSignedIn: (r) => onSignedIn(r?.returnRoute, r?.noticeId),
    });
    redirectResult = { kind: "none" }; // a Google error is shown once
  }

  async function onSignedIn(returnRoute, noticeId) {
    pendingNotice = typeof noticeId === "string" ? noticeId : null;
    screens?.unmount?.();
    screens = null;
    clear(authHost);
    authHost.hidden = true;
    appHost.hidden = false;
    const target = typeof returnRoute === "string" && parseRoute(returnRoute).name !== "list" ? returnRoute : "#/console";
    if (location.hash !== target) history.replaceState(history.state, "", `/console${target}`);
    const acct = await auth.getAccount();
    if (acct?.id && accountId && acct.id !== accountId) { chats.clear(); access = "unknown"; } // another person: drop the old transcripts
    accountId = acct?.id ?? null;
    if (access !== "ok") await checkAccess(); else render();
  }

  async function signOutControls(prominent = false) {
    const mod = await loadScreens();
    if (!mod?.createSignOutControls) return null;
    // Wrap signOut so the SIGNED_OUT event from a deliberate sign-out doesn't flash S7.
    const deliberate = { ...auth, signOut: (o) => { signingOut = true; return auth.signOut(o); } };
    return mod.createSignOutControls({ auth: deliberate, copy, prominent, onSignedOut: ({ notice }) => {
      signingOut = false;
      chats.clear(); access = "unknown"; accountId = null;
      showAuth(notice);
    } });
  }

  // ---- access check (docs/04 §1 step 2) ----
  async function checkAccess() {
    const list = skeletonList();
    const status = h("p", { class: "status-line", role: "status" }, say("console.checking"));
    clear(appHost, pageBar(say("agents.title"), say("agents.sub")), status, h("div", { "aria-busy": "true" }, list));
    focusHeading(appHost);
    try {
      agents = await api.agents();
      access = "ok";
      accountId = (await auth.getAccount())?.id ?? null;
      render();
    } catch (err) {
      if (err?.code === "forbidden" || err?.code === "unauthorized") return; // S6 / S7 already shown
      clear(appHost, stateCard("error", say("agents.title"), err?.offline ? say("auth.error.network") : say("console.check.failed"),
        h("button", { class: "btn btn--primary", type: "button", dataset: { testid: "retry-access" }, onclick: () => checkAccess() }, say("btn.tryAgain"))));
      focusHeading(appHost);
    }
  }

  async function showNoAccess() {
    access = "denied";
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
    const acct = await auth.getAccount();
    appHost.hidden = false;
    clear(appHost, stateCard("denied", say("console.noaccess.title"),
      [say("console.noaccess.body", { email: acct?.email || "—" }), say("console.noaccess.other")],
      await signOutControls(true),
      h("a", { class: "btn btn--secondary", href: "/" }, say("btn.backToBeach"))));
    appHost.querySelector(".state-card").dataset.testid = "no-access";
    focusHeading(appHost);
  }

  // ---- views ----
  function pageBar(title, sub) {
    let notice = "";
    if (pendingNotice) { try { notice = say(pendingNotice); } catch { notice = ""; } pendingNotice = null; }
    return h("div", { class: "panel console-bar" },
      h("div", {}, h("h1", { tabindex: "-1" }, title), sub ? h("p", { class: "console-sub" }, sub) : null,
        h("p", { class: "status-line", role: "status", dataset: { testid: "console-notice" } }, notice)),
      accountMenu());
  }

  function accountMenu() {
    const who = h("span", { class: "account-menu__who", dataset: { testid: "account-email" } });
    const menu = h("div", { class: "account-menu console-bar__actions" }, who,
      h("a", { class: "btn btn--text btn--sm", href: "#/console/security", dataset: { testid: "security-link" } }, say("agents.menu.security")));
    auth.getAccount().then((a) => { if (a?.email) who.textContent = say("agents.account", { email: a.email }); });
    signOutControls().then((c) => { if (c) menu.append(c); });
    return menu;
  }

  const backLink = () => h("a", { class: "btn btn--text back-link", href: "#/console", dataset: { testid: "back-to-agents" } }, icon("chevron-left"), say("agents.back"));

  function renderList() {
    if (!agents.length) {
      clear(appHost, pageBar(say("agents.title")), stateCard("info", null, say("agents.empty"),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => checkAccess() }, say("btn.tryAgain"))));
      return;
    }
    clear(appHost, pageBar(say("agents.title"), say("agents.sub")),
      agentList(agents, { onChat: (a) => { location.hash = `#/console/agent/${a.name}`; } }));
  }

  function chatFor(agent) {
    if (!chats.has(agent.name)) {
      chats.set(agent.name, createChatView({ agent, api, renderProposal: (id, ph) => loadProposalInto(id, ph) }));
    }
    return chats.get(agent.name);
  }

  function renderChat(name) {
    const agent = agents.find((a) => a.name === name);
    if (!agent) return renderList();
    const view = chatFor(agent);
    clear(appHost, h("div", { class: "chat-head" }, backLink(), h("h1", { tabindex: "-1" }, agent.persona || agent.name),
      h("span", { class: "model-badge" }, h("span", { class: "visually-hidden" }, `${say("agents.model")}: `), agent.modelLabel)),
      view.el);
  }

  const hasAnyDraft = () => [...chats.values()].some((c) => c.hasDraft());

  async function loadProposalInto(id, placeholder, { confirmed = false } = {}) {
    let view;
    try { view = await api.proposal(id); } catch (err) {
      if (err?.code === "unauthorized" || err?.code === "forbidden") return null;
      const msg = err?.code === "not_found" ? say("agents.proposal.missing") : say("console.check.failed");
      placeholder.replaceWith(banner("error", "alert", msg));
      return null;
    }
    const card = proposalCard(view, {
      onReview: (c) => openApproveSheet({ auth, api, card: c, hasDraft: hasAnyDraft }),
      onReject: async (c, v) => {
        try { const r = await api.reject(v.proposal.id); c.update({ ...c.view, proposal: { ...c.view.proposal, ...(r?.proposal ?? { status: "rejected" }) } }); }
        catch (err) {
          if (err?.code === "conflict") { try { c.update(await api.proposal(v.proposal.id)); } catch { /* keep */ } }
          else if (!["unauthorized", "forbidden"].includes(err?.code)) c.alert.textContent = say("console.check.failed");
        }
      },
    });
    placeholder.replaceWith(card);
    if (confirmed && card.view.proposal.status === "pending") openApproveSheet({ auth, api, card, hasDraft: hasAnyDraft, confirmed: true });
    return card;
  }

  async function renderProposal(id) {
    const ph = h("p", { class: "status-line", role: "status" }, say("agents.proposal.loading"));
    clear(appHost, h("div", { class: "chat-head" }, backLink(), h("h1", { tabindex: "-1" }, say("agents.proposal.title"))), ph);
    const confirmed = reopenStepUp === id;
    reopenStepUp = null;
    await loadProposalInto(id, ph, { confirmed });
  }

  async function renderSecurity() {
    const mod = await loadScreens();
    const host = h("div", { class: "console" });
    clear(appHost, h("div", { class: "chat-head" }, backLink()), host);
    if (!mod?.mountAuthScreens) return clear(host, stateCard("error", say("agents.menu.security"), say("console.error.screens")));
    const sub = mod.mountAuthScreens(host, { auth, copy, route: "#/console/security",
      onDone: () => { sub.unmount(); location.hash = "#/console"; },
      onSessionEnded: () => { sub.unmount(); showAuth("sessionExpired"); } });
  }

  function render() {
    if (access !== "ok") return;
    const r = parseRoute(location.hash);
    if (r.name === "agent") renderChat(r.agent);
    else if (r.name === "proposal") renderProposal(r.id);
    else if (r.name === "security") renderSecurity();
    else renderList();
    document.title = `${say("agents.title")} · Beach Day`;
    focusHeading(appHost);
  }

  window.addEventListener("hashchange", () => { if (!screens) render(); });
  // SIGNED_OUT that we didn't ask for (revoked elsewhere, refresh ticker) is S7: keep the drafts and transcripts (R14-1).
  // A deliberate sign-out clears them in signOutControls' onSignedOut instead.
  auth.onChange((event) => { if (event === "SIGNED_OUT" && !signingOut && !screens && access !== "denied") showAuth("sessionExpired"); });

  // ---- start ----
  redirectResult = await auth.completeRedirect().catch(() => ({ kind: "none" }));
  if (redirectResult?.kind === "oauth" && redirectResult.ok && redirectResult.returnRoute) {
    history.replaceState(history.state, "", `/console${redirectResult.returnRoute}`);
    const stepUpId = takeStepUpProposal();
    const r = parseRoute(redirectResult.returnRoute);
    if (stepUpId && r.name === "proposal" && r.id === stepUpId) reopenStepUp = stepUpId; // reopen only; never approve
  } else {
    takeStepUpProposal(); // a stale id from an abandoned step-up never acts
  }
  if (auth.pendingEmailLink() || !(await auth.getSession())) return showAuth();
  accountId = (await auth.getAccount())?.id ?? null;
  appHost.hidden = false;
  authHost.hidden = true;
  await checkAccess();
}

/** Sable's .state-card for checking / empty / 403 / 503 screens. kind: info | denied | error. */
function stateCard(kind, title, body, ...actions) {
  const lines = Array.isArray(body) ? body : [body];
  return h("div", { class: `panel state-card${kind === "denied" || kind === "error" ? ` state-card--${kind}` : ""}`,
    role: kind === "error" && !title ? "alert" : null, dataset: { testid: `state-${kind}` } },
    icon(kind === "denied" ? "lock" : kind === "error" ? "x-circle" : "info"),
    title ? h("h1", { tabindex: "-1" }, title) : null,
    h("div", { class: "state-card__body", role: kind === "error" && title ? "alert" : null }, lines.map((l) => h("p", {}, l))),
    actions.length ? h("div", { class: "state-card__actions" }, actions) : null);
}

if (typeof document !== "undefined" && document.getElementById("console-root")) boot();
