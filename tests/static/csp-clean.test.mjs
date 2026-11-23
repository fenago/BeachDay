// CSP is `script-src 'self'; style-src 'self'` (docs/04 §10): no inline <script>, <style>, style="", on*= handlers, javascript: URLs,
// and no HTML sinks fed with dynamic text. Applies to every shipped page and to public/js (not the vendored bundle).
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { PUBLIC, rel, read, walk, stripComments, tags, attr } from "./fs.mjs";

const html = walk(PUBLIC, { skip: ["vendor", "generated"] }).filter((f) => f.endsWith(".html"));
const js = walk(join(PUBLIC, "js")).filter((f) => f.endsWith(".js"));

describe("HTML pages", () => {
  it("there is at least one page to check (index/offline/how-it-works...)", () => { expect(html.length).toBeGreaterThan(0); });
  for (const f of html) {
    it(`${rel(f)}: no inline script or style, no event-handler attributes, no javascript: URLs`, () => {
      const src = stripComments(read(f));
      for (const a of tags(src, "script")) expect(attr(a, "src"), `${rel(f)}: inline <script> (needs src=)`).toBeTruthy();
      expect(/<script\b[^>]*>\s*\S/i.test(src.replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, "")), "script body present").toBe(false);
      expect(/<style\b/i.test(src), "<style> element").toBe(false);
      expect(/\sstyle\s*=/i.test(src), 'style="" attribute').toBe(false);
      expect(/\son[a-z]+\s*=/i.test(src), "on*= handler attribute").toBe(false);
      expect(/(?:href|src|action|formaction)\s*=\s*["']\s*javascript:/i.test(src)).toBe(false);
      for (const a of tags(src, "script")) expect(["module", undefined]).toContain(attr(a, "type"));
      for (const a of tags(src, "form")) expect(attr(a, "action"), "a <form action> would navigate away (sign-in uses script)").toBeUndefined();
    });
    it(`${rel(f)}: loads only same-origin scripts and styles`, () => {
      const src = stripComments(read(f));
      for (const a of [...tags(src, "script"), ...tags(src, "link")]) {
        const u = attr(a, "src") ?? (/stylesheet|modulepreload|preload/.test(attr(a, "rel") ?? "") ? attr(a, "href") : undefined);
        if (u) expect(u, `${rel(f)} loads ${u}`).not.toMatch(/^(https?:)?\/\//);
      }
    });
  }
});

describe("public/js", () => {
  for (const f of js) {
    it(`${rel(f)}: no eval, new Function, document.write, outerHTML, insertAdjacentHTML or innerHTML with text`, () => {
      const src = read(f).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
      expect(/\beval\s*\(/.test(src)).toBe(false);
      expect(/new\s+Function\s*\(/.test(src)).toBe(false);
      expect(/document\.write(ln)?\s*\(/.test(src)).toBe(false);
      expect(/\.outerHTML\s*=/.test(src)).toBe(false);
      expect(/insertAdjacentHTML\s*\(/.test(src)).toBe(false);
      // innerHTML is allowed only to clear a node: `x.innerHTML = ""`
      for (const m of src.matchAll(/\.innerHTML\s*(\+?=)\s*([^;\n]*)/g)) expect(m[2].trim(), `${rel(f)}: innerHTML ${m[1]} ${m[2]}`).toMatch(/^(""|''|``)$/);
      expect(/\.srcdoc\s*=/.test(src)).toBe(false);
    });
  }
  it("the beach app never fetches /api/ (only the Agents page does)", () => {
    for (const f of js.filter((x) => !x.includes("/js/console/"))) expect(read(f), rel(f)).not.toMatch(/["'`]\/api\//);
  });
});
