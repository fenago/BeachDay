import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { validate, pngInfo } from "../../knowledge/pwa-mobile-engineer/examples/01-manifest-validator/validate-manifest.mjs";

// Minimal decoder for our own filter-0 RGB PNGs.
function decode(buf) {
  const { width, height } = pngInfo(buf);
  const idat = []; let o = 8;
  while (o < buf.length) { const len = buf.readUInt32BE(o); if (buf.toString("ascii", o + 4, o + 8) === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat));
  return { width, height, pixel: (x, y) => { const i = y * (width * 3 + 1) + 1 + x * 3; return [raw[i], raw[i + 1], raw[i + 2]]; } };
}
const root = join(import.meta.dirname, "../../public");
const raw = readFileSync(join(root, "manifest.webmanifest"), "utf8");
const manifest = JSON.parse(raw);
const readAsset = (p) => { const f = join(root, decodeURIComponent(p)); return existsSync(f) ? readFileSync(f) : null; };

describe("public/manifest.webmanifest", () => {
  it("passes the Chromium criteria and Beach Day rules with no errors or warnings", () => {
    const { errors, warnings } = validate(manifest, { readAsset });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
  it("has exactly the docs/02 values", () => {
    expect(manifest).toMatchObject({
      id: "/", short_name: "Beach Day", start_url: "/?source=pwa", scope: "/", display: "standalone",
      theme_color: "#0b3b5c", background_color: "#0b3b5c",
    });
    expect(manifest.icons.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/icons/icon-192.png", "192x192", "any"],
      ["/icons/icon-512.png", "512x512", "any"],
      ["/icons/icon-maskable-512.png", "512x512", "maskable"],
    ]);
    expect(manifest.screenshots).toHaveLength(1);
    expect(manifest.screenshots[0]).toMatchObject({ src: "/screenshots/today-narrow-1080x2340.png", sizes: "1080x2340", form_factor: "narrow" });
    expect(manifest.screenshots[0].label).toBeTruthy();
  });
  it("has no shortcuts and never mentions the Console", () => {
    expect(manifest.shortcuts).toBeUndefined();
    expect(raw.toLowerCase()).not.toContain("console");
  });
  it("icons are full-bleed #0b3b5c opaque RGB, with the apple-touch icon at 180", () => {
    const ico = (p) => readFileSync(join(root, p));
    for (const p of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon-180.png"]) {
      const info = pngInfo(ico(p));
      expect(info.colourType, p).toBe(2);
    }
    expect(pngInfo(ico("icons/apple-touch-icon-180.png"))).toMatchObject({ width: 180, height: 180 });
  });
  it("corners and edges of every icon are the brand colour #0b3b5c (no box edge on Android's splash)", () => {
    for (const p of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon-180.png"]) {
      const { width, height, pixel } = decode(readFileSync(join(root, p)));
      for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width >> 1, 0], [0, height >> 1]]) {
        expect(pixel(x, y), `${p} @${x},${y}`).toEqual([11, 59, 92]);
      }
    }
  });
});
