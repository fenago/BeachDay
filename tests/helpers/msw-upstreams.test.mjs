import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createUpstreams, createFakeAnthropic, createFakeGithub, turns, DEFAULT_SEED, agentOfRequest } from "./msw-upstreams.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { fakeAnthropicKey, fakeGithubToken } from "./secrets.mjs";
import { parseSse } from "./sse.mjs";
import { createHash } from "node:crypto";

const WT = fakeGithubToken("write"), RT = fakeGithubToken("read");
const KEY = fakeAnthropicKey();
let up, github, anthropic, supabase;
beforeAll(async () => {
  supabase = await createFakeSupabase();
  github = createFakeGithub({ writeToken: WT, readToken: RT });
  anthropic = createFakeAnthropic();
  up = createUpstreams({ supabase, github, anthropic }).listen();
});
afterEach(() => up.reset());
afterAll(() => up.close());

const ask = (body, { key = KEY, version = "2023-06-01" } = {}) => fetch("https://api.anthropic.com/v1/messages", {
  method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}), "anthropic-version": version },
  body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 1024, stream: true, messages: [{ role: "user", content: "hi" }], ...body }),
});

describe("fake Anthropic", () => {
  it("streams text deltas in the Messages event order and records the request", async () => {
    anthropic.script(turns.text(["Hello ", "Miami."]));
    const res = await ask({});
    const ev = parseSse(await res.text());
    expect(ev.map((e) => e.event)).toEqual(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
    expect(ev[1].data.content_block.type).toBe("thinking"); // adaptive thinking block first
    expect(ev.at(-3).data.delta ?? ev.at(-3).data).toBeTruthy();
    expect(ev.find((e) => e.event === "message_delta").data.delta.stop_reason).toBe("end_turn");
    expect(anthropic.requests).toHaveLength(1);
  });
  it("tool_use streams input_json_delta that reassembles to the input; stop_reason tool_use", async () => {
    anthropic.script(turns.readFile("docs/README.md", { id: "toolu_1" }));
    const ev = parseSse(await (await ask({})).text());
    const json = ev.filter((e) => e.event === "content_block_delta").map((e) => e.data.delta.partial_json).join("");
    expect(JSON.parse(json)).toEqual({ path: "docs/README.md" });
    expect(ev.filter((e) => e.event === "content_block_start")[1].data.content_block).toMatchObject({ type: "tool_use", id: "toolu_1", name: "read_file" });
    expect(ev.find((e) => e.event === "message_delta").data.delta).toMatchObject({ stop_reason: "tool_use", stop_details: null });
  });
  it("refusal: a partial text, then stop_reason refusal with stop_details", async () => {
    anthropic.script(turns.refusal());
    const ev = parseSse(await (await ask({})).text());
    expect(ev.find((e) => e.event === "message_delta").data.delta).toMatchObject({ stop_reason: "refusal", stop_details: { type: "refusal" } });
  });
  it("overloaded: a stream error event after partial text, no message_stop", async () => {
    anthropic.script(turns.overloaded());
    const ev = parseSse(await (await ask({})).text());
    expect(ev.at(-1)).toMatchObject({ event: "error", data: { error: { type: "overloaded_error" } } });
    expect(ev.some((e) => e.event === "message_stop")).toBe(false);
  });
  it("HTTP error turns fail `times` attempts with a retry-after header, then the queue moves on", async () => {
    anthropic.script(turns.httpError(429, "rate_limit_error", { times: 2, retryAfter: "7" }), turns.text("after"));
    const res = await ask({});
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect((await res.json()).error.type).toBe("rate_limit_error");
    expect((await ask({})).status).toBe(429);
    expect((await ask({})).status).toBe(200);
    expect(anthropic.unscripted).toBe(0);
  });
  it("an unscripted request is counted so a test can assert it scripted everything", async () => {
    await (await ask({})).text();
    expect(anthropic.unscripted).toBe(1);
  });
  it("accepts Authorization: Bearer (what the real SDK sends) as well as x-api-key", async () => {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 10, stream: false, messages: [{ role: "user", content: "hi" }] }) });
    expect(r.status).toBe(200);
  });
  it("runs Remy-A's request-shape rules too: prefill, forced tool_choice, thinking.type enabled, open strict tool schema", async () => {
    const bad = [
      { messages: [{ role: "user", content: "x" }, { role: "assistant", content: "pre" }] },
      { tool_choice: { type: "any" } },
      { thinking: { type: "enabled", budget_tokens: 1000 } },
      { tools: [{ name: "t", strict: true, input_schema: { type: "object", properties: {} } }] },
    ];
    for (const b of bad) expect((await ask(b)).status).toBe(400);
  });
  it("works end to end through the REAL SDK client (createAnthropicClient + buildParams): Bearer auth, adaptive thinking, streaming", async () => {
    const claude = await import("../../netlify/functions/lib/claude.mts");
    const client = claude.createAnthropicClient("chat", KEY);
    anthropic.script(turns.text(["From ", "the SDK."]));
    const params = claude.buildParams({ model: "claude-sonnet-5-5", systemPrompt: "You are a test." }, [{ role: "user", content: "hi" }], "low");
    const msg = await client.messages.stream(params).finalMessage();
    expect(msg.content.find((b) => b.type === "text").text).toBe("From the SDK.");
    expect(msg.stop_reason).toBe("end_turn");
    expect(anthropic.requests.at(-1).error).toBeNull();
  });
  it("rejects what the real API rejects: no key, no version, model outside the allow-list, sampling params, orphan tool_use", async () => {
    expect((await ask({}, { key: null })).status).toBe(400);
    expect((await ask({}, { version: "" })).status).toBe(400);
    expect((await ask({ model: "claude-3-haiku-20240307" })).status).toBe(400);
    expect((await ask({ temperature: 0.2 })).status).toBe(400);
    const orphan = await ask({ messages: [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] }, { role: "user", content: "no result" }] });
    expect(orphan.status).toBe(400);
    expect(anthropic.requests.every((r) => r.error)).toBe(true);
  });
  it("an empty script still answers with plain text; non-stream requests get one JSON message", async () => {
    const res = await ask({ stream: false });
    const j = await res.json();
    expect(j).toMatchObject({ type: "message", role: "assistant", stop_reason: "end_turn" });
  });
});

