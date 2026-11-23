// Applies public/_headers the way Netlify does for static files, so CSP violations show up in the browser.
// Format: a non-indented line is a path pattern; indented "Name: value" lines are headers. `*` = splat, `:name` = placeholder.
// Rules are applied in file order; a later rule overrides the same header name (the file keeps one rule per name per path).
import { readFileSync, existsSync } from "node:fs";

export function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      const i = raw.indexOf(":");
      if (cur && i > 0) cur.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
    } else {
      cur = { pattern: raw.trim(), headers: [] };
      rules.push(cur);
    }
  }
  return rules;
}

const toRegExp = (pattern) => new RegExp("^" + pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_]+/g, "[^/]+")).join(".*") + "$");

export function headersFor(rules, pathname, { substitutions = {} } = {}) {
  const out = new Map();
  for (const r of rules) {
    if (!toRegExp(r.pattern).test(pathname)) continue;
    for (const [name, value] of r.headers) {
      let v = value;
      for (const [from, to] of Object.entries(substitutions)) v = v.split(from).join(to);
      out.set(name.toLowerCase(), v);
    }
  }
  return out;
}

export function loadHeadersFile(file) {
  return existsSync(file) ? parseHeadersFile(readFileSync(file, "utf8")) : [];
}
