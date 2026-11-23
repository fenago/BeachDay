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
  // Any quoted path or URL that points into vendor/, generated/, js/console/, or at a Supabase host.
  const FORBIDDEN = /["'`(]\s*(?:\.{0,2}\/)*(?:[^"'`)\s]*\/)?(?:vendor\/|generated\/|js\/console\/)|supabase\.co|@supabase\//;

  it("scans at least the files that exist now", () => {
    expect(Array.isArray(files)).toBe(true);
  });

  it("no beach-app file references vendor/, generated/, js/console/ or Supabase (sw.js only lists them to skip them)", () => {
    const hits = [];
    for (const p of files) {
      const r = rel(p);
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (!FORBIDDEN.test(line)) return;
        // sw.js may NAME these paths in its never-intercept list (docs/02 §5); it must not import or fetch them.
        if (r === "public/sw.js" && !/\b(import|importScripts)\b/.test(line)) return;
        hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the rule itself catches the forbidden shapes (self-test)", () => {
    for (const bad of [
      `import { AuthClient } from "../vendor/supabase-auth-js-2.119.2.mjs";`,
      `import { SUPABASE_URL } from "/generated/config.js";`,
      `<script type="module" src="/js/console/main.js"></script>`,
      `fetch("https://bdlocaltest.supabase.co/auth/v1/token")`,
      `import x from "@supabase/auth-js";`,
    ]) expect(FORBIDDEN.test(bad), bad).toBe(true);
    for (const ok of [`import { t } from "./copy/copy-deck.js";`, `<a href="/console">Agents</a>`, `import { loadForecast } from "./forecast.js";`]) {
      expect(FORBIDDEN.test(ok), ok).toBe(false);
    }
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

  it.skipIf(!hasDeck)("D3 positive codes are the deck's POSITIVE_REASON_IDS keys", async () => {
    const deck = await imp("public/js/copy/copy-deck.js");
    const positives = Object.keys(deck.POSITIVE_REASON_IDS).sort();
    expect(dv.reason.properties.code.enum.filter((c) => positives.includes(c)).sort()).toEqual(positives);
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
