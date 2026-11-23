// Small DOM helpers for the Agents page (Console). No framework, no innerHTML.
// Every dynamic string (model output, diffs, file paths, server and Supabase errors) goes in through
// textContent or a Text node (docs/04 §10, agent-console-security). Attributes are set one by one.
import { STRINGS, t } from "../copy/copy-deck.js";

/**
 * Ids the Console needs that are not in Wren's deck yet. The deck wins as soon as it has the id, so each entry
 * here is dead once Wren adds it; delete it then. Placeholders are not allowed in these fallbacks.
 */
export const LOCAL_COPY = Object.freeze({
  "agents.chat.log": "Conversation",
});

/** Copy lookup: Wren's deck first, then LOCAL_COPY. Unknown ids or missing placeholders throw. */
export function say(id, params) {
  if (Object.prototype.hasOwnProperty.call(STRINGS, id)) return t(id, params);
  if (Object.prototype.hasOwnProperty.call(LOCAL_COPY, id)) return LOCAL_COPY[id];
  return t(id, params); // throws the deck's own "unknown id" error
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
