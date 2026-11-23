// The eight /api/* handlers, run for real in-process through the harness (support.mjs).
// Covers: the order of checks (guard, Origin, production, body), each handler's contract shape (tests/contracts),
// chat streaming + tools + proposal + hand-off, jobs/job-run/job-status (nonce, owner, R13 Continue),
// proposal GET (diffs, deploys, approvals, reconciler), approve (D10, step-up, hash, cap, commit, stale,
// unknown outcome, double approve) and reject. Tess's matrix.test.mjs owns the full auth matrix.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setup, sse, schemaErrors, secHeadersOk, ADMIN, USER } from "./support.mjs";
import { turns } from "../../helpers/msw-upstreams.mjs";
import { localDay } from "../../../netlify/functions/lib/limits.mts";
import { createGitHubWrite } from "../../../netlify/functions/lib/github-write.mts";
import { sha256hex } from "../../../netlify/functions/lib/jobs.mts";

let t, h;
beforeAll(async () => { t = await setup(); h = t.h; });
afterAll(async () => { await t?.close(); });
beforeEach(async () => { await t.reset(); });

const SUMMARY = "Clarify the docs README so new readers know where the specs are";
const setSettings = (o) => { h.state.settingsOverrides = { ...o }; h.state.moduleCache.clear(); };
const sub = (email = ADMIN) => h.supabase.getUser(email).id;
const store = (name) => h.blobs.getStore(name);

async function chat(token, messages = [{ role: "user", content: "Hi" }], agent = "agent-console-engineer") {
  return t.call("POST /api/chat", t.req("POST", "/api/chat", { token, body: { agent, messages } }));
}

/** A chat turn that reads docs/README.md and proposes a change; returns the proposal id. */
async function propose(token, files = [{ path: "docs/README.md", content: "# Docs\n\nStart with docs/README.md.\n" }], summary = SUMMARY) {
  h.anthropic.script(turns.readFile(files[0].path), turns.proposeChange({ summary, files }), turns.text("I proposed it."));
  const evs = await sse(await chat(token, [{ role: "user", content: "Please improve the docs" }]));
  const p = evs.find((e) => e.type === "proposal");
  if (!p) throw new Error("no proposal: " + JSON.stringify(evs));
  return p.proposalId;
}

async function view(token, id) {
  const res = await t.call("GET /api/proposals/:id", t.req("GET", `/api/proposals/${id}`, { token }));
  return { res, body: await res.json() };
}
const approveReq = (token, id, contentHash) => t.call("POST /api/proposals/:id/approve", t.req("POST", `/api/proposals/${id}/approve`, { token, body: { contentHash } }));

