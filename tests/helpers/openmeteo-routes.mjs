// Playwright helpers: mock Open-Meteo from fixtures, forward the browser's Supabase calls to the harness's fake, and
// guard against any request to an unexpected host. Works on a BrowserContext or a Page.
// Routing order: Playwright runs the LAST registered matching route first, so install the guard FIRST, specific routes after.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { FIXTURE_SUPABASE_URL } from "./secrets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_DIRS = [join(ROOT, "tests/fixtures/openmeteo"), join(ROOT, "knowledge/open-meteo-integrator/examples/01-openmeteo-client/fixtures")];

export function loadFixture(name) {
  const file = name.endsWith(".json") ? name : `${name}.json`;
  for (const d of FIXTURE_DIRS) if (existsSync(join(d, file))) return JSON.parse(readFileSync(join(d, file), "utf8"));
  throw new Error(`openmeteo fixture not found: ${file} (looked in ${FIXTURE_DIRS.join(", ")})`);
}

export const OPEN_METEO_HOSTS = ["api.open-meteo.com", "marine-api.open-meteo.com"];

/**
 * Serve Open-Meteo from fixtures. forecast / marine: a fixture name, an object, or null (marine missing: answers 400-style error).
 * status: force an HTTP status for BOTH hosts (e.g. 429). Returns { requests, setForecast, setMarine, setStatus }.
 * The URL globs cover the whole URL including the query string (glob must match the entire URL).
 */
export async function routeOpenMeteo(target, { forecast = "forecast-miami-beach", marine = "marine-miami-beach", status = null } = {}) {
  const st = { forecast, marine, status, requests: [] };
  const body = (v) => (typeof v === "string" ? loadFixture(v) : v);
  await target.route("https://api.open-meteo.com/**", (route) => {
    st.requests.push(route.request().url());
    if (st.status) return route.fulfill({ status: st.status, json: { error: true, reason: "fixture forced status" } });
    return route.fulfill({ json: body(st.forecast), headers: { "access-control-allow-origin": "*" } });
  });
  await target.route("https://marine-api.open-meteo.com/**", (route) => {
    st.requests.push(route.request().url());
    if (st.status) return route.fulfill({ status: st.status, json: { error: true, reason: "fixture forced status" } });
    if (st.marine === null) return route.fulfill({ status: 400, json: { error: true, reason: "fixture: marine missing" }, headers: { "access-control-allow-origin": "*" } });
    return route.fulfill({ json: body(st.marine), headers: { "access-control-allow-origin": "*" } });
  });
  return {
    requests: st.requests,
    setForecast: (v) => { st.forecast = v; }, setMarine: (v) => { st.marine = v; }, setStatus: (v) => { st.status = v; },
    forecastCalls: () => st.requests.filter((u) => u.startsWith("https://api.open-meteo.com/")).length,
    marineCalls: () => st.requests.filter((u) => u.startsWith("https://marine-api.open-meteo.com/")).length,
  };
}

/**
 * Host guard: any request outside the site origin, Open-Meteo and the fixture Supabase host is ABORTED and recorded.
 * Install before the other routes. Call guard.assertClean() in afterEach.
 */
export async function guardHosts(target, { siteOrigin, extraAllowed = [], supabaseHost = new URL(FIXTURE_SUPABASE_URL).host } = {}) {
  const allowed = new Set([new URL(siteOrigin).host, ...OPEN_METEO_HOSTS, supabaseHost, ...extraAllowed]);
  const violations = [];
  await target.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (["data:", "blob:", "about:"].includes(u.protocol) || allowed.has(u.host)) return route.fallback();
    violations.push(`${route.request().method()} ${u.origin}${u.pathname}`);
    return route.abort("blockedbyclient");
  });
  return { violations, assertClean() { if (violations.length) throw new Error(`unexpected hosts reached: ${violations.join(", ")}`); } };
}

/**
 * Forward the BROWSER's Supabase calls to the harness fake (same state the server-side guard reads).
 * The browser sees a cross-origin API, so answer the CORS preflight and add ACAO like Supabase does.
 * The host comes from /generated/config.js: pass it in, never hard-code a real project.
 */
export async function routeSupabase(target, { siteOrigin, supabaseOrigin = FIXTURE_SUPABASE_URL }) {
  const seen = [];
  const cors = (extra = {}) => ({
    "access-control-allow-origin": siteOrigin, "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-expose-headers": "x-supabase-api-version", vary: "Origin", ...extra,
  });
  await target.route(`${supabaseOrigin}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    seen.push(`${req.method()} ${u.pathname}`);
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const headers = { ...req.headers() };
    delete headers.host; delete headers.origin; delete headers.referer;
    let res;
    try {
      res = await route.fetch({ url: `${siteOrigin}/__fake/supabase${u.pathname}${u.search}`, method: req.method(), headers, postData: req.postDataBuffer() ?? undefined, maxRedirects: 0 });
    } catch { return route.abort("connectionreset"); }
    if (res.headers()["x-fake-network-error"]) return route.abort("connectionreset");
    return route.fulfill({ response: res, headers: { ...res.headers(), ...cors() } });
  });
  return { seen };
}
