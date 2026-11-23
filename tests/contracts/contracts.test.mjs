// Interface contracts for Beach Day v1 (docs/design/build-contracts.md).
// 1. Every schema compiles in Ajv strict mode (JSON Schema 2020-12).
// 2. Every sample in samples/*.samples.json is valid/invalid as its "expect" says.
// 3. REAL Open-Meteo captures (fixtures/, 2026-11-23, copied from knowledge/open-meteo-integrator/examples/01) normalize
//    into valid ForecastHours, with SST converted from degC.
// 4. An SSE stream round-trips through the client parser and every event validates.
// 5. Seam checks against the real code. Each one is skipped while its file does not exist yet (W1 builds in parallel),
//    except the import rule, which must hold from the start.
// Owner: software-architect. No network, no secrets.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const load = (p) => JSON.parse(readFileSync(join(here, p), "utf8"));

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const schemaFiles = readdirSync(join(here, "schemas")).filter((f) => f.endsWith(".schema.json")).sort();
for (const f of schemaFiles) ajv.addSchema(load(`schemas/${f}`));
const v = {};
for (const f of schemaFiles) v[f.replace(".schema.json", "")] = ajv.getSchema(load(`schemas/${f}`).$id);
const errs = (fn) => (fn.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");

describe("schemas", () => {
  it("there are 13 contract schemas and each compiles in strict mode", () => {
    expect(schemaFiles).toHaveLength(13);
    for (const [name, fn] of Object.entries(v)) expect(typeof fn, name).toBe("function");
  });
});

describe("samples", () => {
  const sampleFiles = readdirSync(join(here, "samples")).filter((f) => f.endsWith(".samples.json")).sort();
  it("every schema has samples, with at least one valid and one invalid", () => {
    expect(sampleFiles.map((f) => f.replace(".samples.json", "")).sort()).toEqual(Object.keys(v).sort());
    for (const f of sampleFiles) {
      const kinds = new Set(load(`samples/${f}`).map((s) => s.expect));
      expect([...kinds].sort(), f).toEqual(["invalid", "valid"]);
    }
  });
  for (const f of sampleFiles) {
    const name = f.replace(".samples.json", "");
    for (const [i, s] of load(`samples/${f}`).entries()) {
      it(`${name}#${i} ${s.expect}: ${s.why}`, () => {
        const ok = v[name](s.data);
        expect(ok, ok ? "unexpectedly valid" : errs(v[name])).toBe(s.expect === "valid");
      });
    }
  }
});

// Reference normalizer with the contract's field names (knowledge/open-meteo-integrator/examples/01, normalize()).
const cToF = (c) => (c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10);
function referenceNormalize(fc, marine) {
  const h = fc.hourly;
  const at = new Map((marine?.hourly.time ?? []).map((t, j) => [t, j]));
  return h.time.map((time, i) => {
    const j = at.get(time);
    const m = (k) => (j === undefined ? null : marine.hourly[k][j]);
    return {
      time, tempF: h.temperature_2m[i], feelsF: h.apparent_temperature[i], humidity: h.relative_humidity_2m[i],
      rainChance: h.precipitation_probability[i], rainIn: h.precipitation[i], weatherCode: h.weather_code[i],
      cloudPct: h.cloud_cover[i], windMph: h.wind_speed_10m[i], gustMph: h.wind_gusts_10m[i], windDir: h.wind_direction_10m[i],
      uv: h.uv_index[i], cape: h.cape[i], isDay: h.is_day[i] === 1,
      waveFt: m("wave_height"), wavePeriodS: m("wave_period"), waveDir: m("wave_direction"),
      swellFt: m("swell_wave_height"), swellPeriodS: m("swell_wave_period"), swellDir: m("swell_wave_direction"),
      seaTempF: cToF(m("sea_surface_temperature")),
    };
  });
}

describe("real Open-Meteo fixtures (Miami Beach, 2026-11-23)", () => {
  const fc = load("fixtures/forecast-miami-beach.json");
  const marine = load("fixtures/marine-miami-beach.json");

  it("were requested in the contract units", () => {
    expect(fc.hourly_units).toMatchObject({ temperature_2m: "°F", wind_speed_10m: "mp/h", precipitation: "inch" });
    expect(marine.hourly_units).toMatchObject({ wave_height: "ft", sea_surface_temperature: "°C" });
    expect(fc.timezone).toBe("America/New_York");
  });

  it("normalize into valid ForecastHours with marine data, SST in degF", () => {
    const hours = referenceNormalize(fc, marine);
    expect(hours).toHaveLength(fc.hourly.time.length);
    for (const h of hours) expect(v["forecast-hour"](h), `${h.time}: ${errs(v["forecast-hour"])}`).toBe(true);
    const i = marine.hourly.sea_surface_temperature.findIndex((x) => x != null);
    expect(hours[i].seaTempF).toBe(cToF(marine.hourly.sea_surface_temperature[i]));
    expect(hours[i].seaTempF).toBeGreaterThan(60);
  });

  it("normalize with Marine missing: marine fields present and null", () => {
    for (const h of referenceNormalize(fc, null)) {
      expect(v["forecast-hour"](h), errs(v["forecast-hour"])).toBe(true);
      expect(h.waveFt).toBeNull();
      expect(h.seaTempF).toBeNull();
    }
  });
});

// Client SSE parser shape from knowledge/software-architect/docs/04-sse-and-streams.md.
function parseSse(text) {
  const out = []; let buf = text; let k;
  while ((k = buf.indexOf("\n\n")) >= 0) {
    const block = buf.slice(0, k); buf = buf.slice(k + 2);
    let event = "message"; const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const [f, ...r] = line.split(":"); const val = r.join(":").replace(/^ /, "");
      if (f === "event") event = val; else if (f === "data") data.push(val);
    }
    if (data.length) out.push({ event, payload: JSON.parse(data.join("\n")) });
  }
  return out;
}

