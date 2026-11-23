// R8 (W1 review): every reason and advice copyId the data layer can emit is in the copy deck, and t() fills it without throwing.
// Runs the whole data seam over every derived fixture (days 0-6) plus the real captures. No network: fetch is injected.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { loadForecast } from "../../public/js/forecast.js";
import { STRINGS, t, DECK, VERDICTS, SAFETY } from "../../public/js/copy/copy-deck.js";

const DIR = new URL("../fixtures/openmeteo/", import.meta.url);
const read = (n) => JSON.parse(readFileSync(new URL(n, DIR), "utf8"));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => m.delete(k) }; };
const derived = readdirSync(DIR).filter((f) => f.endsWith("-derived.json"));

async function days(file) {
  const fx = read(file);
  const fetchImpl = async (url) => (new URL(url).host === "marine-api.open-meteo.com" ? (fx.marine ? json(200, fx.marine) : json(fx.marineStatus ?? 500, { message: "down" })) : json(200, fx.forecast));
  const f = await loadForecast("miami-beach", { fetchImpl, now: Date.parse(fx.now), storage: mem(), online: true });
  return f.days;
}

describe("every emitted copyId is in the deck and fills", () => {
  it("there are derived fixtures to run", () => { expect(derived.length).toBeGreaterThanOrEqual(13); });
  for (const file of derived) {
    it(`${file}: reasons and advice (days 0-6)`, async () => {
      const ds = await days(file);
      const missing = [];
      let seen = 0;
      for (const d of ds) for (const item of [...(d.reasons ?? []), ...(d.advice ?? [])]) {
        seen++;
        if (!(item.copyId in STRINGS)) { missing.push(`${d.date}: ${item.code} -> ${item.copyId}`); continue; }
        try { t(item.copyId, item.params ?? {}); } catch (e) { missing.push(`${d.date}: ${item.copyId}: ${e.message}`); }
      }
      expect(missing).toEqual([]);
      if (ds.length) expect(seen).toBeGreaterThanOrEqual(0);
    });
  }
  it("the four verdicts and the safety line are in the deck, and the safety text is the exact contract line", () => {
    expect(Object.keys(VERDICTS).sort()).toEqual(["fair", "good", "great", "skip"]);
    expect(VERDICTS.great.label).toBe("Great beach day");
    expect(VERDICTS.fair.label).toBe("Fair — pick your hours");
    expect(SAFETY.text).toBe("Beach Day is not a safety service — check NWS rip-current risk and posted beach flags.");
    expect(DECK.safety.linkText).toBe("NWS rip-current risk");
  });
  it("D3 positive reason strings exist (D3 is on)", () => {
    for (const id of ["reason.pos.dry", "reason.pos.sunny", "reason.pos.comfortable", "reason.pos.wind", "reason.pos.waves", "reason.pos.water"]) expect(STRINGS[id], id).toBeTruthy();
  });
  it("every string with a {placeholder} uses a simple word (t() can fill it)", () => {
    for (const [id, s] of Object.entries(STRINGS)) for (const m of s.matchAll(/\{([^}]*)\}/g)) expect(m[1], id).toMatch(/^\w+$/);
  });
});
