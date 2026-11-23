// Post-deploy smoke test (run by hand or by QA
// right after an Approve deploy goes live). Usage:
//   BASE_URL=https://<site>.netlify.app EXPECT_COMMIT=<40-hex> node scripts/smoke.mjs
// Prints PASS/FAIL lines only. Never sends credentials. Exit 1 on any FAIL.
import { pathToFileURL } from "node:url";
export async function smoke(base, expectCommit, fetchImpl = fetch) {
  const results = [];
  const check = (ok, msg) => results.push({ ok, msg });
  const get = (path, init) => fetchImpl(new URL(path, base), { redirect: "manual", ...init });

  const sw = await get("/sw.js");
  const swText = await sw.text();
  check(sw.status === 200, "/sw.js is 200");
  check(!swText.includes("__BUILD_VERSION__"), "/sw.js has no unstamped placeholder");
  check((sw.headers.get("cache-control") ?? "").includes("no-cache"), "/sw.js is Cache-Control: no-cache");

  const v = await (await get("/version.json", { cache: "no-store" })).json().catch(() => null);
  check(!!v?.version && swText.includes(v.version), "sw.js contains the version in /version.json");
  if (expectCommit) check(v?.commit === expectCommit, "version.json commit equals the approved commit (Live)");

  const mf = await get("/manifest.webmanifest");
  check((mf.headers.get("content-type") ?? "").startsWith("application/manifest+json"), "manifest content type");

  const home = await get("/");
  const csp = home.headers.get("content-security-policy") ?? "";
  check(csp.includes("default-src 'self'") && csp.includes("form-action 'self'"), "CSP present on / with form-action");
  check(!/unsafe-inline|unsafe-eval|\*/.test(csp), "CSP has no unsafe-inline, unsafe-eval or wildcard");
  check((home.headers.get("cross-origin-opener-policy") ?? "") === "same-origin", "COOP same-origin on /");

  // Fail-closed check: every SYNC /api route must refuse a request with no token.
  // /api/jobs-run is deliberately NOT here: a background function always answers
  // 202 (it cannot say 401), so a 202 there proves nothing and a 401 is impossible.
  // Its guard is covered by the unit tests (example 01, test 10), not by smoke.
  for (const [method, path] of [["GET", "/api/agents"], ["POST", "/api/chat"], ["POST", "/api/jobs"], ["GET", "/api/jobs/j_00000000000000000000000000"], ["GET", "/api/proposals/p_00000000000000000000000000"], ["POST", "/api/proposals/p_00000000000000000000000000/reject"], ["POST", "/api/proposals/p_00000000000000000000000000/approve"]]) {
    const r = await get(path, { method });
    check(r.status === 401, `${method} ${path} without a token -> 401 (got ${r.status})`);
    check((r.headers.get("cache-control") ?? "") === "no-store", `${path} sets its own cache-control: no-store`);
    check((r.headers.get("x-content-type-options") ?? "") === "nosniff", `${path} sets x-content-type-options: nosniff`);
    check(!r.headers.has("access-control-allow-origin") && !r.headers.has("set-cookie"), `${path} sends no CORS or Set-Cookie header`);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.BASE_URL;
  if (!base) { console.error("BASE_URL required"); process.exit(1); }
  const results = await smoke(base, process.env.EXPECT_COMMIT);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.msg}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
