// Chat with one agent (docs/04 §1 step 3, §2.1; ux-build-spec §3.3; ruling R6).
// - The draft and the transcript live in memory and the DOM only. Never storage, never a URL.
// - The log is role="log"; the streaming bubble has aria-busy="true" until done or error.
// - Model output is plain text: Text nodes and white-space: pre-wrap. Never innerHTML.
// - Refusal: remove the partial bubble, show a plain message, and drop the turn that triggered it.
// - Handoff: poll GET /api/jobs/:id every 2.5 s and render its events from the index already shown.
import { h, icon, say, announce, formatWhen, utf8Bytes } from "./dom.js";
import { MAX_USER_MESSAGE_BYTES } from "./api.js";
import { proposalPlaceholder } from "./proposal.js";

const JOB_POLL_MS = 2500;
const JOB_FINAL = new Set(["done", "failed", "paused"]);

/**
 * @param {{agent: object, api: object, renderProposal: (proposalId: string, placeholder: HTMLElement) => Promise<void>,
 *          setTimer?: typeof setTimeout}} deps
 * @returns {{el: HTMLElement, focus: () => void, hasDraft: () => boolean}}
 */
export function createChatView({ agent, api, renderProposal, setTimer = setTimeout }) {
  const persona = agent.persona || agent.name;
  /** @type {{role: "user"|"assistant", content: string}[]} memory only */
  const transcript = [];
  let busy = false;
  let budgetUntil = 0;

  const log = h("div", { class: "chat-log", role: "log", "aria-label": say("agents.chat.log"), "data-empty": say("agents.sub"), dataset: { testid: "chat-log" } });
  const status = h("p", { class: "chat-status", role: "status", dataset: { testid: "chat-status" } });
  const alert = h("div", { role: "alert", dataset: { testid: "chat-alert" } });
  const inputId = `composer-${agent.name}`;
  const input = h("textarea", { id: inputId, class: "input", rows: "1", placeholder: say("agents.chat.placeholder"),
    autocomplete: "off", dataset: { testid: "chat-input" } });
  const send = h("button", { class: "btn btn--primary", type: "submit", dataset: { testid: "chat-send" } }, icon("send"), say("btn.send"));
  const form = h("form", { class: "composer", dataset: { testid: "chat-form" } },
    h("label", { class: "visually-hidden", for: inputId }, say("agents.chat.label", { agent: persona })), input, send);

  const el = h("section", { class: "chat", "aria-label": say("agents.chat.with", { agent: persona }), dataset: { testid: "chat", agent: agent.name } },
    log, status, alert, form);

  const bubble = (kind, author, text = "") => {
    const body = h("p", { class: "msg__body" }, text);
    const m = h("div", { class: `msg msg--${kind}`, dataset: { testid: `msg-${kind}` } }, h("span", { class: "msg__author" }, author), body);
    log.append(m);
    return { m, body };
  };
  const systemLine = (text, kind = "system") => bubble(kind, kind === "error" ? persona : "", text).m;
  const toolLine = (ev) => {
    if (ev.phase !== "start") return;
    let label;
    try { label = say(`agents.chat.tool.${ev.name}`); } catch { return; }
    bubble("tool", persona, ev.summary ? `${label}: ${ev.summary}` : label);
  };
  const showAlert = (text) => { alert.replaceChildren(text ? h("p", { class: "form-error" }, icon("alert"), text) : ""); };

  function setBusy(on) {
    busy = on;
    send.setAttribute("aria-disabled", String(on || Date.now() < budgetUntil));
    if (on) announce(status, say("agents.chat.thinking", { agent: persona }));
  }

  async function addProposal(ev) {
    const ph = proposalPlaceholder(ev);
    log.append(ph);
    announce(status, say("console.status.ready"));
    await renderProposal(ev.proposalId, ph);
  }

  /** Render one job/stream event into an agent bubble. Returns false for a terminal event. */
  function applyEvent(ev, reply) {
    if (ev.type === "text" && typeof ev.delta === "string") { reply.text += ev.delta; reply.node.appendData(ev.delta); }
    else if (ev.type === "tool") toolLine(ev);
    else if (ev.type === "proposal") addProposal(ev);
  }

  function newReply() {
    const { m, body } = bubble("agent", persona);
    m.setAttribute("aria-busy", "true");
    const node = document.createTextNode("");
    body.append(node);
    return { m, node, text: "" };
  }
  function finishReply(reply) {
    reply.m.setAttribute("aria-busy", "false");
    if (!reply.text) reply.m.remove();
  }

  function endTurn(reply, terminal) {
    if (terminal.type === "error" && terminal.code === "refusal") {
      reply.m.remove();                    // discard the partial reply (docs/04 §2.1)
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

  async function pollJob(jobId, reply) {
    announce(status, say("agents.chat.background"));
    let shown = 0;
    for (;;) {
      await new Promise((r) => setTimer(r, JOB_POLL_MS));
      let job;
      try { job = await api.job(jobId); } catch (err) {
        if (err?.code === "unauthorized" || err?.code === "forbidden") return;
        continue; // a blip: keep polling
      }
      const events = Array.isArray(job?.events) ? job.events : [];
      for (const ev of events.slice(shown)) applyEvent(ev, reply);
      shown = events.length;
      if (!JOB_FINAL.has(job?.status)) continue;
      const err = events.find((e) => e.type === "error");
      if (err?.code === "refusal") return endTurn(reply, err);
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
            transcript.push({ role: "user", content: say("agents.chat.continue") }); // placeholder turn, replaced by the job's reply
            const next = newReply();
            setBusy(true);
            await pollJob(r.jobId, next);
            setBusy(false);
          } catch (e2) { btn.removeAttribute("aria-disabled"); showAlert(preStreamError(e2)); }
        });
        log.append(h("div", { class: "msg msg--system" }, h("p", { class: "msg__body" }, say("agents.chat.paused")), h("div", { class: "chat-actions" }, btn)));
      }
      announce(status, say("agents.chat.reply", { agent: persona }));
      return;
    }
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
