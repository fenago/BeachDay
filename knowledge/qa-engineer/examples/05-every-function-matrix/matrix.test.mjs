// Run: node --test matrix.test.mjs   (Node built-ins only)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROUTES, SITE, NOW, makeWorld, makeApp, request, newKey, sign, claimsFor, runMatrix, buildCases } from "./harness.mjs";

const admin = () => { const key = newKey(); return { key, world: makeWorld({ key }), token: sign(key, claimsFor()) }; };

test("completeness: the registry equals the route table in docs/04 §2 (a new route without tests fails here)", () => {
  const doc = readFileSync(new URL("../../../../docs/04-agent-console.md", import.meta.url), "utf8");
  const section = doc.split("## 2. Endpoints")[1].split("### 2.1")[0];
  const inDoc = [...section.matchAll(/^\| `(GET|POST) (\/api\/[^`]+)`/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
  assert.deepEqual(ROUTES.map((r) => r.key).sort(), inDoc);
  assert.equal(inDoc.length, 8);
});

test("matrix: every route x every bad-credential case -> exact status, headers, nothing touched, nothing echoed", async () => {
  const failures = await runMatrix();
  const { cases } = buildCases();
  console.log(`  ${ROUTES.length} routes x ${cases.length} cases = ${ROUTES.length * cases.length} checks, ${failures.length} failures`);
  assert.deepEqual(failures, []);
});

test("positive control: a valid super_admin is let in on every route (so the matrix cannot pass by refusing everything)", async () => {
  for (const r of ROUTES) {
    const { world, token } = admin();
    const app = makeApp({ world });
    const res = await app.handlers[r.key](request(r, { token, body: { contentHash: "a1b2c3d4" } }));
    assert.equal(res.status, 200, r.key);
  }
});

test("mutants: the matrix catches a route that skips the guard, one that touches a store before it, a skipped signature check and a role read from the JWT", async () => {
  const noGuard = await runMatrix({ mutate: { noGuard: "POST /api/chat" } });
  assert.ok(noGuard.length > 0 && noGuard.every((f) => f.startsWith("POST /api/chat")), "noGuard not caught");
  const early = await runMatrix({ mutate: { touchBeforeGuard: "GET /api/agents" } });
  assert.ok(early.some((f) => f.startsWith("GET /api/agents") && f.includes("touched")), "early side effect not caught");
  const sig = await runMatrix({ mutate: { skipSignature: true } });
  assert.ok(sig.some((f) => f.includes("bad signature")) && sig.some((f) => f.includes("another project's key")), "skipped signature check not caught");
  const role = await runMatrix({ mutate: { trustJwtRole: true } });
  assert.ok(role.some((f) => f.includes("JWT claims role=super_admin")), "role read from the JWT not caught");
  console.log(`  skipSignature mutant: ${sig.length} failures; trustJwtRole mutant: ${role.length} failures`);
  console.log(`  noGuard mutant: ${noGuard.length} failures; touch-before-guard mutant: ${early.length} failures`);
});

test("outside production: routes that call Claude or GitHub answer 503 before touching anything; the others still work", async () => {
  for (const r of ROUTES) {
    const { world, token } = admin();
    const app = makeApp({ world, deployContext: "deploy-preview" });
    const res = await app.handlers[r.key](request(r, { token, body: { contentHash: "a1b2c3d4" } }));
    assert.equal(res.status, r.prod ? 503 : 200, r.key);
    if (r.prod) assert.deepEqual(app.spy, { claude: 0, github: 0, blobs: 0 }, r.key);
  }
});

test("no token is still 401 outside production (the guard is the first line)", async () => {
  const { world } = admin();
  const app = makeApp({ world, deployContext: "deploy-preview" });
  const r = ROUTES.find((x) => x.key === "POST /api/chat");
  assert.equal((await app.handlers[r.key](request(r))).status, 401);
});

test("Origin / Sec-Fetch-Site on every POST: cross-site, same-site, foreign and null Origin -> 403; same-origin or absent -> allowed", async () => {
  const bad = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "https://evil.example" }, { origin: "null" }];
  const good = [{ "sec-fetch-site": "same-origin", origin: SITE }, {}];
  for (const r of ROUTES.filter((x) => x.method === "POST")) {
    for (const headers of bad) {
      const { world, token } = admin();
      const app = makeApp({ world });
      const res = await app.handlers[r.key](request(r, { token, headers, body: { contentHash: "a1b2c3d4" } }));
      assert.equal(res.status, 403, `${r.key} ${JSON.stringify(headers)}`);
      assert.deepEqual(app.spy, { claude: 0, github: 0, blobs: 0 });
    }
    for (const headers of good) {
      const { world, token } = admin();
      const res = await makeApp({ world }).handlers[r.key](request(r, { token, headers, body: { contentHash: "a1b2c3d4" } }));
      assert.equal(res.status, 200, `${r.key} ${JSON.stringify(headers)}`);
    }
  }
});

// ---- approve: step-up, hash, double approve (docs/04 §4.2, §7) ----
const approve = ROUTES.find((r) => r.key.endsWith("/approve"));
async function approveWith({ amr, aal = "aal1", last = NOW - 30, factors = [], hash = "a1b2c3d4" }) {
  const key = newKey();
  const world = makeWorld({ key, users: { "user-1": { id: "user-1", last_sign_in_at: new Date(last * 1000).toISOString(), factors } } });
  const app = makeApp({ world });
  const token = sign(key, claimsFor({ amr, aal }));
  const res = await app.handlers[approve.key](request(approve, { token, body: { contentHash: hash } }));
  return { res, body: await res.json(), app };
}
const pw = (age) => [{ method: "password", timestamp: NOW - age }];
for (const [name, args] of [
  ["primary sign-in 601 s old", { amr: pw(601), last: NOW - 601 }],
  ["only token_refresh is fresh", { amr: [{ method: "token_refresh", timestamp: NOW - 5 }, ...pw(2000)], last: NOW - 2000 }],
  ["fresh totp but a stale sign-in (a token thief enrolled a factor)", { amr: [{ method: "totp", timestamp: NOW - 5 }, ...pw(2000)], aal: "aal2", last: NOW - 2000 }],
  ["verified factor but aal1", { amr: pw(30), factors: [{ status: "verified" }] }],
  ["fresh amr but stale last_sign_in_at", { amr: pw(30), last: NOW - 700 }],
]) {
  test(`approve step-up: ${name} -> 401 step_up_required, proposal stays pending, GitHub untouched`, async () => {
    const { res, body, app } = await approveWith(args);
    assert.equal(res.status, 401);
    assert.equal(body.error.code, "step_up_required");
    assert.equal(app.proposal.status, "pending");
    assert.equal(app.spy.github, 0);
  });
}
test("approve step-up: a sign-in exactly 600 s old passes; a verified factor with aal2 passes", async () => {
  assert.equal((await approveWith({ amr: pw(600), last: NOW - 600 })).res.status, 200);
  assert.equal((await approveWith({ amr: pw(30), aal: "aal2", factors: [{ status: "verified" }] })).res.status, 200);
});
test("approve: content-hash mismatch -> 409 and GitHub untouched; proposal stays pending", async () => {
  const { res, app } = await approveWith({ amr: pw(30), hash: "deadbeef" });
  assert.equal(res.status, 409);
  assert.deepEqual([app.spy.github, app.proposal.status], [0, "pending"]);
});
test("approve: the second Approve on the same proposal gets 409; GitHub is touched once", async () => {
  const key = newKey();
  const world = makeWorld({ key });
  const app = makeApp({ world });
  const token = sign(key, claimsFor());
  const send = () => app.handlers[approve.key](request(approve, { token, body: { contentHash: "a1b2c3d4" } }));
  assert.deepEqual([(await send()).status, (await send()).status], [200, 409]);
  assert.equal(app.spy.github, 1);
});
