// Tiny DOM helpers. Everything user-visible goes through textContent / text nodes, never innerHTML.
const SVG = "http://www.w3.org/2000/svg";

/** h("button", {class: "btn", onclick}, "Label"). false/null/undefined attrs are skipped; pass "false" as a string when needed. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Sprite icon, decorative. */
export function icon(name, extra = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", extra ? `icon ${extra}` : "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `/img/sprite.svg#${name}`);
  svg.append(use);
  return svg;
}

/** Visible symbol text plus a spoken form for screen readers ("84 °F" / "84 degrees Fahrenheit"). */
export function spoken(visible, aloud) {
  return [h("span", { "aria-hidden": "true" }, visible), h("span", { class: "visually-hidden" }, aloud)];
}

/** Split `text` around `linkText` and put an external link in the gap. */
export function withLink(text, linkText, href) {
  const i = text.indexOf(linkText);
  if (i < 0) return [text];
  return [
    text.slice(0, i),
    h("a", { href, target: "_blank", rel: "noopener noreferrer" }, linkText),
    text.slice(i + linkText.length),
  ];
}
