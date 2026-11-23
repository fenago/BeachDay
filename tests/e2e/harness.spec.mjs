// Proves the full-stack local harness itself (build wave W1): static serving, _headers + CSP, the stamped sw.js,
// /api/* routing (501 while a handler module is missing, 401 once it exists), the Supabase forwarding the Console e2e relies on,
// and the host guard. Product specs live in other files.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { harnessClient } from "../helpers/harness-client.mjs";
import { guardHosts, routeSupabase, routeOpenMeteo } from "../helpers/openmeteo-routes.mjs";
import { FIXTURE_SUPABASE_URL } from "../helpers/secrets.mjs";

const hasIndex = existsSync(new URL("../../public/index.html", import.meta.url));
const hasAgentsHandler = existsSync(new URL("../../netlify/functions/agents.mts", import.meta.url));

test.beforeEach(async ({ baseURL }) => { await harnessClient(baseURL).reset(); });

test("serves / (200, html) once public/index.html exists @harness", async ({ request }) => {
  test.skip(!hasIndex, "public/index.html is not built yet (Pip, W2): / is not testable");
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
});

test("applies public/_headers: CSP with the fixture Supabase host, nosniff, no unsubstituted placeholder", async ({ request }) => {
  const res = await request.get("/offline.html");
  expect(res.status()).toBe(200);
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain(`connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com ${FIXTURE_SUPABASE_URL}`);
  expect(csp).not.toContain("<project-ref>");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("sw.js is stamped in memory and revalidated; version.json follows the settable version; /generated/config.js is the fixture", async ({ request, baseURL }) => {
  const h = harnessClient(baseURL);
  await h.harness.setVersion({ version: "abc1234def" });
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  const body = await sw.text();
  expect(body).not.toContain("__BUILD_VERSION__");
  expect(body).toContain("abc1234def");
  expect(sw.headers()["cache-control"]).toBe("no-cache");
  const v = await (await request.get("/version.json")).json();
  expect(v.commit).toBe("abc1234def");
  expect((await request.get("/version.json")).headers()["cache-control"]).toBe("no-store");
  const cfg = await (await request.get("/generated/config.js")).text();
  expect(cfg).toContain("https://bdlocaltest.supabase.co");
  expect(cfg).toContain("sb_publishable_bdlocaltest_");
});

test("/api/agents: 501 while the handler is missing, 401 without a token once it exists; always no-store", async ({ request }) => {
  const res = await request.get("/api/agents");
  if (hasAgentsHandler) expect(res.status()).toBe(401); else expect(res.status()).toBe(501);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
  expect((await request.get("/api/does-not-exist")).status()).toBe(404);
});

test("browser -> Supabase host is forwarded to the SAME fake the server uses; the CSP lets it through", async ({ page, context, baseURL }) => {
  const h = harnessClient(baseURL);
  const guard = await guardHosts(context, { siteOrigin: baseURL });
  await routeSupabase(context, { siteOrigin: baseURL });
  const violations = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.goto("/offline.html");
  const keys = await page.evaluate(async (host) => (await (await fetch(`${host}/auth/v1/.well-known/jwks.json`)).json()).keys.length, FIXTURE_SUPABASE_URL);
  expect(keys).toBe(1);
  expect(await h.supabase.callCount({ pattern: "jwks.json" })).toBe(1);
  expect(violations).toEqual([]);
  guard.assertClean();
});

test("a Supabase network failure injected on the fake reaches the browser as a failed fetch", async ({ page, context, baseURL }) => {
  const h = harnessClient(baseURL);
  await guardHosts(context, { siteOrigin: baseURL });
  await routeSupabase(context, { siteOrigin: baseURL });
  await page.goto("/offline.html");
  await h.supabase.fail({ target: "jwks", mode: "network", times: 1 });
  const failed = await page.evaluate(async (host) => fetch(`${host}/auth/v1/.well-known/jwks.json`).then(() => false, () => true), FIXTURE_SUPABASE_URL);
  expect(failed).toBe(true);
});

test("host guard: a request to any other host is aborted and recorded; Open-Meteo is served from fixtures", async ({ page, context, baseURL }) => {
  const guard = await guardHosts(context, { siteOrigin: baseURL });
  const om = await routeOpenMeteo(context);
  await page.goto("/offline.html");
  const results = await page.evaluate(async () => ({
    claude: await fetch("https://api.anthropic.com/v1/messages").then(() => "reached", () => "blocked"),
    github: await fetch("https://api.github.com/repos/x/y").then(() => "reached", () => "blocked"),
    meteo: await fetch("https://api.open-meteo.com/v1/forecast?latitude=25.78&longitude=-80.13").then((r) => r.json()).then((j) => j.timezone, () => "failed"),
  }));
  expect(results).toEqual({ claude: "blocked", github: "blocked", meteo: "America/New_York" });
  expect(guard.violations.map((v) => new URL(v.split(" ")[1]).host).sort()).toEqual(["api.anthropic.com", "api.github.com"]);
  expect(om.forecastCalls()).toBe(1);
});
