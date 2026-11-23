// Post-deploy smoke test (example for scripts/smoke.mjs; run by hand or by QA
// right after an Approve deploy goes live). Usage:
//   BASE_URL=https://<site>.netlify.app EXPECT_COMMIT=<40-hex> node smoke.mjs
// Prints PASS/FAIL lines only. Never sends credentials. Exit 1 on any FAIL.
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

  // Fail-closed check: every /api route must refuse a request with no token.
  for (const [method, path] of [["GET", "/api/agents"], ["POST", "/api/chat"], ["POST", "/api/proposals/p_00000000000000000000000000/approve"]]) {
    const r = await get(path, { method });
    check(r.status === 401, `${method} ${path} without a token -> 401 (got ${r.status})`);
    check((r.headers.get("cache-control") ?? "") === "no-store", `${path} sets its own cache-control: no-store`);
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.BASE_URL;
  if (!base) { console.error("BASE_URL required"); process.exit(1); }
  const results = await smoke(base, process.env.EXPECT_COMMIT);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.msg}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
