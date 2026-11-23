// Runs the real handlers with a web Request and a fake context. No network,
// no Netlify account, no real secrets. Run: node --test test/functions.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createFakeStore, fakeContext } from "./fake-blobs.mjs";
import { setStoreFactory, store } from "../netlify/functions/lib/blobs.mjs";
import { setVerifier, InvalidToken, adaptClaimsVerifier } from "../netlify/functions/lib/guard.mjs";
import jobs, { config as jobsConfig, setTrigger } from "../netlify/functions/jobs.mjs";
import jobRun, { config as runConfig } from "../netlify/functions/job-run.mjs";
import jobStatus, { config as statusConfig } from "../netlify/functions/job-status.mjs";

// Fake tokens only. The stand-in verifier knows three of them.
const ADMIN = "Bearer admin-token-EXAMPLE";
const USER = "Bearer user-token-EXAMPLE";
const USERS = { "admin-token-EXAMPLE": { sub: "u-admin", role: "super_admin" }, "user-token-EXAMPLE": { sub: "u-user", role: "user" } };
const asHeaders = (auth) => (auth ? { authorization: auth } : {});

let stores;
let triggered;
beforeEach(() => {
  triggered = [];
  setVerifier(async (t) => { if (!USERS[t]) throw new InvalidToken(); return USERS[t]; });
  setTrigger(async (p) => { triggered.push(p); });
  stores = new Map();
  setStoreFactory((name) => {
    if (!stores.has(name)) stores.set(name, createFakeStore());
    return stores.get(name);
  });
});

const post = (url, body, auth = ADMIN) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...asHeaders(auth) }, body: JSON.stringify(body) });
const authed = (url, auth = ADMIN, init = {}) => new Request(url, { ...init, headers: { ...asHeaders(auth), ...(init.headers ?? {}) } });

test("config objects match the Beach Day routing plan", () => {
  assert.deepEqual(jobsConfig.rateLimit, { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] });
  assert.ok(jobsConfig.rateLimit.windowSize <= 180, "windowSize max is 180 s");
  assert.equal(jobsConfig.path, "/api/jobs");
  assert.equal(runConfig.background, true);
  assert.equal(runConfig.path, "/api/jobs-run"); // ADR-0006 / docs/04 §2: a sibling path, not /api/jobs/run
  assert.equal(statusConfig.path, "/api/jobs/:id");
});

test("guard: no header / garbled header -> 401 with security headers and no work done", async () => {
  for (const auth of [undefined, "Basic abc", "Bearer ", "Bearer short"]) {
    const res = await jobs(new Request("https://x.test/api/jobs", { method: "POST", headers: asHeaders(auth), body: '{"agent":"qa"}' }), fakeContext());
    assert.equal(res.status, 401, String(auth));
    assert.equal(res.headers.get("www-authenticate"), "Bearer");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }
  assert.equal(stores.size, 0, "no Blobs touched before the check passed");
  assert.equal(triggered.length, 0);
});

test("guard: unknown or expired token -> 401; valid token but role user -> 403", async () => {
  const bad = await jobs(authed("https://x.test/api/jobs", "Bearer forged-token-EXAMPLE", { method: "POST", body: '{"agent":"qa"}' }), fakeContext());
  assert.equal(bad.status, 401);
  const user = await jobs(authed("https://x.test/api/jobs", USER, { method: "POST", body: '{"agent":"qa"}' }), fakeContext());
  assert.equal(user.status, 403);
  assert.deepEqual(await user.json(), { error: "forbidden" });
  assert.equal(triggered.length, 0);
});

test("guard fails closed: verifier down -> 503 and the error text is never echoed; no verifier -> 503", async () => {
  setVerifier(async () => { throw new Error("connect ECONNREFUSED 10.0.0.1 secret-detail"); });
  const down = await jobs(authed("https://x.test/api/jobs", ADMIN, { method: "POST", body: '{"agent":"qa"}' }), fakeContext());
  assert.equal(down.status, 503);
  assert.ok(!(await down.text()).includes("secret-detail"));
  setVerifier(null);
  const none = await jobStatus(authed("https://x.test/api/jobs/job-12345678"), fakeContext({ params: { id: "job-12345678" } }));
  assert.equal(none.status, 503);
});

test("guard: a RETURNED AuthRetryableFetchError (auth-js does not throw) -> 503, not 401; a returned invalid-token error -> 401", async () => {
  const retryable = Object.assign(new Error("fetch failed ECONNRESET secret-detail"), { name: "AuthRetryableFetchError", __isAuthError: true });
  const invalid = Object.assign(new Error("invalid JWT"), { name: "AuthInvalidJwtError", __isAuthError: true });
  const run = async (res) => {
    setVerifier(adaptClaimsVerifier(async () => res, async () => "super_admin")); // returns, never throws
    return jobs(authed("https://x.test/api/jobs", ADMIN, { method: "POST", body: '{"agent":"qa"}' }), fakeContext());
  };
  const down = await run({ data: null, error: retryable });
  assert.equal(down.status, 503);
  assert.ok(!(await down.text()).includes("secret-detail"));
  assert.equal((await run({ data: null, error: invalid })).status, 401);
  const spoof = Object.assign(new Error("x"), { name: "AuthRetryableFetchError" }); // right name, no __isAuthError marker
  assert.equal((await run({ data: null, error: spoof })).status, 401, "the name alone is not enough");
  assert.equal((await run({ data: { claims: { sub: "u-admin" } }, error: null })).status, 202, "a good result still works");
});

