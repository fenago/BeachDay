// Small file helpers for the static suite (not a test file).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
export const PUBLIC = join(ROOT, "public");
export const rel = (f) => relative(ROOT, f).split(sep).join("/");
export const read = (f) => readFileSync(f, "utf8");
export const exists = existsSync;

export function walk(dir, { skip = [] } = {}) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (skip.includes(name)) continue;
    if (statSync(f).isDirectory()) out.push(...walk(f, { skip }));
    else out.push(f);
  }
  return out.sort();
}

/** The pages the site ships (build_plan §2). `file` is relative to public/. */
export const PAGES = [
  { url: "/", file: "index.html", h1: null },
  { url: "/how-it-works/", file: "how-it-works/index.html", h1: "How it works" },
  { url: "/resources/", file: "resources/index.html", h1: "Resources" },
  { url: "/guide/", file: "guide/index.html", h1: "Step-by-step guide" },
  { url: "/console", file: "console.html", h1: null },
  { url: "/offline.html", file: "offline.html", h1: "You're offline" },
];

export const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
export const tags = (html, name) => [...stripComments(html).matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) => m[1]);
export const attr = (a, n) => new RegExp(`(?:^|\\s)${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(a)?.slice(2).find((x) => x !== undefined);