// ------------------------------------------------------------------------------------------------
describe("order of checks on every handler", () => {
  const routes = [
    ["GET /api/agents", "GET", "/api/agents"],
    ["POST /api/chat", "POST", "/api/chat"],
    ["POST /api/jobs", "POST", "/api/jobs"],
    ["POST /api/jobs-run", "POST", "/api/jobs-run"],
    ["GET /api/jobs/:id", "GET", "/api/jobs/j_01JABCDEFGHJKMNPQRSTVWXYZ0"],
    ["GET /api/proposals/:id", "GET", "/api/proposals/p_01JABCDEFGHJKMNPQRSTVWXYZ0"],
    ["POST /api/proposals/:id/approve", "POST", "/api/proposals/p_01JABCDEFGHJKMNPQRSTVWXYZ0/approve"],
    ["POST /api/proposals/:id/reject", "POST", "/api/proposals/p_01JABCDEFGHJKMNPQRSTVWXYZ0/reject"],
  ];
  const body = { agent: "agent-console-engineer", messages: [{ role: "user", content: "hi" }] };

  it.each(routes)("%s: no token -> 401 (job-run: silent 202), headers safe, no store/upstream touched", async (key, method, path) => {
    h.blobs.resetCalls();
    const res = await t.call(key, t.req(method, path, method === "POST" ? { body } : {}));
    expect(res.status).toBe(key === "POST /api/jobs-run" ? 202 : 401);
    expect(secHeadersOk(res)).toBe(true);
    if (res.status === 401) expect((await res.json()).error.code).toBe("unauthorized");
    expect(h.blobs.callCount).toBe(0);
    expect(h.anthropic.requests).toHaveLength(0);
    expect(h.github.calls).toHaveLength(0);
  });

  it.each(routes)("%s: role user -> 403 forbidden (job-run: silent), nothing touched", async (key, method, path) => {
    const token = await t.token(USER);
    h.blobs.resetCalls();
    const res = await t.call(key, t.req(method, path, { token, ...(method === "POST" ? { body } : {}) }));
    expect(res.status).toBe(key === "POST /api/jobs-run" ? 202 : 403);
    expect(h.blobs.callCount).toBe(0);
  });

  it.each(routes)("%s: Supabase down -> 503 unavailable (never 403)", async (key, method, path) => {
    const token = await t.token();
    h.supabase.fail("rest", "status");
    const res = await t.call(key, t.req(method, path, { token, ...(method === "POST" ? { body } : {}) }));
    expect(res.status).toBe(key === "POST /api/jobs-run" ? 202 : 503);
    h.supabase.clearFailures();
  });

  it.each(routes.filter((r) => r[1] === "POST"))("%s: cross-site POST -> 403 before any work", async (key, method, path) => {
    const token = await t.token();
    h.blobs.resetCalls();
    const res = await t.call(key, t.req(method, path, { token, body, headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(key === "POST /api/jobs-run" ? 202 : 403);
    expect(h.blobs.callCount).toBe(0);
  });

  it.each(routes.filter((r) => r[0] !== "POST /api/jobs-run"))("%s: wrong method -> 405 with allow", async (key, method, path) => {
    const res = await t.call(key, t.req(method === "GET" ? "DELETE" : "GET", path));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe(method);
  });

  it.each([["POST /api/chat", "/api/chat"], ["GET /api/proposals/:id", "/api/proposals/p_01JABCDEFGHJKMNPQRSTVWXYZ0"], ["POST /api/proposals/:id/approve", "/api/proposals/p_01JABCDEFGHJKMNPQRSTVWXYZ0/approve"]])(
    "%s: outside production -> 503 before any secret, Claude or GitHub call", async (key, path) => {
      const token = await t.token();
      const method = key.split(" ")[0];
      h.blobs.resetCalls();
      const res = await t.call(key, t.req(method, path, { token, ...(method === "POST" ? { body: key.includes("approve") ? { contentHash: "sha256:" + "0".repeat(64) } : body } : {}) }), { deployContext: "deploy-preview" });
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("unavailable");
      expect(h.blobs.callCount).toBe(0);
      expect(h.anthropic.requests).toHaveLength(0);
      expect(h.github.calls).toHaveLength(0);
    });
});

// ------------------------------------------------------------------------------------------------
describe("GET /api/agents", () => {
  it("returns {agents} matching agents-response, with no systemPrompt", async () => {
    const res = await t.call("GET /api/agents", t.req("GET", "/api/agents", { token: await t.token() }));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(schemaErrors("agents-response", b)).toEqual([]);
    expect(b.agents.length).toBe(12);
    expect(JSON.stringify(b)).not.toContain("systemPrompt");
  });
});

// ------------------------------------------------------------------------------------------------
describe("POST /api/chat", () => {
  it("streams text then done; every event matches sse-event; request is a valid Claude call", async () => {
    h.anthropic.script(turns.text(["Hollywood ", "Beach."]));
    const res = await chat(await t.token());
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(secHeadersOk(res)).toBe(true);
    const evs = await sse(res);
    for (const e of evs) expect(schemaErrors("sse-event", e)).toEqual([]);
    expect(evs.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Hollywood Beach.");
    expect(evs.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
    const body = h.anthropic.requests[0].body;
    expect(h.anthropic.requests[0].error).toBeFalsy();
    expect(body).toMatchObject({ model: "claude-opus-5-5", thinking: { type: "adaptive" }, output_config: { effort: "low" }, tool_choice: { type: "auto" }, stream: true });
    expect(body.tools.every((x) => x.strict === true)).toBe(true);
  });

  it("refusal: one error{refusal, retryable:false}, no done", async () => {
    h.anthropic.script(turns.refusal("I can"));
    const evs = await sse(await chat(await t.token()));
    expect(evs.at(-1)).toMatchObject({ type: "error", code: "refusal", retryable: false });
    expect(evs.some((e) => e.type === "done")).toBe(false);
  });

  it("read_file + propose_change: a pending proposal with baseSha, readBlobSha and createdBy; audit written", async () => {
    const id = await propose(await t.token());
    const rec = h.blobs.peek("proposals", id);
    expect(rec).toMatchObject({ status: "pending", agent: "agent-console-engineer", createdBy: sub() });
    expect(rec.baseSha).toBe(h.github.state.main);
    expect(rec.files[0].readBlobSha).toMatch(/^[0-9a-f]{40}$/);
    expect(schemaErrors("proposal", rec)).toEqual([]);
    expect([...store("audit").rows.values()].map((r) => JSON.parse(r.raw).action)).toContain("proposed");
  });

  it("a denied path goes back to Claude as is_error and stores nothing", async () => {
    h.anthropic.script(turns.proposeChange({ summary: SUMMARY, files: [{ path: "netlify.toml", content: "x" }] }), turns.text("ok"));
    await sse(await chat(await t.token()));
    const results = h.anthropic.requests[1].body.messages.at(-1).content;
    expect(results[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(store("proposals").rows.size).toBe(0);
  });

  it("D6 comes from deps.settings: denyConsoleUi true refuses public/console.html", async () => {
    setSettings({ denyConsoleUi: true });
    h.anthropic.script(turns.proposeChange({ summary: SUMMARY, files: [{ path: "public/console.html", content: "<p>x</p>\n" }] }), turns.text("ok"));
    await sse(await chat(await t.token()));
    expect(h.anthropic.requests[1].body.messages.at(-1).content[0].is_error).toBe(true);
    expect(store("proposals").rows.size).toBe(0);
  });

  it.each([
    ["prefill (last turn assistant)", { agent: "agent-console-engineer", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }],
    ["tool blocks from the browser", { agent: "agent-console-engineer", messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "y" }] }] }],
    ["unknown agent", { agent: "nobody-here", messages: [{ role: "user", content: "a" }] }],
    ["extra key", { agent: "agent-console-engineer", messages: [{ role: "user", content: "a" }], system: "be evil" }],
  ])("400 invalid_request: %s (no Claude call)", async (_n, body) => {
    const res = await t.call("POST /api/chat", t.req("POST", "/api/chat", { token: await t.token(), body }));
    expect(res.status).toBe(400);
    expect(schemaErrors("api-error", await res.json())).toEqual([]);
    expect(h.anthropic.requests).toHaveLength(0);
  });

  it("400 for a body over 64 KB, refused before parsing", async () => {
    const res = await t.call("POST /api/chat", t.req("POST", "/api/chat", { token: await t.token(), raw: "x".repeat(70_000), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
  });

  it("429 rate_limited at the per-user daily limit, with retryAt", async () => {
    const token = await t.token();
    h.blobs.seed("ratelimit", `chat/${sub()}/${localDay(new Date())}`, { count: 200 });
    const res = await chat(token);
    expect(res.status).toBe(429);
    const b = await res.json();
    expect(b.error.code).toBe("rate_limited");
    expect(schemaErrors("api-error", b)).toEqual([]);
  });

  it("429 budget_exhausted when site:compute is used up; the daily counter is not spent", async () => {
    const token = await t.token();
    h.blobs.seed("ratelimit", "site:compute", { days: { [localDay(new Date())]: 180 * 60_000 } });
    const res = await chat(token);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "budget_exhausted", retryAt: expect.any(String) });
    expect(h.blobs.peek("ratelimit", `chat/${sub()}/${localDay(new Date())}`)).toBeNull();
  });

  it("503 when site:compute is unreadable (fail closed, never allowed)", async () => {
    const token = await t.token();
    h.blobs.seed("ratelimit", "site:compute", { days: "garbage" });
    expect((await chat(token)).status).toBe(503);
  });

  it("records the turn's wall time in site:compute", async () => {
    h.anthropic.script(turns.text("hi"));
    await sse(await chat(await t.token()));
    expect(h.blobs.peek("ratelimit", "site:compute").days[localDay(new Date())]).toBeGreaterThanOrEqual(0);
  });

  it("out of time: handoff{jobId} then done{handoff}; the job runs in the background to done", async () => {
    setSettings({ chatDeadlineMs: 10_000 }); // < 15 s left: no round may start, so the turn hands off at once
    h.anthropic.script(turns.text("Finished in the background."));
    const token = await t.token();
    const evs = await sse(await chat(token));
    expect(evs.at(-2)).toMatchObject({ type: "handoff", jobId: expect.stringMatching(/^j_/) });
    expect(evs.at(-1)).toEqual({ type: "done", stopReason: "handoff" });
    await t.settled();
    const jobId = evs.at(-2).jobId;
    const res = await t.call("GET /api/jobs/:id", t.req("GET", `/api/jobs/${jobId}`, { token }));
    const job = await res.json();
    expect(schemaErrors("job-view", job)).toEqual([]);
    expect(job.status).toBe("done");
    expect(job.events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
    expect(h.anthropic.requests.at(-1).body.output_config).toEqual({ effort: "high" });
  });
});

// ------------------------------------------------------------------------------------------------
describe("jobs, job-run, job-status", () => {
  const startJob = async (token, body = { agent: "agent-console-engineer", messages: [{ role: "user", content: "Read the docs" }] }) =>
    t.call("POST /api/jobs", t.req("POST", "/api/jobs", { token, body }));

  it("202 {jobId}; job-run proposes in the background; the job view is owner-only and leaks no state", async () => {
    h.anthropic.script(turns.proposeChange({ summary: SUMMARY, files: [{ path: "docs/README.md", content: "# Docs v2\n" }] }), turns.text("Done."));
    const token = await t.token();
    const res = await startJob(token);
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    await t.settled();
    const rec = h.blobs.peek("jobs", jobId);
    expect(rec.nonceHash).toBeNull(); // single-use: cleared at the claim
    const v = await (await t.call("GET /api/jobs/:id", t.req("GET", `/api/jobs/${jobId}`, { token }))).json();
    expect(schemaErrors("job-view", v)).toEqual([]);
    expect(v).toMatchObject({ status: "done", proposalId: expect.stringMatching(/^p_/) });
    expect(Object.keys(v)).not.toContain("messages");

    h.supabase.setRole(USER, "super_admin"); // another admin still can't see it: 404, not 403
    const other = await t.call("GET /api/jobs/:id", t.req("GET", `/api/jobs/${jobId}`, { token: await t.token(USER) }));
    expect(other.status).toBe(404);
  });

  it("job-run is single-use and owner-bound: a replayed or wrong nonce writes nothing", async () => {
    const token = await t.token();
    // a queued job with a known nonce, made directly
    const nonce = "A".repeat(43);
    const id = "j_01JAAAAAAAAAAAAAAAAAAAAAAA";
    const rec = { id, owner: sub(), agent: "agent-console-engineer", status: "queued", nonceHash: sha256hex(nonce), messages: [{ role: "user", content: "x" }], baseSha: null, readShas: {}, usage: { tokens: 0, rounds: 0 }, events: [], proposalId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    h.blobs.seed("jobs", id, rec);
    const run = (n, tok = token) => t.call("POST /api/jobs-run", t.req("POST", "/api/jobs-run", { token: tok, body: { jobId: id, nonce: n } }));

    expect((await run("B".repeat(43))).status).toBe(202);
    expect(h.blobs.peek("jobs", id).status).toBe("queued");           // wrong nonce: untouched
    h.supabase.setRole(USER, "super_admin");
    await run(nonce, await t.token(USER));
    expect(h.blobs.peek("jobs", id).status).toBe("queued");           // another user: untouched
    h.anthropic.script(turns.text("ok"));
    await run(nonce);
    expect(h.blobs.peek("jobs", id).status).toBe("done");
    const before = JSON.stringify(h.blobs.peek("jobs", id));
    await run(nonce);                                                   // Netlify retry / replay
    expect(JSON.stringify(h.blobs.peek("jobs", id))).toBe(before);
    expect(h.anthropic.requests).toHaveLength(1);
  });

  it("a refused job ends failed with error{refusal}", async () => {
    h.anthropic.script(turns.refusal());
    const token = await t.token();
    const { jobId } = await (await startJob(token)).json();
    await t.settled();
    const v = await (await t.call("GET /api/jobs/:id", t.req("GET", `/api/jobs/${jobId}`, { token }))).json();
    expect(v.status).toBe("failed");
    expect(v.events.at(-1)).toMatchObject({ type: "error", code: "refusal", retryable: false });
    expect(schemaErrors("job-view", v)).toEqual([]);
  });

  it("job limits: 429 rate_limited at 20 jobs a day", async () => {
    const token = await t.token();
    h.blobs.seed("ratelimit", `jobs/${sub()}/${localDay(new Date())}`, { count: 20 });
    const res = await startJob(token);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
  });

  describe("Continue (R13)", () => {
    const paused = (over = {}) => ({ id: "j_01JBBBBBBBBBBBBBBBBBBBBBBB", owner: sub(), agent: "agent-console-engineer", status: "paused", nonceHash: null, messages: [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: "partial" }] }], baseSha: "a".repeat(40), readShas: { "docs/README.md": "b".repeat(40) }, usage: { tokens: 5, rounds: 15 }, events: [], proposalId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over });
    const cont = async (token, continueFrom) => t.call("POST /api/jobs", t.req("POST", "/api/jobs", { token, body: { continueFrom } }));

    it("bad id -> 400 before any Blobs read", async () => {
      const token = await t.token();
      h.blobs.resetCalls();
      expect((await cont(token, "j_bad")).status).toBe(400);
      expect(h.blobs.callCount).toBe(0);
    });
    it("another owner's job -> 404; not paused -> 409", async () => {
      const token = await t.token();
      h.blobs.seed("jobs", paused().id, paused({ owner: "someone-else" }));
      expect((await cont(token, paused().id)).status).toBe(404);
      h.blobs.seed("jobs", paused().id, paused({ status: "done" }));
      expect((await cont(token, paused().id)).status).toBe(409);
    });
    it("a paused job continues ONCE as a new job with the server-stored conversation, baseSha and readShas", async () => {
      const token = await t.token();
      h.blobs.seed("jobs", paused().id, paused());
      h.anthropic.script(turns.text("continued"));
      const res = await cont(token, paused().id);
      expect(res.status).toBe(202);
      const { jobId } = await res.json();
      expect(jobId).not.toBe(paused().id);
      const job = h.blobs.peek("jobs", jobId);
      expect(job).toMatchObject({ baseSha: "a".repeat(40), readShas: { "docs/README.md": "b".repeat(40) }, usage: { tokens: 0, rounds: 0 } });
      expect(job.messages.at(-1).role).toBe("user"); // never a prefill
      expect(h.blobs.peek("jobs", paused().id).continuedBy).toBe(jobId);
      expect((await cont(token, paused().id)).status).toBe(409); // second click
      await t.settled();
    });
  });
});

// ------------------------------------------------------------------------------------------------
describe("GET /api/proposals/:id", () => {
  it("returns {proposal, diffs, deploys, approveEnabled, approvals} matching proposal-view", async () => {
    const token = await t.token();
    const id = await propose(token);
    const { res, body } = await view(token, id);
    expect(res.status).toBe(200);
    expect(schemaErrors("proposal-view", body)).toEqual([]);
    expect(body.deploys).toBe(false); // docs/** never deploys
    expect(body.approvals).toEqual({ used31: 0, usedToday: 0, per31Days: 14, perDay: 5, retryAt: null });
    expect(body.diffs[0].diff).toContain("+Start with docs/README.md.");
    expect(body.diffs[0].diff).toMatch(/^--- a\/docs\/README\.md\n\+\+\+ b\/docs\/README\.md/);
  });

  it("approveEnabled mirrors deps.settings (D10)", async () => {
    const token = await t.token();
    const id = await propose(token);
    setSettings({ approveEnabled: false });
    expect((await view(token, id)).body.approveEnabled).toBe(false);
  });

  it("400 for a bad id before Blobs; 404 for a missing one; approvals null when site:approvals is unreadable", async () => {
    const token = await t.token();
    h.blobs.resetCalls();
    expect((await t.call("GET /api/proposals/:id", t.req("GET", "/api/proposals/p_nope", { token }))).status).toBe(400);
    expect(h.blobs.callCount).toBe(0);
    expect((await view(token, "p_01JZZZZZZZZZZZZZZZZZZZZZZZ")).res.status).toBe(404);
    const id = await propose(token);
    h.blobs.seed("ratelimit", "site:approvals", { times: "bad" });
    expect((await view(token, id)).body.approvals).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
describe("POST /api/proposals/:id/approve", () => {
  /** Record every GitHub request body the write module sends (the fake still answers). */
  function recordWrites() {
    const sent = [];
    h.registerDeps("approve", (bag) => ({
      ...bag,
      getWriter: (o = {}) => createGitHubWrite({
        ...o,
        token: process.env.GITHUB_TOKEN,
        fetchImpl: async (url, init) => { sent.push({ method: init.method, path: new URL(url).pathname, body: init.body ? JSON.parse(init.body) : null }); return fetch(url, init); },
      }),
    }));
    return sent;
  }

  it("commits ONE atomic commit: base_tree, 100644 content blobs, one parent, force:false, server-built trailer; counted", async () => {
    const sent = recordWrites();
    const token = await t.token();
    const id = await propose(token, [{ path: "public/js/score-config.js", content: "export const SCORE_CONFIG = { v: 2 };\n" }, { path: "docs/README.md", content: "# Docs\n\nNew.\n" }]);
    const { body: v } = await view(token, id);
    const before = h.github.state.main;
    const res = await approveReq(token, id, v.proposal.contentHash);
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(schemaErrors("approve-result", b)).toEqual([]);
    expect(b).toMatchObject({ proposal: { id, status: "committed" }, deploys: true, approvals: { used31: 1, usedToday: 1 } });

    const tree = sent.find((s) => s.method === "POST" && s.path.endsWith("/git/trees")).body;
    expect(tree.base_tree).toMatch(/^[0-9a-f]{40}$/);
    expect(tree.tree.every((e) => e.mode === "100644" && e.type === "blob" && typeof e.content === "string" && !("sha" in e))).toBe(true);
    const commit = sent.find((s) => s.method === "POST" && s.path.endsWith("/git/commits")).body;
    expect(commit.parents).toEqual([before]);
    expect(commit.message.split("\n").at(-1)).toBe(`Beach-Day-Proposal: ${id}`);
    expect(commit.author.name).toBe("Beach Day Agent (agent-console-engineer)");
    expect(sent.find((s) => s.method === "PATCH").body).toEqual({ sha: b.proposal.commitSha, force: false });
    expect(h.github.state.violations).toEqual([]);
    expect(h.github.state.main).toBe(b.proposal.commitSha);
    expect(h.github.state.fileText("public/index.html")).not.toBeNull(); // base_tree kept every other file

    const rec = h.blobs.peek("proposals", id);
    expect(rec).toMatchObject({ status: "committed", commitSha: b.proposal.commitSha, decidedBy: sub() });
    expect(h.blobs.peek("ratelimit", "site:approvals").times).toHaveLength(1);
  });

  it("D10 off (the shipped default): 503 and nothing else runs", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    setSettings({ approveEnabled: false });
    h.github.calls.length = 0;
    const res = await approveReq(token, id, hash);
    expect(res.status).toBe(503);
    expect(h.github.calls).toHaveLength(0);
    expect(h.blobs.peek("proposals", id).status).toBe("pending");
  });

  it("step-up: a sign-in older than 600 s -> 401 step_up_required, proposal stays pending, audit written", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    h.supabase.ageSignIn(ADMIN, 601); // last_sign_in_at 601 s old (rule 3); the token itself stays valid
    const res = await approveReq(token, id, hash);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("step_up_required");
    expect(h.blobs.peek("proposals", id).status).toBe("pending");
    expect([...store("audit").rows.values()].map((r) => JSON.parse(r.raw).action)).toContain("step_up_failed");
  });

  it.each([
    ["password amr 601 s old (rule 2)", (now) => ({ amr: [{ method: "password", timestamp: now - 601 }] })],
    ["only token_refresh is fresh", (now) => ({ amr: [{ method: "token_refresh", timestamp: now }, { method: "password", timestamp: now - 900 }] })],
    ["fresh totp alone", (now) => ({ amr: [{ method: "totp", timestamp: now }, { method: "password", timestamp: now - 900 }] })],
  ])("step-up: %s -> 401 step_up_required", async (_n, over) => {
    const id = await propose(await t.token());
    const hash = h.blobs.peek("proposals", id).contentHash;
    const stale = await h.supabase.mint(ADMIN, over(Math.floor(Date.now() / 1000)));
    const res = await approveReq(stale, id, hash);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("step_up_required");
    expect(h.blobs.peek("proposals", id).status).toBe("pending");
  });

  it("a moved deps.now past the token's life is caught by the guard as 401 unauthorized, not allowed", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    h.state.clockOffsetMs += 601_000;
    expect((await approveReq(token, id, hash)).status).toBe(401);
    expect(h.blobs.peek("proposals", id).status).toBe("pending");
  });

  it("getUser outage (returned retryable error) -> 503, not 401", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    h.supabase.fail("user", "status");
    const res = await approveReq(token, id, hash);
    expect(res.status).toBe(503);
    h.supabase.clearFailures();
  });

  it.each([["sha256:" + "A".repeat(64)], ["0".repeat(64)], [123]])("contentHash %s has a bad shape -> 400", async (hash) => {
    const token = await t.token();
    const id = await propose(token);
    expect((await approveReq(token, id, hash)).status).toBe(400);
  });

  it("hash mismatch -> 409 conflict, still pending, no GitHub write", async () => {
    const token = await t.token();
    const id = await propose(token);
    h.github.calls.length = 0;
    const res = await approveReq(token, id, "sha256:" + "0".repeat(64));
    expect(res.status).toBe(409);
    expect(h.blobs.peek("proposals", id).status).toBe("pending");
    expect(h.github.calls.some((c) => !c.startsWith("GET"))).toBe(false);
  });

  it("double approve in parallel -> exactly one 200 and one 409; one commit, one slot", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    const commitsBefore = h.github.state.commitCount;
    const [a, b] = await Promise.all([approveReq(token, id, hash), approveReq(token, id, hash)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(h.github.state.commitCount).toBe(commitsBefore + 1);
    expect(h.blobs.peek("ratelimit", "site:approvals").times).toHaveLength(1);
  });

  it("cap: the 6th approval in a New York day -> 429 approve_cap with approvals; stays pending", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    const now = Date.now();
    h.blobs.seed("ratelimit", "site:approvals", { times: [1, 2, 3, 4, 5].map((i) => new Date(now - i * 1000).toISOString()) });
    const res = await approveReq(token, id, hash);
    const b = await res.json();
    expect(res.status).toBe(429);
    expect(schemaErrors("api-error", b)).toEqual([]);
    expect(b.approvals).toMatchObject({ usedToday: 5, perDay: 5, retryAt: expect.any(String) });
    expect(h.blobs.peek("proposals", id).status).toBe("pending");
  });

  it("main moved under a file the agent read -> 409 stale, proposal stale, no slot used", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    h.github.state.pushConcurrent("docs/README.md", "# Someone else\n");
    const res = await approveReq(token, id, hash);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("stale");
    const rec = h.blobs.peek("proposals", id);
    expect(rec.status).toBe("stale");
    expect(schemaErrors("proposal", rec)).toEqual([]);
    expect(h.blobs.peek("ratelimit", "site:approvals")).toBeNull();
  });

  it("ref update outcome unknown (502) but main moved -> re-read finds our commit -> committed and counted", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    h.github.state.patchAppliesThen("502");
    const res = await approveReq(token, id, hash);
    expect(res.status).toBe(200);
    expect(h.blobs.peek("proposals", id).status).toBe("committed");
    expect(h.blobs.peek("ratelimit", "site:approvals").times).toHaveLength(1);
  });

  it("a definite failure before main moved -> 502 upstream, proposal failed, no slot", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    h.github.state.failNext(/\/git\/trees$/, 403);
    const res = await approveReq(token, id, hash);
    expect(res.status).toBe(502);
    expect(h.blobs.peek("proposals", id).status).toBe("failed");
    expect(h.blobs.peek("ratelimit", "site:approvals")).toBeNull();
  });

  it("re-validates policy at approve time: a proposal on a path denied since (D6) fails, no commit", async () => {
    const token = await t.token();
    const id = await propose(token, [{ path: "public/console.html", content: "<p>console</p>\n" }]);
    const hash = h.blobs.peek("proposals", id).contentHash;
    setSettings({ denyConsoleUi: true });
    const commitsBefore = h.github.state.commitCount;
    const res = await approveReq(token, id, hash);
    expect(res.status).toBe(409);
    expect(h.blobs.peek("proposals", id).status).toBe("failed");
    expect(h.github.state.commitCount).toBe(commitsBefore);
  });

  it("reconciler: a stuck committing record whose commit is on main is recorded, then marked committed (on GET)", async () => {
    const token = await t.token();
    const id = await propose(token);
    const hash = h.blobs.peek("proposals", id).contentHash;
    expect((await approveReq(token, id, hash)).status).toBe(200);
    // Simulate "PATCH landed, recording never ran": back to committing, decidedAt 3 min ago, no slot recorded.
    const rec = h.blobs.peek("proposals", id);
    const { commitSha, ...rest } = rec;
    h.blobs.seed("proposals", id, { ...rest, status: "committing", decidedAt: new Date(Date.now() - 180_000).toISOString() });
    h.blobs.seed("ratelimit", "site:approvals", { times: [] });
    const { body } = await view(token, id);
    expect(body.proposal).toMatchObject({ status: "committed", commitSha });
    expect(h.blobs.peek("ratelimit", "site:approvals").times).toHaveLength(1);
  });

  it("reconciler: GitHub unreachable leaves it committing and records nothing", async () => {
    const token = await t.token();
    const id = await propose(token);
    const rec = h.blobs.peek("proposals", id);
    h.blobs.seed("proposals", id, { ...rec, status: "committing", decidedAt: new Date(Date.now() - 180_000).toISOString() });
    h.github.state.setReadDown(true);
    const { res, body } = await view(token, id);
    expect(res.status).toBe(200);
    expect(body.proposal.status).toBe("committing");
    expect(h.blobs.peek("ratelimit", "site:approvals")).toBeNull();
    h.github.state.setReadDown(false);
  });

  it("reconciler: a short page with no matching commit -> failed, no slot", async () => {
    const token = await t.token();
    const id = await propose(token);
    const rec = h.blobs.peek("proposals", id);
    h.blobs.seed("proposals", id, { ...rec, status: "committing", decidedAt: new Date(Date.now() - 180_000).toISOString() });
    const { body } = await view(token, id);
    expect(body.proposal.status).toBe("failed");
    expect(schemaErrors("proposal", body.proposal)).toEqual([]);
    expect(h.blobs.peek("ratelimit", "site:approvals")).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
describe("POST /api/proposals/:id/reject", () => {
  const reject = (token, id, body) => t.call("POST /api/proposals/:id/reject", t.req("POST", `/api/proposals/${id}/reject`, { token, ...(body === undefined ? {} : { body }) }));

  it("pending -> rejected (empty body ok); a second reject is 409; approve after reject is 409", async () => {
    const token = await t.token();
    const id = await propose(token);
    const res = await reject(token, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ proposal: { id, status: "rejected" } });
    expect(schemaErrors("proposal", h.blobs.peek("proposals", id))).toEqual([]);
    expect((await reject(token, id, {})).status).toBe(409);
    expect((await approveReq(token, id, h.blobs.peek("proposals", id).contentHash)).status).toBe(409);
  });

  it("reason over 500 chars or an unknown key -> 400", async () => {
    const token = await t.token();
    const id = await propose(token);
    expect((await reject(token, id, { reason: "x".repeat(501) })).status).toBe(400);
    expect((await reject(token, id, { why: "x" })).status).toBe(400);
    expect((await reject(token, id, { reason: "Not now" })).status).toBe(200);
    expect(h.blobs.peek("proposals", id).rejectReason).toBe("Not now");
  });
});

// ------------------------------------------------------------------------------------------------
describe("import graph", () => {
  it("only approve.mts imports github-write", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["agents", "chat", "jobs", "job-run", "job-status", "proposal", "reject"]) {
      expect(readFileSync(new URL(`../../../netlify/functions/${f}.mts`, import.meta.url), "utf8")).not.toMatch(/from\s+["'][^"']*github-write/);
    }
    expect(readFileSync(new URL("../../../netlify/functions/approve.mts", import.meta.url), "utf8")).toMatch(/github-write/);
  });
});