test("jobs: super_admin -> 202, job stored as queued with only a token HASH, worker triggered once", async () => {
  const res = await jobs(authed("https://x.test/api/jobs", ADMIN, { method: "POST", body: '{"agent":"qa-engineer"}' }), fakeContext());
  assert.equal(res.status, 202);
  const { id } = await res.json();
  const job = await store("jobs").get(id, { type: "json" });
  assert.deepEqual([job.status, job.owner, job.agent], ["queued", "u-admin", "qa-engineer"]);
  assert.equal(triggered.length, 1);
  assert.equal(job.tokenHash, createHash("sha256").update(triggered[0].token).digest("hex"));
  assert.ok(!JSON.stringify(job).includes(triggered[0].token), "raw token is not stored");
});

test("jobs: bad shape -> 400, oversize -> 413, GET -> 405 (all after the auth check)", async () => {
  const mk = (body, method = "POST") => authed("https://x.test/api/jobs", ADMIN, { method, body: method === "GET" ? undefined : body });
  assert.equal((await jobs(mk("{"), fakeContext())).status, 400);
  assert.equal((await jobs(mk('{"agent":"../x"}'), fakeContext())).status, 400);
  assert.equal((await jobs(mk("x".repeat(65 * 1024)), fakeContext())).status, 413);
  const get = await jobs(mk(null, "GET"), fakeContext());
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
});

// What the sync /api/jobs function would do before invoking the background one.
async function queueJob(id, token) {
  const s = store("jobs");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const r = await s.setJSON(id, { id, status: "queued", owner: "u-admin", tokenHash, events: [] }, { onlyIfNew: true });
  assert.equal(r.modified, true);
  return s;
}

test("background job: runs once, writes status to Blobs, status endpoint reads it", async () => {
  const id = "job-12345678";
  const s = await queueJob(id, "tok-EXAMPLE");

  const ret = await jobRun(post("https://x.test/api/jobs-run", { jobId: id, token: "tok-EXAMPLE" }), fakeContext());
  assert.equal(ret, undefined, "background handlers return nothing; Netlify sends 202");

  const res = await jobStatus(authed(`https://x.test/api/jobs/${id}`), fakeContext({ params: { id } }));
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
  const req = () => post("https://x.test/api/jobs-run", { jobId: id, token: "tok-EXAMPLE" });
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
  await jobRun(post("https://x.test/api/jobs-run", { jobId: id, token: "guess" }), fakeContext());
  assert.equal((await s.get(id, { type: "json" })).status, "queued");
});

test("background job: the worker runs the guard too (no/forged token, role user, verifier down, no verifier -> nothing runs, nothing is written)", async () => {
  const id = "job-guardrun1";
  const s = await queueJob(id, "tok-EXAMPLE");
  const writes = [];
  const realSetJSON = s.setJSON.bind(s);
  s.setJSON = async (...a) => { writes.push(a[0]); return realSetJSON(...a); };
  const body = { jobId: id, token: "tok-EXAMPLE" }; // the one-time token is RIGHT in every case below
  for (const auth of [null, "Bearer forged-token-EXAMPLE", USER]) {
    assert.equal(await jobRun(post("https://x.test/api/jobs-run", body, auth), fakeContext()), undefined);
  }
  setVerifier(async () => { throw new Error("upstream down"); });
  await jobRun(post("https://x.test/api/jobs-run", body), fakeContext());
  setVerifier(null);
  await jobRun(post("https://x.test/api/jobs-run", body), fakeContext());
  assert.deepEqual(writes, [], "no write at all when the guard refuses");
  assert.equal((await s.get(id, { type: "json" })).status, "queued");
  // control: with the right bearer the same body does run
  setVerifier(async (t) => USERS[t]);
  await jobRun(post("https://x.test/api/jobs-run", body), fakeContext());
  assert.equal((await s.get(id, { type: "json" })).status, "done");
});

test("background job: an admin who does not own the job cannot start it", async () => {
  const id = "job-notowner1";
  const s = await queueJob(id, "tok-EXAMPLE");
  setVerifier(async () => ({ sub: "u-other-admin", role: "super_admin" }));
  await jobRun(post("https://x.test/api/jobs-run", { jobId: id, token: "tok-EXAMPLE" }), fakeContext());
  assert.equal((await s.get(id, { type: "json" })).status, "queued");
});

test("jobs: the caller's Authorization header is forwarded to the worker trigger", async () => {
  await jobs(authed("https://x.test/api/jobs", ADMIN, { method: "POST", body: '{"agent":"qa"}' }), fakeContext());
  assert.equal(triggered[0].authorization, ADMIN);
});

test("status: no token -> 401, role user -> 403, invalid id -> 400, unknown id -> 404", async () => {
  const id = "job-nothere1";
  assert.equal((await jobStatus(authed(`https://x.test/api/jobs/${id}`, null), fakeContext({ params: { id } }))).status, 401);
  assert.equal((await jobStatus(authed(`https://x.test/api/jobs/${id}`, USER), fakeContext({ params: { id } }))).status, 403);
  const bad = await jobStatus(authed("https://x.test/api/jobs/..%2f"), fakeContext({ params: { id: "../x" } }));
  assert.equal(bad.status, 400);
  const missing = await jobStatus(authed(`https://x.test/api/jobs/${id}`), fakeContext({ params: { id } }));
  assert.equal(missing.status, 404);
});
