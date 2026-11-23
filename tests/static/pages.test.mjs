// Every page: lang, one h1, landmarks, shared nav and footer (docs/design/ux-build-spec.md §1.1), manifest link, theme colour,
// apple-touch-icon, safe external links. A page that does not exist yet is PENDING (skipped with the reason), not hidden.
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { PAGES, PUBLIC, read, exists, stripComments, tags, attr } from "./fs.mjs";

const STATIC_PAGES = PAGES.filter((p) => p.file !== "offline.html"); // offline.html is a minimal fallback (own block below)

for (const page of PAGES) {
  const file = join(PUBLIC, page.file);
  describe(`${page.url} (${page.file})`, () => {
    const body = () => stripComments(read(file));
    const pending = (ctx) => { if (!exists(file)) { ctx.skip(`PENDING: public/${page.file} does not exist yet`); return true; } return false; };

    it("has lang=en, a title, charset and viewport", (ctx) => {
      if (pending(ctx)) return;
      const html = body();
      expect(/<html[^>]*\blang="en"/i.test(html)).toBe(true);
      expect(/<title>[^<]{3,}<\/title>/i.test(html)).toBe(true);
      expect(/<meta[^>]*charset/i.test(html)).toBe(true);
      expect(/<meta[^>]*name="viewport"[^>]*width=device-width/i.test(html)).toBe(true);
    });
    it("links the manifest, apple-touch-icon and the #0b3b5c theme colour", (ctx) => {
      if (pending(ctx)) return;
      const html = body();
      expect(tags(html, "link").some((a) => attr(a, "rel") === "manifest" && attr(a, "href") === "/manifest.webmanifest")).toBe(true);
      expect(tags(html, "link").some((a) => attr(a, "rel") === "apple-touch-icon" && attr(a, "href") === "/icons/apple-touch-icon-180.png")).toBe(true);
      expect(tags(html, "meta").some((a) => attr(a, "name") === "theme-color" && attr(a, "content")?.toLowerCase() === "#0b3b5c")).toBe(true);
    });
    it("has exactly one <h1> (the beach app and the Agents page set it from script, so they only need the element or a placeholder)", (ctx) => {
      if (pending(ctx)) return;
      const n = (body().match(/<h1\b/gi) ?? []).length;
      if (page.h1) { expect(n).toBe(1); expect(new RegExp(`<h1[^>]*>\\s*${page.h1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</h1>`, "i").test(body())).toBe(true); }
      else expect(n).toBeLessThanOrEqual(1);
    });
    it("has a <main> landmark and a skip link to it", (ctx) => {
      if (pending(ctx)) return;
      const html = body();
      expect(/<main\b[^>]*\bid="main"/i.test(html)).toBe(true);
      if (page.file !== "offline.html") expect(/<a\b[^>]*href="#main"/i.test(html), "skip link").toBe(true); // offline.html is a minimal fallback
    });
    it("external links open safely and have text (no 'click here')", (ctx) => {
      if (pending(ctx)) return;
      const html = body();
      const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
      for (const [, a, inner] of links) {
        const href = attr(a, "href") ?? "";
        if (/^https?:\/\//.test(href)) {
          expect(attr(a, "rel") ?? "", `${href} needs rel=noopener`).toMatch(/noopener/);
          if (attr(a, "target") === "_blank") expect(attr(a, "rel")).toMatch(/noreferrer|noopener/);
        }
        const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        expect(text.length > 0 || /aria-label=/.test(a), `link ${href} has no text`).toBe(true);
        expect(text.toLowerCase(), `link ${href}`).not.toMatch(/^(click here|here|read more|link)$/);
      }
    });
  });
}

describe("shared header and footer on every page", () => {
  const HEADER = [["/how-it-works/", "How it works"], ["/resources/", "Resources"], ["/console", "Agents"]];
  for (const page of STATIC_PAGES) {
    it(`${page.url}: header nav (Beach Day, How it works, Resources, Agents) and footer (guide, GitHub, Open-Meteo, NWS safety line)`, (ctx) => {
      const file = join(PUBLIC, page.file);
      if (!exists(file)) return ctx.skip(`PENDING: public/${page.file} does not exist yet`);
      const html = stripComments(read(file));
      expect(/<header\b/i.test(html), "a <header> landmark").toBe(true);
      expect(/<nav\b[^>]*aria-label="Main"/i.test(html), 'nav aria-label="Main"').toBe(true);
      const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(([, a, inner]) => ({ href: attr(a, "href"), text: inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(), a }));
      expect(links.some((l) => l.href === "/" && /Beach Day/.test(l.text)), "brand link to /").toBe(true);
      for (const [href, text] of HEADER) expect(links.some((l) => l.href === href && l.text.startsWith(text)), `header link ${text} -> ${href}`).toBe(true);
      expect(links.some((l) => l.href === "/guide/" && /Step-by-step guide/.test(l.text)), "footer guide link").toBe(true);
      expect(links.some((l) => l.href === "https://github.com/fenago/BeachDay"), "footer GitHub link").toBe(true);
      expect(links.some((l) => l.href === "https://open-meteo.com/" && /Open-Meteo\.com/.test(l.text)), "Open-Meteo attribution link").toBe(true);
      expect(links.some((l) => /^https:\/\/www\.weather\.gov\/(beach\/mfl|key\/)/.test(l.href ?? "") && /NWS rip-current risk/.test(l.text)), "NWS rip-current link").toBe(true);
      expect(/<footer\b/i.test(html), "a <footer> landmark").toBe(true);
      expect(/posted (beach )?flags/i.test(html), "the posted flags sentence").toBe(true);
      expect(/CC BY 4\.0/.test(html), "CC BY 4.0").toBe(true);
    });
    it(`${page.url}: marks its own header link with aria-current="page" at most once`, (ctx) => {
      const file = join(PUBLIC, page.file);
      if (!exists(file)) return ctx.skip(`PENDING: public/${page.file} does not exist yet`);
      const n = (stripComments(read(file)).match(/aria-current="page"/g) ?? []).length;
      expect(n).toBeLessThanOrEqual(1); // the beach app and Agents pages may set it from script
    });
  }
  it("offline.html carries the safety line and the Open-Meteo attribution (it may be the only page a person sees)", (ctx) => {
    const file = join(PUBLIC, "offline.html");
    if (!exists(file)) return ctx.skip("PENDING: public/offline.html");
    const html = stripComments(read(file));
    expect(html).toMatch(/weather\.gov\/beach\/mfl/);
    expect(html).toMatch(/posted/i);
    expect(html).toMatch(/open-meteo\.com/);
  });
});

describe("Resources page inventory (build_plan D13, Wren W1 brief)", () => {
  it("links the repo, mcp-api.netlify.app and /guide/, and has one link list per group", (ctx) => {
    const file = join(PUBLIC, "resources/index.html");
    if (!exists(file)) return ctx.skip("PENDING: public/resources/index.html");
    const html = read(file);
    for (const href of ["https://github.com/fenago/BeachDay", "https://mcp-api.netlify.app/", "/guide/"]) expect(html.includes(`href="${href}"`), `Resources links ${href}`).toBe(true);
    for (const host of ["open-meteo.com", "weather.gov", "docs.netlify.com", "supabase.com", "platform.claude.com", "code.claude.com", "docs.github.com", "developer.mozilla.org", "web.dev", "webkit.org", "w3.org", "developer.apple.com", "floridahealth.gov", "myfwc.com", "optics.marine.usf.edu", "tidesandcurrents.noaa.gov", "console.cloud.google.com"]) expect(html.includes(host), `Resources links ${host}`).toBe(true);
  });
});
