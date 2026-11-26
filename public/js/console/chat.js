// Chat with one agent (docs/04 §1 step 3, §2.1; ux-build-spec §3.3; ruling R6).
// - The draft and the transcript live in memory and the DOM only. Never storage, never a URL.
// - The log is role="log"; the streaming bubble has aria-busy="true" until done or error.
// - Model output is plain text: Text nodes and white-space: pre-wrap. Never innerHTML.
// - Refusal: remove the partial bubble, show a plain message, and drop the turn that triggered it.
// - Handoff: poll GET /api/jobs/:id every 2.5 s and render its events from the index already shown.
// - Team mode (team_plan R-1, R-4; ux-build-spec §3.4): the lead's turn ALWAYS runs as a background job
//   (POST /api/jobs {agent, messages}, then the same pollJob). consult_expert events become progress rows; one hidden
//   role="status" region announces each consult's start and end once (starts in one poll joined); the "Asked:" footer
//   is built from the events, never from the model; proposals get a "Drafted by {persona}" line above the card.
import { h, icon, say, announce, formatWhen, utf8Bytes } from "./dom.js";
import { MAX_USER_MESSAGE_BYTES } from "./api.js";
import { proposalPlaceholder } from "./proposal.js";

const JOB_POLL_MS = 2500;
const JOB_FINAL = new Set(["done", "failed", "paused"]);
const AGENT_RE = /^[a-z][a-z0-9-]{1,63}$/;
const PROGRESS_ICON = { asking: "clock", done: "check-circle", failed: "x-circle" };
/** Join announcement parts as sentences: "Wren couldn't answer. Kai replied." / "Asking Dewey… Asking Wren…". */
export const joinSay = (parts) => parts.filter(Boolean).map((p) => (/[.…!?]$/.test(p) ? p : `${p}.`)).join(" ");
const PROGRESS_COPY = { asking: "agents.chat.tool.consult_expert.start", done: "agents.chat.tool.consult_expert.end",
  failed: "agents.chat.tool.consult_expert.error" };

/**
 * @param {{agent: object, api: object, renderProposal: (proposalId: string, placeholder: HTMLElement) => Promise<void>,
 *          setTimer?: typeof setTimeout, team?: {personaOf: (name: string) => string} | null}} deps
 *   team: set for the team lead (GET /api/agents teamLead:true). personaOf maps a registry name to its persona.
 * @returns {{el: HTMLElement, focus: () => void, hasDraft: () => boolean}}
 */