// ---------------------------------------------------------------- Ask the team: scripting BY AGENT (team_plan W1 Tess)
const sysFor = (name) => `You are ${name}.\n\n# Skill: x\nbody\n\n# Knowledge: knowledge/${name}/\nREADME text\n`;
const askAs = (name, body = {}) => ask({ system: name ? [{ type: "text", text: sysFor(name), cache_control: { type: "ephemeral" } }] : undefined, ...body });
const textOf = async (res) => parseSse(await res.text()).filter((e) => e.event === "content_block_delta" && e.data.delta.type === "text_delta").map((e) => e.data.delta.text).join("");

describe("fake Anthropic: per-agent queues (parallel consults)", () => {
  it("agentOfRequest reads the build's Knowledge heading (string or block system); the LAST heading wins; no heading = null", () => {
    expect(agentOfRequest({ system: sysFor("open-meteo-integrator") })).toBe("open-meteo-integrator");
    expect(agentOfRequest({ system: [{ type: "text", text: sysFor("orchestrator") }] })).toBe("orchestrator");
    expect(agentOfRequest({ system: `# Knowledge: knowledge/other/\nx\n${sysFor("qa-engineer")}` })).toBe("qa-engineer");
    expect(agentOfRequest({ system: "You are a test." })).toBeNull();
    expect(agentOfRequest({})).toBeNull();
    expect(agentOfRequest({ system: "mentions # Knowledge: knowledge/x/ mid-line only" })).toBeNull(); // anchored to a line
  });
  it("a tagged turn is served to that agent only, in FIFO order, whatever the arrival order; untagged turns stay on the default queue", async () => {
    anthropic.script(turns.for("ux-designer-apple-hig", turns.text("Wren 1")), turns.for("open-meteo-integrator", turns.text("Dewey 1")), turns.for("ux-designer-apple-hig", turns.text("Wren 2")), turns.text("default 1"));
    expect(anthropic.pending).toBe(4);
    expect(anthropic.pendingFor("ux-designer-apple-hig")).toBe(2);
    expect(await textOf(await askAs("open-meteo-integrator"))).toBe("Dewey 1");
    expect(await textOf(await askAs("ux-designer-apple-hig"))).toBe("Wren 1");
    expect(await textOf(await askAs("orchestrator"))).toBe("default 1"); // no queue of its own: the default queue
    expect(await textOf(await askAs("ux-designer-apple-hig"))).toBe("Wren 2");
    expect(anthropic.pending).toBe(0);
    expect(anthropic.unscripted).toBe(0);
    expect(anthropic.requests.map((r) => r.agent)).toEqual(["open-meteo-integrator", "ux-designer-apple-hig", "orchestrator", "ux-designer-apple-hig"]);
  });
  it("an agent whose own queue ran out falls back to the default queue; with both empty it is counted unscripted", async () => {
    anthropic.script(turns.for("qa-engineer", turns.text("mine")), turns.text("shared"));
    expect(await textOf(await askAs("qa-engineer"))).toBe("mine");
    expect(await textOf(await askAs("qa-engineer"))).toBe("shared");
    await (await askAs("qa-engineer")).text();
    expect(anthropic.unscripted).toBe(1);
  });
  it("old behaviour is intact: with no tags and no system prompt the default FIFO answers in order", async () => {
    anthropic.script(turns.text("one"), turns.text("two"));
    expect(await textOf(await ask({}))).toBe("one");
    expect(await textOf(await ask({}))).toBe("two");
    expect(anthropic.requests.every((r) => r.agent === null)).toBe(true);
  });
  it("a tool_use turn can be tagged too (an expert that calls propose_change), and turns.consult builds two consult_expert blocks in one round", async () => {
    const files = [{ path: "docs/x.md", content: "# x\n" }];
    anthropic.script(turns.for("ux-designer-apple-hig", turns.proposeChange({ summary: "A summary that is long enough to pass", files }, { id: "toolu_w" })));
    const ev = parseSse(await (await askAs("ux-designer-apple-hig")).text());
    expect(ev.filter((e) => e.event === "content_block_start")[1].data.content_block).toMatchObject({ type: "tool_use", id: "toolu_w", name: "propose_change" });
    const c = turns.consult([{ agent: "open-meteo-integrator", question: "q1", id: "toolu_a" }, { agent: "ux-designer-apple-hig", question: "q2", id: "toolu_b" }], { text: "Asking both." });
    expect(c.stop).toBe("tool_use");
    expect(c.blocks.filter((b) => b.type === "tool_use").map((b) => [b.name, b.input.agent])).toEqual([["consult_expert", "open-meteo-integrator"], ["consult_expert", "ux-designer-apple-hig"]]);
    anthropic.script(turns.for("orchestrator", c));
    const j = await (await askAs("orchestrator", { stream: false })).json();
    expect(j.content.filter((b) => b.type === "tool_use")).toHaveLength(2);
  });
  it("two held turns requested together overlap in time (maxConcurrent 2); two requested one after the other do not", async () => {
    anthropic.script(turns.for("open-meteo-integrator", turns.held(turns.text("D"), 300)), turns.for("ux-designer-apple-hig", turns.held(turns.text("W"), 300)));
    const [a, b] = await Promise.all([askAs("open-meteo-integrator"), askAs("ux-designer-apple-hig")]);
    expect([await textOf(a), await textOf(b)]).toEqual(["D", "W"]);
    expect(anthropic.maxConcurrent).toBe(2);
    const [rd] = anthropic.requestsOf("open-meteo-integrator"), [rw] = anthropic.requestsOf("ux-designer-apple-hig");
    expect(rd.t1).toBeGreaterThan(0);
    expect(anthropic.overlapped(rd, rw)).toBe(true);
    anthropic.reset();
    anthropic.script(turns.for("open-meteo-integrator", turns.held(turns.text("D"), 200)), turns.for("ux-designer-apple-hig", turns.held(turns.text("W"), 200)));
    await (await askAs("open-meteo-integrator")).text();
    await (await askAs("ux-designer-apple-hig")).text();
    expect(anthropic.maxConcurrent).toBe(1);
    expect(anthropic.overlapped(anthropic.requests[0], anthropic.requests[1])).toBe(false);
  });
  it("reset clears the per-agent queues, the request log and the concurrency high-water mark", async () => {
    anthropic.script(turns.for("qa-engineer", turns.text("x")));
    await (await askAs("qa-engineer")).text();
    anthropic.script(turns.for("qa-engineer", turns.text("left over")));
    up.reset();
    expect([anthropic.pending, anthropic.requests.length, anthropic.maxConcurrent, anthropic.unscripted]).toEqual([0, 0, 0, 0]);
  });
  it("a request-shape violation is still a 400 and the in-flight count is released", async () => {
    expect((await askAs("qa-engineer", { temperature: 0.2 })).status).toBe(400);
    anthropic.script(turns.for("qa-engineer", turns.held(turns.text("ok"), 50)));
    await (await askAs("qa-engineer")).text();
    expect(anthropic.maxConcurrent).toBe(1);
  });
});