describe("SSE wire format", () => {
  it("round-trips: event name equals type, every event valid, ends with one terminal event", () => {
    const events = [
      { type: "tool", name: "read_file", phase: "start", summary: "Read public/js/score.js" },
      { type: "text", delta: "Line one\nline two: with a colon" },
      { type: "proposal", proposalId: "p_01JDQ8Z5K3M7N2P4R6S8T0V9WX", summary: "Treat null wave_height as missing.", files: [{ path: "public/js/score.js", bytes: 5120 }] },
      { type: "done", stopReason: "end_turn" },
    ];
    const wire = ": ping\n\n" + events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const parsed = parseSse(wire);
    expect(parsed.map((p) => p.payload)).toEqual(events);
    for (const p of parsed) {
      expect(p.event).toBe(p.payload.type);
      expect(v["sse-event"](p.payload), errs(v["sse-event"])).toBe(true);
    }
    expect(parsed.filter((p) => ["done", "error"].includes(p.payload.type))).toHaveLength(1);
  });
});

// ---- Seam checks against the real code -------------------------------------------------------------------------

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p) => relative(root, p).split(sep).join("/");

describe("import rule: the beach app never loads auth or Console code (ADR-0006, build-contracts §7)", () => {
  // Allowed to reference auth: the Console page and its modules. vendor/ and generated/ are the auth files themselves.
  const consoleSide = (r) => r === "public/console.html" || r.startsWith("public/js/console/") ||
    r.startsWith("public/vendor/") || r.startsWith("public/generated/");
  const files = walk(join(root, "public")).filter((p) => /\.(js|mjs|html)$/.test(p)).filter((p) => !consoleSide(rel(p)));

  // A target is forbidden if it points into vendor/, generated/ or js/console/, at a Supabase host, or at @supabase/*.
  const BAD_TARGET = /(?:^|\/)(?:vendor|generated|js\/console)\/|supabase\.co\b|^@supabase\//;

  // Only what can LOAD code or CONNECT counts. Links (<a href>) and prose are not loads.
  function loadTargets(text, kind) {
    const out = [];
    const add = (re, group = 1) => { for (const m of text.matchAll(re)) out.push(m[group]); };
    if (kind === "html") {
      add(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi);
      for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
        if (/\brel\s*=\s*["'](?:modulepreload|stylesheet|preload)["']/i.test(m[0])) {
          const h = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]);
          if (h) out.push(h[1]);
        }
      }
      for (const m of text.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi)) {
        const c = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(m[0]);
        if (c) out.push(...c[1].split(/\s+/));
      }
      return out;
    }
    // JS: drop comments (block comments, and lines that are only a // comment) so prose never counts.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    add(/\b(?:import|export)\b[^"'`;]*?\bfrom\s*["'`]([^"'`]+)["'`]/g);
    add(/\bimport\s*["'`]([^"'`]+)["'`]/g);
    add(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g);
    add(/\bimportScripts\s*\(\s*["'`]([^"'`]+)["'`]/g);
    add(/\b(?:fetch|EventSource|WebSocket|sendBeacon)\s*\(\s*["'`]([^"'`]+)["'`]/g);
    add(/["'`](https?:\/\/[^"'`\s]*supabase\.co[^"'`\s]*)["'`]/g); // a connect URL kept in a constant
    return out;
  }

  it("scans the beach app's HTML and JS", () => {
    expect(files.some((p) => rel(p) === "public/index.html" || rel(p).startsWith("public/js/"))).toBe(true);
  });

  it("no beach-app file loads or connects to vendor/, generated/, js/console/ or Supabase", () => {
    const hits = [];
    for (const p of files) {
      const r = rel(p);
      const kind = p.endsWith(".html") ? "html" : "js";
      for (const t of loadTargets(readFileSync(p, "utf8"), kind)) {
        // sw.js may NAME a Supabase host in its never-intercept list (docs/02 §5) but never import or fetch it;
        // its import/fetch calls are still checked above.
        if (r === "public/sw.js" && /^https?:\/\//.test(t) && !/\b(?:import|importScripts|fetch)\b/.test(t)) continue;
        if (BAD_TARGET.test(t)) hits.push(`${r}: ${t.slice(0, 120)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the rule catches loads and ignores links and prose (self-test)", () => {
    const bad = [
      ["js", `import { AuthClient } from "../vendor/supabase-auth-js-2.119.2.mjs";`],
      ["js", `import { SUPABASE_URL } from "/generated/config.js";`],
      ["js", `const m = await import("./console/main.js".replace("", "/js/console/main.js"));`],
      ["js", `import("/js/console/main.js")`],
      ["js", `fetch("https://bdlocaltest.supabase.co/auth/v1/token")`],
      ["js", `const URL = "https://abc.supabase.co";`],
      ["js", `import x from "@supabase/auth-js";`],
      ["html", `<script type="module" src="/js/console/main.js"></script>`],
      ["html", `<link rel="modulepreload" href="/vendor/supabase-auth-js-2.119.2.mjs">`],
      ["html", `<meta http-equiv="Content-Security-Policy" content="connect-src https://x.supabase.co">`],
    ];
    for (const [kind, src] of bad) expect(loadTargets(src, kind).some((t) => BAD_TARGET.test(t)), src).toBe(true);
    const ok = [
      ["js", `import { t } from "./copy/copy-deck.js";`],
      ["js", `// see https://supabase.com/docs and <your-project-ref>.supabase.co`],
      ["js", `/* auth lives in /js/console/auth.js, never imported here */`],
      ["html", `<a href="/console">Agents</a>`],
      ["html", `<a href="https://supabase.com/docs/guides/auth">Supabase Auth docs</a>`],
      ["html", `<p>Your URL looks like https://&lt;your-project-ref&gt;.supabase.co</p>`],
      ["html", `<code>https://your-project-ref.supabase.co</code>`],
    ];
    for (const [kind, src] of ok) expect(loadTargets(src, kind).some((t) => BAD_TARGET.test(t)), src).toBe(false);
  });
});

const exists = (p) => existsSync(join(root, p));
const imp = (p) => import(pathToFileURL(join(root, p)).href);

describe("seam: DEPLOY_PATHS (D9) and SETTINGS locations (build-contracts §6)", () => {
  it.skipIf(!exists("netlify/functions/lib/deploys.mts"))("DEPLOY_PATHS is the D9 list", async () => {
    const { DEPLOY_PATHS } = await imp("netlify/functions/lib/deploys.mts");
    expect([...DEPLOY_PATHS]).toEqual(["public", "netlify", "netlify.toml", "package.json", "package-lock.json", "scripts", ".claude/agents", ".claude/skills", "knowledge"]);
  });

  it.skipIf(!exists("netlify/functions/lib/settings.mts"))("every pending decision named in the contract is a SETTINGS key", async () => {
    const { SETTINGS } = await imp("netlify/functions/lib/settings.mts");
    for (const k of ["computeBudgetMinutes", "githubReadTokenEnv", "serverRefusalFallback", "denyConsoleUi", "approveCap", "approveEnabled", "jwtHeaderPrecheck"]) {
      expect(SETTINGS, k).toHaveProperty(k);
    }
    expect(SETTINGS.approveEnabled).toBe(false);
    expect(SETTINGS.jwtHeaderPrecheck).toBe(false);
  });
});

describe("seam: DayVerdict <-> copy deck (open-meteo-integrator <-> ux-designer <-> beach UI)", () => {
  const dv = load("schemas/day-verdict.schema.json").$defs;
  const hasDeck = exists("public/js/copy/copy-deck.js");

  it.skipIf(!hasDeck)("every copyId in the valid samples exists in the deck and renders with its params", async () => {
    const deck = await imp("public/js/copy/copy-deck.js");
    for (const s of load("samples/day-verdict.samples.json").filter((x) => x.expect === "valid")) {
      for (const it of [...s.data.reasons, ...s.data.advice]) {
        expect(deck.STRINGS, `${s.why}: ${it.copyId}`).toHaveProperty([it.copyId]);
        expect(() => deck.t(it.copyId, it.params), `${s.why}: ${it.copyId}`).not.toThrow();
      }
    }
  });

  it.skipIf(!hasDeck)("D3 positive codes (R8) are in the contract and each copyId reason.pos.* exists in the deck", async () => {
    const deck = await imp("public/js/copy/copy-deck.js");
    const R8 = { dry: "reason.pos.dry", sunny_sky: "reason.pos.sunny", comfortable: "reason.pos.comfortable",
      light_wind: "reason.pos.wind", calm_waves: "reason.pos.waves", warm_water: "reason.pos.water" };
    for (const [code, id] of Object.entries(R8)) {
      expect(dv.reason.properties.code.enum, code).toContain(code);
      expect(deck.STRINGS, id).toHaveProperty([id]);
    }
    expect(Object.keys(deck.STRINGS).filter((k) => k.startsWith("reason.pos.")).sort()).toEqual(Object.values(R8).sort());
  });

  it.skipIf(!hasDeck || !exists("public/js/forecast.js"))("real loadForecast() on the Miami captures: every day is a valid DayVerdict and every reason/advice renders", async () => {
    const deck = await imp("public/js/copy/copy-deck.js");
    const { loadForecast } = await imp("public/js/forecast.js");
    const fc = readFileSync(join(here, "fixtures/forecast-miami-beach.json"), "utf8");
    const mr = readFileSync(join(here, "fixtures/marine-miami-beach.json"), "utf8");
    const fetchImpl = async (url) => new Response(String(url).includes("marine") ? mr : fc, { status: 200, headers: { "content-type": "application/json" } });
    // Midday, evening (window over: no verdict) and night, New York time on 2026-11-23.
    for (const when of ["2026-11-23T17:00:00Z", "2026-11-23T22:30:00Z", "2026-11-24T03:00:00Z"]) {
      const mem = new Map();
      const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, val) => mem.set(k, val), removeItem: (k) => mem.delete(k) };
      const out = await loadForecast("miami-beach", { fetchImpl, storage, now: Date.parse(when), online: true });
      expect(out.days.length, when).toBeGreaterThan(0);
      for (const d of out.days) {
        expect(v["day-verdict"](d), `${when} ${d.date}: ${errs(v["day-verdict"])}`).toBe(true);
        for (const it of [...d.reasons, ...d.advice]) expect(() => deck.t(it.copyId, it.params), `${d.date} ${it.copyId}`).not.toThrow();
      }
    }
  });
});

describe("seam: real normalizer output (open-meteo-integrator)", () => {
  it.skipIf(!exists("public/js/api/openmeteo.js"))("normalize() on the real captures yields contract ForecastHours", async () => {
    const mod = await imp("public/js/api/openmeteo.js");
    expect(typeof mod.normalize).toBe("function");
    const out = mod.normalize(load("fixtures/forecast-miami-beach.json"), load("fixtures/marine-miami-beach.json"), { marinePoint: { lat: 25.781, lon: -80.110 } });
    expect(out.hours.length).toBeGreaterThan(0);
    for (const h of out.hours) expect(v["forecast-hour"](h), `${h.time}: ${errs(v["forecast-hour"])}`).toBe(true);
  });
});

describe("seam: agents.json -> GET /api/agents (netlify-engineer -> agent-console-engineer)", () => {
  it.skipIf(!exists("netlify/functions/lib/agents.json"))("each element minus systemPrompt is a valid agent card; prompts <= 350 KB", () => {
    const list = JSON.parse(readFileSync(join(root, "netlify/functions/lib/agents.json"), "utf8"));
    for (const a of list) {
      expect(typeof a.systemPrompt).toBe("string");
      expect(Buffer.byteLength(a.systemPrompt), a.name).toBeLessThanOrEqual(350 * 1024);
    }
    const view = { agents: list.map(({ systemPrompt: _s, ...card }) => card) };
    expect(v["agents-response"](view), errs(v["agents-response"])).toBe(true);
    expect(view.agents.map((a) => a.name)).toEqual([...view.agents.map((a) => a.name)].sort());
  });
});