export function createChatView({ agent, api, renderProposal, setTimer = setTimeout, team = null }) {
  const persona = agent.persona || agent.name;
  /** Persona for an event's agent field; null for a missing or malformed name (the row is then skipped). */
  const personaOf = (name) => (typeof name === "string" && AGENT_RE.test(name) ? (team?.personaOf?.(name) || name) : null);
  /** @type {{role: "user"|"assistant", content: string}[]} memory only */
  const transcript = [];
  let busy = false;
  let budgetUntil = 0;

  const log = h("div", { class: "chat-log", role: "log", "aria-label": say("agents.chat.log"), "data-empty": team ? null : say("agents.sub"), dataset: { testid: "chat-log" } });
  const status = h("p", { class: "chat-status", role: "status", dataset: { testid: "chat-status" } });
  const alert = h("div", { role: "alert", dataset: { testid: "chat-alert" } });
  const inputId = `composer-${agent.name}`;
  const input = h("textarea", { id: inputId, class: "input", rows: "1", placeholder: say("agents.chat.placeholder"),
    autocomplete: "off", dataset: { testid: "chat-input" } });
  const send = h("button", { class: "btn btn--primary", type: "submit", dataset: { testid: "chat-send" } }, icon("send"), say("btn.send"));
  const form = h("form", { class: "composer", dataset: { testid: "chat-form" } },
    h("label", { class: "visually-hidden", for: inputId }, say("agents.chat.label", { agent: persona })), input, send);

  // Team mode: one persistent, visually hidden status region that exists before the first change (ux-build-spec §3.4).
  const teamStatus = team ? h("p", { class: "visually-hidden", role: "status", dataset: { testid: "team-status" } }) : null;

  const el = h("section", { class: "chat", "aria-label": say("agents.chat.with", { agent: persona }), dataset: { testid: "chat", agent: agent.name } },
    log, status, teamStatus, alert, form);

  const bubble = (kind, author, text = "") => {
    const body = h("p", { class: "msg__body" }, text);
    const m = h("div", { class: `msg msg--${kind}`, dataset: { testid: `msg-${kind}` } }, h("span", { class: "msg__author" }, author), body);
    log.append(m);
    return { m, body };
  };
  const systemLine = (text, kind = "system") => bubble(kind, kind === "error" ? persona : "", text).m;
  const toolLine = (ev, reply) => {
    if (ev.phase !== "start") return;
    // A nested expert's tool (team turns) is shown under the expert's name; a bad agent field drops the line.
    const author = ev.agent === undefined ? persona : personaOf(ev.agent);
    if (!author) return;
    let label;
    try { label = say(`agents.chat.tool.${ev.name}`); } catch { return; }
    const { m } = bubble("tool", author, ev.summary ? `${label}: ${ev.summary}` : label);
    place(m, reply);
  };
  /**
   * True when the reader is at the end of the log: a scrollable log is scrolled to its end, or (the page scrolls) the
   * top of the insertion anchor is on screen. The anchor is Kai's open answer in team mode (rows go above it),
   * else the last row. A reader who scrolled up a screen or more is not at the end.
   */
  function pinnedToEnd() {
    if (log.scrollHeight > log.clientHeight + 1) return log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    const answer = log.querySelector(':scope > [data-testid="msg-agent"][aria-busy="true"]');
    const anchor = (team && answer) || log.lastElementChild;
    return !anchor || anchor.getBoundingClientRect().top <= (globalThis.innerHeight || 0);
  }
  /**
   * Keep a newly added row visible above the sticky composer, but only if the reader was already at the end.
   * `newest` is re-pinned when the log resizes later (a proposal card replacing its placeholder, a page-height clamp),
   * as long as the reader is still following: `follow` changes only when the reader scrolls.
   */
  let newest = null;
  let follow = true;
  function keepInView(row, pinned) {
    newest = row;
    if (!pinned || !row?.isConnected || typeof row.scrollIntoView !== "function") return;
    row.scrollIntoView({ block: "nearest" });
    const hidden = row.getBoundingClientRect().bottom - form.getBoundingClientRect().top; // > 0: under the composer
    if (hidden > 0) globalThis.scrollBy?.(0, hidden + 8);
  }
  if (team) {
    globalThis.addEventListener?.("scroll", () => { if (log.isConnected) follow = pinnedToEnd(); }, { passive: true });
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => { if (follow && newest?.isConnected) keepInView(newest, true); }).observe(log);
    }
  }
  /**
   * Team turns: everything but the answer goes ABOVE Kai's reply bubble once it is open, so the log always reads
   * user, progress rows / tool lines / "Drafted by" + card (in arrival order), then the answer with "Asked:" last.
   */
  let lastPlaced = null;
  function place(node, reply) {
    if (team && reply?.m?.parentNode === log) log.insertBefore(node, reply.m); else log.append(node);
    lastPlaced = node;
  }
  const showAlert = (text) => { alert.replaceChildren(text ? h("p", { class: "form-error" }, icon("alert"), text) : ""); };

  function setBusy(on) {
    busy = on;
    send.setAttribute("aria-disabled", String(on || Date.now() < budgetUntil));
    if (on && !team) announce(status, say("agents.chat.thinking", { agent: persona }));
  }

  async function addProposal(ev, reply) {
    const ph = proposalPlaceholder(ev);
    // Team turns: "Drafted by {persona}" sits above the card; the card itself is unchanged. Both go above Kai's answer.
    const by = team && ev.agent !== undefined ? personaOf(ev.agent) : null;
    if (by) place(h("p", { class: "msg__proposal-by", dataset: { testid: "proposal-by", agent: ev.agent } }, say("agents.team.proposalBy", { agent: by })), reply);
    place(ph, reply);
    announce(status, say("console.status.ready"));
    await renderProposal(ev.proposalId, ph);
  }

  // ---- team progress (consult_expert) ----
  /** One consult row. state: asking | done | failed. The words carry the state; the icon only helps. */
  function setRow(c, state) {
    c.state = state;
    c.row.dataset.state = state;
    if (state === "asking") c.row.setAttribute("aria-busy", "true"); else c.row.removeAttribute("aria-busy");
    c.body.replaceChildren(icon(PROGRESS_ICON[state]), say(PROGRESS_COPY[state], { agent: c.persona }));
    return c.body.textContent;
  }
  /** Returns the text to announce, or null when the event changes nothing. */
  function consultEvent(ev, consults) {
    const who = personaOf(ev.agent);
    if (!who) return null;
    if (ev.phase === "start") {
      const body = h("p", { class: "msg__body" });
      const row = h("div", { class: "msg msg--progress", dataset: { testid: "msg-progress", agent: ev.agent } },
        h("span", { class: "msg__author" }, persona), body);
      // Rows sit above Kai's answer: progress, then the answer, then "Asked:" (Sable R5).
      place(row, consults.reply);
      const c = { agent: ev.agent, persona: who, row, body, state: "asking" };
      consults.push(c);
      return setRow(c, "asking");
    }
    if (ev.phase === "end") {
      const c = consults.find((x) => x.agent === ev.agent && x.state === "asking"); // FIFO per expert
      if (!c) return null;
      return setRow(c, ev.ok === true ? "done" : "failed"); // ok is required on consult end; anything else is a failure
    }
    return null;
  }
  /** A job that ends with a consult still open: that expert couldn't answer (ux-build-spec §3.4 open item 2). */
  const closeOpenConsults = (consults) => consults.filter((c) => c.state === "asking").map((c) => setRow(c, "failed"));
  /** "Asked: Dewey, Wren": personas in first-asked order, each once, failures included. null when nobody was asked. */
  function askedText(consults) {
    const names = [...new Set(consults.map((c) => c.persona))];
    return names.length ? say("agents.team.asked", { list: names.join(", ") }) : null;
  }

  /** Render one job/stream event into an agent bubble. Returns announcement text (team progress) or null. */
  function applyEvent(ev, reply, consults = null) {
    if (ev.type === "text" && typeof ev.delta === "string") { openReply(reply); reply.text += ev.delta; reply.node.appendData(ev.delta); }
    else if (ev.type === "tool" && ev.name === "consult_expert") return consults ? consultEvent(ev, consults) : null;
    else if (ev.type === "tool") toolLine(ev, reply);
    else if (ev.type === "proposal") addProposal(ev, reply);
    return null;
  }

  /**
   * The agent's reply bubble. In team mode it opens lazily at the first text delta, so the progress rows stay above
   * the combined answer; its body is a div so the "Asked:" <p> can sit inside it.
   */
  function newReply() {
    const reply = { m: null, node: null, body: null, text: "" };
    if (!team) openReply(reply);
    return reply;
  }
  function openReply(reply) {
    if (reply.m) return;
    const body = h(team ? "div" : "p", { class: "msg__body" });
    reply.m = h("div", { class: "msg msg--agent", dataset: { testid: "msg-agent" } }, h("span", { class: "msg__author" }, persona), body);
    reply.m.setAttribute("aria-busy", "true");
    reply.node = document.createTextNode("");
    body.append(reply.node);
    reply.body = body;
    log.append(reply.m);
  }
  const dropReply = (reply) => { reply.m?.remove(); };
  function finishReply(reply) {
    if (!reply.m) return;
    reply.m.setAttribute("aria-busy", "false");
    if (!reply.text) reply.m.remove();
  }

  function endTurn(reply, terminal) {
    if (terminal.type === "error" && terminal.code === "refusal") {
      dropReply(reply);                    // discard the partial reply (docs/04 §2.1)
      transcript.pop();                    // reset the context: drop the triggering user turn (docs 02)
      systemLine(say("agents.chat.refusal"), "error");
      return;
    }
    finishReply(reply);
    if (reply.text) transcript.push({ role: "assistant", content: reply.text });
    else transcript.pop();                 // keep turns alternating: the unanswered user turn goes
    if (terminal.type === "error") {
      const text = terminal.code === "unauthorized" ? say("agents.chat.session")
        : terminal.code === "budget_exhausted" ? budgetText(terminal.retryAt)
        : say("agents.chat.interrupted");
      systemLine(text, "error");
    } else if (terminal.type === "done" && terminal.stopReason && !["end_turn", "handoff"].includes(terminal.stopReason)) {
      systemLine(say("agents.chat.interrupted"));
    }
  }

  const budgetText = (retryAt) => retryAt ? say("console.error.budget", { date: formatWhen(retryAt) }) : say("console.error.budget.nodate");

  function preStreamError(err) {
    const c = err?.code;
    if (c === "budget_exhausted") {
      const until = Date.parse(err.retryAt ?? "");
      budgetUntil = Number.isFinite(until) ? until : Date.now() + 60 * 60_000;
      return budgetText(err.retryAt);
    }
    if (c === "rate_limited") return err.retryAt ? say("agents.chat.ratelimited", { time: formatWhen(err.retryAt, { withDate: false }) }) : say("agents.chat.ratelimited.nodate");
    if (c === "upstream" || c === "timeout") return say("agents.chat.unavailable");
    if (c === "unavailable") return err.offline ? say("auth.error.network") : say("console.check.failed");
    if (c === "unauthorized" || c === "forbidden") return null; // api.js moved to S7 / S6; draft is kept
    return say("agents.chat.failed");
  }

  /** Team mode: the "working" line stays under the user's message until the job ends. */
  function showWorking() {
    const pinned = pinnedToEnd();
    const line = systemLine(say("agents.team.working"));
    keepInView(line, pinned);
    line.dataset.testid = "team-working";
    announce(teamStatus, say("agents.team.working"));
    return line;
  }

  async function pollJob(jobId, reply) {
    const working = team ? showWorking() : null;
    if (!team) announce(status, say("agents.chat.background"));
    const consults = team ? Object.assign([], { reply }) : null;
    let shown = 0;
    try {
      for (;;) {
        await new Promise((r) => setTimer(r, JOB_POLL_MS));
        let job;
        try { job = await api.job(jobId); } catch (err) {
          if (err?.code === "unauthorized" || err?.code === "forbidden") return;
          continue; // a blip: keep polling
        }
        const events = Array.isArray(job?.events) ? job.events : [];
        const said = [];
        // One "at the end?" reading per poll, before anything is added; then keep the newest added row in view.
        const pinned = team ? pinnedToEnd() : false;
        lastPlaced = null;
        for (const ev of events.slice(shown)) { const t = applyEvent(ev, reply, consults); if (t) said.push(t); }
        if (team && lastPlaced) keepInView(lastPlaced, pinned);
        shown = events.length;
        const final = JOB_FINAL.has(job?.status);
        if (final && consults) said.push(...closeOpenConsults(consults));
        if (!final) {
          if (said.length) announce(teamStatus, joinSay(said)); // one update per poll; a quiet poll says nothing
          continue;
        }
        working?.remove();
        const err = events.find((e) => e.type === "error");
        if (err?.code === "refusal") {
          if (said.length) announce(teamStatus, joinSay(said));
          return endTurn(reply, err);
        }
        const asked = consults ? askedText(consults) : null;
        if (asked && reply.text) reply.body.append(h("p", { class: "msg__asked", dataset: { testid: "team-asked" } }, asked));
        else if (asked) log.append(h("div", { class: "msg msg--system" }, h("p", { class: "msg__asked", dataset: { testid: "team-asked" } }, asked)));
        return finishJob(job, jobId, reply, said); // the last poll's lines go out with the reply, as one update
      }
    } finally { working?.remove(); newest = null; }
  }

  function finishJob(job, jobId, reply, said = []) {
    finishReply(reply);
    if (reply.text) transcript.push({ role: "assistant", content: reply.text }); else transcript.pop();
    if (job.status === "failed") systemLine(say("agents.chat.jobfailed"), "error");
    if (job.status === "paused") {
      const btn = h("button", { class: "btn btn--secondary", type: "button", dataset: { testid: "job-continue" } }, say("agents.chat.continue"));
      btn.addEventListener("click", async () => {
        btn.setAttribute("aria-disabled", "true");
        try {
          const r = await api.startJob({ continueFrom: jobId });
          btn.closest(".msg")?.remove();
          input.focus(); // the Continue row is gone: focus goes back to the composer (Wren R4)
          transcript.push({ role: "user", content: say("agents.chat.continue") }); // placeholder turn, replaced by the job's reply
          const next = newReply();
          setBusy(true);
          await pollJob(r.jobId, next);
          setBusy(false);
        } catch (e2) { btn.removeAttribute("aria-disabled"); showAlert(preStreamError(e2)); }
      });
      log.append(h("div", { class: "msg msg--system" }, h("p", { class: "msg__body" }, say("agents.chat.paused")), h("div", { class: "chat-actions" }, btn)));
    }
    if (team) announce(teamStatus, joinSay([...said, say("agents.chat.reply", { agent: persona })]));
    else announce(status, say("agents.chat.reply", { agent: persona }));
  }

  /**
   * A team-lead turn (R-1): always a background job. Send stays aria-disabled while it runs; the composer stays
   * editable, so a new draft typed meanwhile is kept. A refused start keeps the sent text in the composer.
   */
  async function teamTurn(text, userMsg) {
    let started;
    try {
      started = await api.startJob({ agent: agent.name, messages: transcript.slice() });
      if (!started || typeof started.jobId !== "string") throw Object.assign(new Error("upstream"), { code: "upstream" });
    } catch (err) {
      userMsg.remove();
      transcript.pop();
      const msg = preStreamError(err);
      setBusy(false);
      if (msg) showAlert(msg);
      input.focus();
      return;
    }
    if (input.value.trim() === text) input.value = ""; // the sent text leaves the composer once the job is accepted
    try { await pollJob(started.jobId, newReply()); } finally { setBusy(false); }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || Date.now() < budgetUntil) return;
    const text = input.value.trim();
    if (!text) return;
    if (utf8Bytes(text) > MAX_USER_MESSAGE_BYTES) { showAlert(say("agents.chat.toolong")); return; }
    showAlert("");
    input.focus(); // after sending, focus stays in the composer (accessibility-wcag22)
    const userMsg = bubble("user", say("agents.you"), text).m;
    transcript.push({ role: "user", content: text });
    setBusy(true);
    if (team) return teamTurn(text, userMsg);
    const reply = newReply();
    let opened = false;
    let terminal;
    try {
      terminal = await api.chat({ agent: agent.name, messages: transcript.slice() }, {
        onEvent: (ev) => {
          if (!opened) { opened = true; input.value = ""; } // the draft clears only once the stream is open
          applyEvent(ev, reply);
        },
      });
    } catch (err) {
      reply.m.remove();
      userMsg.remove();
      transcript.pop();
      const msg = preStreamError(err); // sets budgetUntil first, so setBusy keeps Send aria-disabled
      setBusy(false);
      announce(status, "");
      if (msg) showAlert(msg);
      input.focus();
      return;
    }
    if (!opened) input.value = "";
    if (terminal.type === "handoff") {
      await pollJob(terminal.jobId, reply);
    } else {
      endTurn(reply, terminal);
      announce(status, terminal.type === "done" ? say("agents.chat.reply", { agent: persona }) : "");
    }
    setBusy(false);
  });
  // Cmd/Ctrl+Enter sends; Enter alone adds a line.
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });

  return {
    el,
    focus: () => input.focus(),
    hasDraft: () => input.value.trim().length > 0,
  };
}
