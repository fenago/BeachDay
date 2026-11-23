// Small DOM helpers for the Agents page (Console). No framework, no innerHTML.
// Every dynamic string (model output, diffs, file paths, server and Supabase errors) goes in through
// textContent or a Text node (docs/04 §10, agent-console-security). Attributes are set one by one.
import { STRINGS, t } from "../copy/copy-deck.js";

/**
 * Strings the build needed that are not in Wren's copy deck yet. `say()` prefers the deck, so once Wren adds an
 * id with the same name the deck wins and this entry is dead. Listed in the W2 HANDOFF for Wren.
 */
export const LOCAL_COPY = Object.freeze({
  "agents.account": "Signed in as {email}",
  "agents.you": "You",
  "agents.chat.refusal": "The agent can't help with that request. Try asking another way.",
  "agents.chat.unavailable": "The agent is unavailable right now. Your message is still here.",
  "agents.chat.ratelimited": "Too many messages for now. Try again after {time}.",
  "agents.chat.ratelimited.nodate": "Too many messages for now. Try again in a minute.",
  "agents.chat.toolong": "That message is too long. Shorten it and send again.",
  "agents.chat.session": "Your session ended before the reply finished. Sign in and send again.",
  "agents.chat.tool.read_file": "Reading a file",
  "agents.chat.tool.list_files": "Looking through folders",
  "agents.chat.tool.propose_change": "Writing a proposal",
  "agents.chat.background": "This is taking longer, so it moved to the background. Results appear here.",
  "agents.chat.paused": "The background job paused at its time limit.",
  "agents.chat.continue": "Continue",
  "agents.chat.jobfailed": "The background job stopped. Nothing was committed.",
  "agents.proposal.meta": "Base {base} · Hash {hash}",
  "agents.proposal.diff.for": "Changes in {path}",
  "agents.proposal.bytes": "{bytes} bytes",
  "agents.proposal.allowed": "Allowed path",
  "agents.proposal.denied": "Not allowed",
  "agents.proposal.loading": "Loading the proposal…",
  "agents.proposal.missing": "That proposal couldn't be found.",
  "agents.proposal.committing": "The commit is still being confirmed. Check back in a minute.",
  "agents.proposal.failed": "The commit failed. Nothing was deployed. Ask the agent to propose it again.",
  "agents.proposal.warn.code": "Runs in the browser next to sign-in tokens. Read every line.",
  "agents.proposal.warn.agents": "Changes how an agent behaves or which model it uses.",
  "agents.proposal.warn.tests": "Runs in CI.",
  "agents.sheet.commit": "One commit to main: “{summary}”",
  "agents.sheet.meta": "Base {base} · Hash {hash}",
  "console.status.stilldeploying": "Still deploying. Check Netlify.",
  "console.error.approve": "Couldn't approve right now. Try again in a minute.",
  "console.error.screens": "The sign-in screen didn't load. Reload the page to try again.",
});

/** Copy lookup: Wren's deck first, then LOCAL_COPY. Unknown ids throw (same as the deck's t()). */
export function say(id, params) {
  if (Object.prototype.hasOwnProperty.call(STRINGS, id)) return t(id, params);
  const raw = LOCAL_COPY[id];
  if (typeof raw !== "string") throw new Error(`Unknown copy id ${id}`);
  return raw.replace(/\{(\w+)\}/g, (_, k) => {
    if (!params || !(k in params)) throw new Error(`Missing {${k}} for ${id}`);
    return String(params[k]);
  });
}

/**
 * h("button", {class: "btn", type: "button", onclick: fn, dataset: {x: 1}}, "Text", childEl)
 * Strings become Text nodes. `null`, `undefined` and `false` children are skipped. Attribute values are set
 * with setAttribute, so they are never parsed as HTML. `on*` keys add event listeners.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Decorative sprite icon (aria-hidden). The text next to it carries the meaning. */
export function icon(name, extraClass = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `icon${extraClass ? ` ${extraClass}` : ""}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `/img/sprite.svg#${name}`);
  svg.append(use);
  return svg;
}

/** Replace an element's children. */
export function clear(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Write a live region. Clearing first makes screen readers announce a repeat of the same text. */
export function announce(region, text) {
  if (!region) return;
  region.textContent = "";
  if (text) region.textContent = text;
}

/** Move focus to the screen's h1 (route change rule, accessibility-wcag22). */
export function focusHeading(root) {
  const h1 = root.querySelector("h1");
  if (!h1) return;
  if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
  h1.focus({ preventScroll: false });
}

/** A banner (Sable's .banner) with an icon. kind: info | warn | ok | error. role is the caller's choice. */
export function banner(kind, role, title, ...body) {
  const iconName = { info: "info", warn: "alert", ok: "check-circle", error: "x-circle" }[kind] ?? "info";
  return h("div", { class: `banner banner--${kind}`, role },
    icon(iconName),
    h("div", { class: "banner__body" }, h("p", { class: "banner__title" }, title), ...body));
}

export const shortSha = (sha) => (typeof sha === "string" ? sha.slice(0, 7) : "");
/** docs/04 §1 step 4 and ruling R14: the 8 hex digits after "sha256:". */
export const shortHash = (contentHash) => (typeof contentHash === "string" ? contentHash.slice(7, 15) : "");

export const REPO_URL = "https://github.com/fenago/BeachDay";
export const commitUrl = (sha) => `${REPO_URL}/commit/${encodeURIComponent(sha)}`;
export const commitsUrl = () => `${REPO_URL}/commits/main`;

/** An external link that opens in a new tab, with the hidden "(Opens in a new tab)" hint. */
export function externalLink(href, text, attrs = {}) {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer", ...attrs },
    text, h("span", { class: "visually-hidden" }, ` (${say("offsite.hint")})`));
}

/** Format an ISO time for "try again after" lines, in the reader's locale and the New York day (ADR-0008). */
export function formatWhen(iso, { withDate = true } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts = withDate
    ? { month: "short", day: "numeric", timeZone: "America/New_York" }
    : { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" };
  return new Intl.DateTimeFormat("en-US", opts).format(d);
}

export const utf8Bytes = (s) => new TextEncoder().encode(String(s ?? "")).length;