const gh = (path, { method = "GET", token = WT, body } = {}) => fetch(`https://api.github.com/repos/fenago/BeachDay${path}`, {
  method, headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
async function commitOne({ path = "docs/new.md", text = "new\n", message = "Add docs\n\nBeach-Day-Proposal: p_01ARZ3NDEKTSV4RRFFQ69G5FAV", patchBody } = {}) {
  const head = (await (await gh("/git/ref/heads/main")).json()).object.sha;
  const base = (await (await gh(`/git/commits/${head}`)).json()).tree.sha;
  const tree = (await (await gh("/git/trees", { method: "POST", body: { base_tree: base, tree: [{ path, mode: "100644", type: "blob", content: text }] } })).json()).sha;
  const commit = (await (await gh("/git/commits", { method: "POST", body: { message, tree, parents: [head], author: { name: "Beach Day Agent (qa-engineer)", email: "agent@example.test" } } })).json()).sha;
  const patch = await gh("/git/refs/heads/main", { method: "PATCH", body: patchBody ?? { sha: commit, force: false } });
  return { head, base, tree, commit, patch };
}

describe("fake GitHub", () => {
  it("the happy commit sequence moves main by exactly one fast-forward commit and keeps every other file", async () => {
    const before = Object.keys(DEFAULT_SEED).length;
    const r = await commitOne();
    expect(r.patch.status).toBe(200);
    expect(github.state.main).toBe(r.commit);
    expect(github.state.fileText("docs/new.md")).toBe("new\n");
    expect(github.state.fileText("public/index.html")).toBe(DEFAULT_SEED["public/index.html"]);
    expect([...github.state.trees.get(github.state.commits.get(r.commit).tree).keys()]).toHaveLength(before + 1);
    expect(github.state.violations).toEqual([]);
  });
  it("blob SHAs are the real git hash: sha1('blob <len>\\0<content>')", async () => {
    const c = await (await gh("/contents/docs/README.md?ref=main")).json();
    const b = Buffer.from(DEFAULT_SEED["docs/README.md"]);
    expect(c.sha).toBe(createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex"));
    expect(Buffer.from(c.content, "base64").toString()).toBe(DEFAULT_SEED["docs/README.md"]);
  });
  it("enforces what Beach Day relies on: base_tree, force:false, one parent, no deletion, 100644 only", async () => {
    const head = (await (await gh("/git/ref/heads/main")).json()).object.sha;
    expect((await gh("/git/trees", { method: "POST", body: { tree: [{ path: "a.md", mode: "100644", type: "blob", content: "x" }] } })).status).toBe(422);
    const base = (await (await gh(`/git/commits/${head}`)).json()).tree.sha;
    expect((await gh("/git/trees", { method: "POST", body: { base_tree: base, tree: [{ path: "a.md", mode: "100644", type: "blob", sha: null }] } })).status).toBe(422);
    expect((await gh("/git/trees", { method: "POST", body: { base_tree: base, tree: [{ path: "a.sh", mode: "100755", type: "blob", content: "x" }] } })).status).toBe(422);
    expect((await gh("/git/commits", { method: "POST", body: { message: "m", tree: base, parents: [] } })).status).toBe(422);
    const forced = await commitOne({ patchBody: undefined, text: "f\n" }).then(async () => { const h = (await (await gh("/git/ref/heads/main")).json()).object.sha; return gh("/git/refs/heads/main", { method: "PATCH", body: { sha: h, force: true } }); });
    expect(forced.status).toBe(422);
    expect(github.state.violations.join("|")).toMatch(/base_tree.*deletion.*100755.*parent.*force/s);
  });
  it("header strictness: no User-Agent 403, wrong Accept 415, missing API version 400", async () => {
    const raw = (h) => fetch("https://api.github.com/repos/fenago/BeachDay/git/ref/heads/main", { headers: { authorization: `Bearer ${WT}`, ...h } });
    expect((await raw({ accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "" })).status).toBe(403);
    expect((await raw({ accept: "application/json", "x-github-api-version": "2022-11-28", "user-agent": "t" })).status).toBe(415);
    expect((await raw({ accept: "application/vnd.github+json", "user-agent": "t" })).status).toBe(400);
  });
  it("a tree entry with only a sha is 422, a missing force is 400, and a >1 MB file comes back encoding none", async () => {
    const head = (await (await gh("/git/ref/heads/main")).json()).object.sha;
    const base = (await (await gh(`/git/commits/${head}`)).json()).tree.sha;
    expect((await gh("/git/trees", { method: "POST", body: { base_tree: base, tree: [{ path: "a.md", mode: "100644", type: "blob", sha: "0".repeat(40) }] } })).status).toBe(422);
    expect((await gh("/git/refs/heads/main", { method: "PATCH", body: { sha: head } })).status).toBe(400);
    github.state.pushConcurrent("docs/big.md", "x".repeat(1_000_001));
    const big = await (await gh("/contents/docs/big.md")).json();
    expect([big.encoding, big.content]).toEqual(["none", ""]);
    expect(github.state.violations.join("|")).toMatch(/without content.*force=undefined/s);
  });
  it("401 for a bad token; a read-only token can read but not write (403)", async () => {
    expect((await gh("/git/ref/heads/main", { token: "nope" })).status).toBe(401);
    expect((await gh("/git/ref/heads/main", { token: RT })).status).toBe(200);
    expect((await gh("/git/blobs", { method: "POST", token: RT, body: { content: "x", encoding: "utf-8" } })).status).toBe(403);
  });
  it("race: a concurrent push makes PATCH answer 422 'not a fast forward' and main is the OTHER commit", async () => {
    github.state.failNextPatchWithRace();
    const r = await commitOne();
    expect(r.patch.status).toBe(422);
    expect(github.state.main).not.toBe(r.commit);
    expect(github.state.fileText("docs/other.md")).toBe("someone else\n");
  });
  it("unknown outcome: PATCH applied but the answer is a 502 or a dropped connection; log search finds the trailer", async () => {
    github.state.patchAppliesThen("502");
    const r = await commitOne();
    expect(r.patch.status).toBe(502);
    expect(github.state.main).toBe(r.commit);
    const list = await (await gh("/commits?sha=main&per_page=50&page=1")).json();
    expect(list[0].commit.message).toMatch(/Beach-Day-Proposal: p_/);
    expect(list[0].commit.author.name).toBe("Beach Day Agent (qa-engineer)");
    expect(list[0].parents).toHaveLength(1);
    github.state.patchAppliesThen("network");
    await expect(commitOne({ text: "again\n" })).rejects.toThrow();
  });
  it("read outage: every GET is 502 until cleared; writes are not affected by the flag", async () => {
    github.state.setReadDown(true);
    expect((await gh("/git/ref/heads/main")).status).toBe(502);
    expect((await gh("/commits?sha=main")).status).toBe(502);
  });
  it("contents lists a directory; .env exists for the read-tool refusal tests; recursive trees list every blob", async () => {
    const dir = await (await gh("/contents/docs")).json();
    expect(dir.map((e) => e.name)).toContain("README.md");
    expect((await gh("/contents/.env")).status).toBe(200);
    const head = (await (await gh("/git/ref/heads/main")).json()).object.sha;
    const tree = (await (await gh(`/git/commits/${head}`)).json()).tree.sha;
    const rec = await (await gh(`/git/trees/${tree}?recursive=1`)).json();
    expect(rec.tree.map((e) => e.path).sort()).toEqual(Object.keys(DEFAULT_SEED).sort());
  });
  it("workflow paths are refused on the ref update (no Workflows permission)", async () => {
    const r = await commitOne({ path: ".github/workflows/x.yml", text: "on: push\n" });
    expect(r.patch.status).toBe(404);
  });
});

describe("MSW guard and the Supabase host", () => {
  it("any other host fails the request and is recorded; the fixture Supabase host reaches the fake", async () => {
    await expect(fetch("https://example.com/")).rejects.toThrow();
    await expect(fetch("https://api.open-meteo.com/v1/forecast")).rejects.toThrow(); // server side never needs it
    expect(up.unexpected).toEqual(["GET https://example.com/", "GET https://api.open-meteo.com/v1/forecast"]);
    const r = await fetch(`${supabase.origin}/auth/v1/.well-known/jwks.json`);
    expect((await r.json()).keys).toHaveLength(1);
    supabase.fail("jwks", "network", { times: 1 });
    await expect(fetch(`${supabase.origin}/auth/v1/.well-known/jwks.json`)).rejects.toThrow();
  });
});
