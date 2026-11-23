// Runs the real handlers with a web Request and a fake context. No network,
// no Netlify account, no real secrets. Run: node --test test/functions.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { createFakeStore, fakeContext } from "./fake-blobs.mjs";
import { setStoreFactory, store } from "../netlify/functions/lib/blobs.mjs";
import login, { config as loginConfig } from "../netlify/functions/login.mjs";
import jobRun, { config as runConfig } from "../netlify/functions/job-run.mjs";
import jobStatus, { config as statusConfig } from "../netlify/functions/job-status.mjs";

// Test-only values generated at runtime: obviously not real credentials.
const TEST_PASSWORD = "correct horse test";
const salt = randomBytes(16);
process.env.CONSOLE_PASSWORD_HASH =
  `scrypt$${salt.toString("base64")}$${scryptSync(TEST_PASSWORD, salt, 32).toString("base64")}`;
process.env.SESSION_SECRET = "test-session-secret-EXAMPLE";

let stores;
beforeEach(() => {
  stores = new Map();
  setStoreFactory((name) => {
    if (!stores.has(name)) stores.set(name, createFakeStore());
    return stores.get(name);
  });
});

const post = (url, body) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("config objects match the Beach Day routing plan", () => {
  assert.deepEqual(loginConfig.rateLimit, { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] });
  assert.ok(loginConfig.rateLimit.windowSize <= 180, "windowSize max is 180 s");
  assert.equal(runConfig.background, true);
  assert.equal(statusConfig.path, "/api/jobs/:id");
});

test("login: wrong password -> 401 with security headers, no cookie", async () => {
  const ctx = fakeContext();
  const res = await login(post("https://x.test/api/login", { password: "nope" }), ctx);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ctx.setCookies.length, 0);
});

test("login: bad JSON -> 400, GET -> 405", async () => {
  const bad = new Request("https://x.test/api/login", { method: "POST", body: "{" });
  assert.equal((await login(bad, fakeContext())).status, 400);
  const get = await login(new Request("https://x.test/api/login"), fakeContext());
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
});

test("login: right password -> 200 and HttpOnly/Secure/Strict cookie; body leaks no secret", async () => {
  const ctx = fakeContext();
  const res = await login(post("https://x.test/api/login", { password: TEST_PASSWORD }), ctx);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(process.env.SESSION_SECRET));
  assert.ok(!text.includes(process.env.CONSOLE_PASSWORD_HASH));
  const [c] = ctx.setCookies;
  assert.equal(c.name, "bd_session");
  assert.deepEqual([c.httpOnly, c.secure, c.sameSite, c.path], [true, true, "Strict", "/api"]);
});

// What the sync /api/jobs function would do before invoking the background one.
async function queueJob(id, token) {
  const s = store("jobs");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const r = await s.setJSON(id, { id, status: "queued", tokenHash, events: [] }, { onlyIfNew: true });
  assert.equal(r.modified, true);
  return s;
}

test("background job: runs once, writes status to Blobs, status endpoint reads it", async () => {
  const id = "job-12345678";
  const s = await queueJob(id, "tok-EXAMPLE");

  const ret = await jobRun(post("https://x.test/api/jobs/run", { jobId: id, token: "tok-EXAMPLE" }), fakeContext());
  assert.equal(ret, undefined, "background handlers return nothing; Netlify sends 202");

  const res = await jobStatus(new Request(`https://x.test/api/jobs/${id}`), fakeContext({ params: { id } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.status, "done");
  assert.deepEqual(body.events.map((e) => e.msg), ["planning", "drafting proposal"]);
  assert.deepEqual(body.result, { proposalId: `p-${id}` });
  assert.ok(!("tokenHash" in body));
});

test("background job: a Netlify retry (same body twice) is a no-op", async () => {
  const id = "job-retry-0001";
  const s = await queueJob(id, "tok-EXAMPLE");
  // Count successful writes that move the job to "running" (= claims).
  let claims = 0;
  const realSetJSON = s.setJSON.bind(s);
  s.setJSON = async (key, value, opts) => {
    const r = await realSetJSON(key, value, opts);
    if (r.modified && value.status === "running" && value.startedAt && !value.events?.length) claims++;
    return r;
  };
  const req = () => post("https://x.test/api/jobs/run", { jobId: id, token: "tok-EXAMPLE" });
  await Promise.all([jobRun(req(), fakeContext()), jobRun(req(), fakeContext())]);
  await jobRun(req(), fakeContext());
  const job = await s.get(id, { type: "json" });
  assert.equal(job.status, "done");
  assert.equal(claims, 1, "only one invocation may claim the job");
  assert.equal(job.events.length, 2, "work ran exactly once");
});

test("background job: wrong token never starts the job", async () => {
  const id = "job-badtoken1";
  const s = await queueJob(id, "tok-EXAMPLE");
  await jobRun(post("https://x.test/api/jobs/run", { jobId: id, token: "guess" }), fakeContext());
  assert.equal((await s.get(id, { type: "json" })).status, "queued");
});

test("status: invalid id -> 400, unknown id -> 404", async () => {
  const bad = await jobStatus(new Request("https://x.test/api/jobs/..%2f"), fakeContext({ params: { id: "../x" } }));
  assert.equal(bad.status, 400);
  const missing = await jobStatus(new Request("https://x.test/api/jobs/job-nothere1"), fakeContext({ params: { id: "job-nothere1" } }));
  assert.equal(missing.status, 404);
});
