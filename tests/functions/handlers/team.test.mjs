// "Ask the team" through the REAL handlers in the in-process harness (support.mjs): the lead's turn runs only as a
// background job (R-1), consult_expert inside job-run (R-2), events persisted at consult start and end (R-4),
// T2 (low-value events first out), GET /api/agents teamLead. The harness's fake Anthropic is one FIFO queue, so each
// handler test uses a single consult (deterministic order); parallel consults are covered in lib/team.test.mjs.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setup, sse, schemaErrors, ADMIN } from "./support.mjs";
import { turns } from "../../helpers/msw-upstreams.mjs";
import { windowKey } from "../../../netlify/functions/lib/limits.mts";
import { sha256hex } from "../../../netlify/functions/lib/jobs.mts";

let t, h;
beforeAll(async () => { t = await setup(); h = t.h; });
afterAll(async () => { await t?.close(); });
beforeEach(async () => { await t.reset(); });

const LEAD = "orchestrator";
const SUMMARY = "Clarify the Fair verdict wording in the UX build spec";
const sub = (email = ADMIN) => h.supabase.getUser(email).id;
const startJob = async (token, body = { agent: LEAD, messages: [{ role: "user", content: "Is Saturday good at Hollywood Beach?" }] }) =>
  t.call("POST /api/jobs", t.req("POST", "/api/jobs", { token, body }));
const consult = (agent, question = "Is Saturday a good beach day at Hollywood Beach?") => turns.toolUse("consult_expert", { agent, question });
const view = async (token, id) => (await t.call("GET /api/jobs/:id", t.req("GET", `/api/jobs/${id}`, { token }))).json();

describe("R-1: the team lead runs only as a job", () => {
  it("POST /api/chat with the lead -> 400 invalid_request; no Claude call, no chat slot used", async () => {
    const token = await t.token();
    const res = await t.call("POST /api/chat", t.req("POST", "/api/chat", { token, body: { agent: LEAD, messages: [{ role: "user", content: "Hi" }] } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_request");
    expect(schemaErrors("api-error", body)).toEqual([]);
    expect(h.anthropic.requests).toHaveLength(0);
    expect(h.blobs.peek("ratelimit", windowKey(sub(), "chat", new Date()))).toBeFalsy();
  });
  it("POST /api/chat with an expert still streams as before", async () => {
    h.anthropic.script(turns.text("Hello."));
    const evs = await sse(await t.call("POST /api/chat", t.req("POST", "/api/chat", { token: await t.token(), body: { agent: "open-meteo-integrator", messages: [{ role: "user", content: "Hi" }] } })));
    expect(evs.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
  });
});

describe("GET /api/agents", () => {
  it("only the lead carries teamLead: true; the response matches agents-response; no prompts", async () => {
    const body = await (await t.call("GET /api/agents", t.req("GET", "/api/agents", { token: await t.token() }))).json();
    expect(schemaErrors("agents-response", body)).toEqual([]);
    expect(body.agents.filter((a) => a.teamLead === true).map((a) => a.name)).toEqual([LEAD]);
    expect(body.agents.filter((a) => "teamLead" in a)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("systemPrompt");
  });
});

describe("R-2/R-4: a team job in job-run", () => {
  it("the lead gets read tools + consult_expert; the expert answers; events carry agent; the job ends done", async () => {
    h.anthropic.script(consult("open-meteo-integrator"), turns.text("NESTED-EXPERT Saturday is Great."), turns.text("Saturday looks great. Asked: Dewey"));
    const token = await t.token();
    const res = await startJob(token);
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    await t.settled();
    const [kai1, dewey, kai2] = h.anthropic.requests.map((r) => r.body);
    expect(kai1.tools.map((x) => x.name)).toEqual(["read_file", "list_files", "consult_expert"]);
    expect(kai1.tools[2].input_schema.properties.agent.enum).not.toContain(LEAD);
    expect(dewey.tools.map((x) => x.name)).toEqual(["read_file", "list_files", "propose_change"]);
    expect(dewey.output_config).toEqual({ effort: "medium" });
    expect(dewey.messages).toHaveLength(1);
    expect(dewey.messages[0].content).toMatch(/^The team lead \(Kai\) asks, on behalf of the signed-in Console user:/);
    expect(kai2.messages.at(-1).content[0].content).toMatch(/^<expert_report agent="open-meteo-integrator">\nNESTED-EXPERT/);

    const v = await view(token, jobId);
    expect(schemaErrors("job-view", v)).toEqual([]);
    expect(v.status).toBe("done");
    const consults = v.events.filter((e) => e.type === "tool" && e.name === "consult_expert");
    expect(consults).toEqual([
      { type: "tool", name: "consult_expert", phase: "start", agent: "open-meteo-integrator" },
      { type: "tool", name: "consult_expert", phase: "end", agent: "open-meteo-integrator", ok: true },
    ]);
    expect(JSON.stringify(v.events)).not.toContain("NESTED-EXPERT"); // nested text stays server-side
    expect(v.events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Saturday looks great. Asked: Dewey");
    expect(h.blobs.peek("ratelimit", windowKey(sub(), "chat", new Date()))).toEqual({ count: 1 }); // a consult = one chat turn
  });

  it("progress is persisted at consult START: 'Asking' is visible before the expert answers", async () => {
    h.anthropic.script(consult("ux-designer-apple-hig"), turns.slow("Wren's answer.", 600), turns.text("Done."));
    const { jobId } = await (await startJob(await t.token())).json();
    let seenStartOnly = false;
    for (let i = 0; i < 100 && !seenStartOnly; i++) {
      const evs = h.blobs.peek("jobs", jobId)?.events ?? [];
      const c = evs.filter((e) => e.name === "consult_expert");
      if (c.length === 1 && c[0].phase === "start") seenStartOnly = true;
      else await new Promise((r) => setTimeout(r, 10));
    }
    await t.settled();
    expect(seenStartOnly).toBe(true);
    expect(h.blobs.peek("jobs", jobId).status).toBe("done");
  });

  it("an expert drafts the proposal: agent = the expert, createdBy = the owner; the proposal event carries agent", async () => {
    h.anthropic.script(
      consult("ux-designer-apple-hig", "Propose a clearer one-line Fair explanation in docs/README.md"),
      turns.proposeChange({ summary: SUMMARY, files: [{ path: "docs/README.md", content: "# Docs\n\nFair: OK, with a catch.\n" }] }),
      turns.text("I proposed it."),
      turns.text("Wren drafted a proposal for you to review. Asked: Wren"),
    );
    const token = await t.token();
    const { jobId } = await (await startJob(token)).json();
    await t.settled();
    const v = await view(token, jobId);
    expect(schemaErrors("job-view", v)).toEqual([]);
    const p = v.events.find((e) => e.type === "proposal");
    expect(p.agent).toBe("ux-designer-apple-hig");
    expect(v.proposalId).toBe(p.proposalId);
    const rec = h.blobs.peek("proposals", p.proposalId);
    expect(rec).toMatchObject({ agent: "ux-designer-apple-hig", createdBy: sub(), status: "pending" });
    expect(v.events.filter((e) => e.type === "tool" && e.name === "propose_change").every((e) => e.agent === "ux-designer-apple-hig")).toBe(true);
  });

  it("D6 through an expert: public/js/console/x.js is refused, nothing stored, and Kai still answers", async () => {
    h.anthropic.script(
      consult("ux-designer-apple-hig", "Change the console"),
      turns.proposeChange({ summary: "Tweak the console chat wording for clarity", files: [{ path: "public/js/console/x.js", content: "export {};\n" }] }),
      turns.text("That path is denied to agents."),
      turns.text("Wren couldn't change the Console: a human must. Asked: Wren"),
    );
    const token = await t.token();
    const { jobId } = await (await startJob(token)).json();
    await t.settled();
    expect(h.anthropic.requests[2].body.messages.at(-1).content[0]).toMatchObject({ is_error: true });
    expect(h.blobs.getStore("proposals").rows.size).toBe(0);
    expect((await view(token, jobId)).status).toBe("done");
  });

  it("an expert refusal doesn't end the job: ok:false end event, no error event, job done", async () => {
    h.anthropic.script(consult("security-engineer"), turns.refusal("PARTIAL"), turns.text("Vera declined. Asked: Vera"));
    const token = await t.token();
    const { jobId } = await (await startJob(token)).json();
    await t.settled();
    const v = await view(token, jobId);
    expect(v.status).toBe("done");
    expect(v.events.find((e) => e.name === "consult_expert" && e.phase === "end")).toEqual({ type: "tool", name: "consult_expert", phase: "end", agent: "security-engineer", ok: false });
    expect(v.events.some((e) => e.type === "error")).toBe(false);
  });

  it("a non-lead job keeps the expert tool set and no consult_expert", async () => {
    h.anthropic.script(turns.text("Done."));
    await startJob(await t.token(), { agent: "open-meteo-integrator", messages: [{ role: "user", content: "Hi" }] });
    await t.settled();
    expect(h.anthropic.requests[0].body.tools.map((x) => x.name)).toEqual(["read_file", "list_files", "propose_change"]);
  });
});

describe("T2: low-value events go first", () => {
  it("read_file/list_files events are kept only below 400; proposal, consult, text and terminal events still fit", async () => {
    const { appendProgress, LOW_VALUE_EVENT_CAP } = await import("../../../netlify/functions/job-run.mts");
    expect(LOW_VALUE_EVENT_CAP).toBe(400);
    const read = { type: "tool", name: "read_file", phase: "end" };
    const list = { type: "tool", name: "list_files", phase: "start", agent: "qa-engineer" };
    const consultEnd = { type: "tool", name: "consult_expert", phase: "end", agent: "qa-engineer", ok: true };
    const proposal = { type: "proposal", proposalId: "p_01JAAAAAAAAAAAAAAAAAAAAAAA", summary: "s", files: [{ path: "docs/a.md", bytes: 1 }] };
    const at399 = appendProgress(Array(399).fill(read), [read, list, read]);
    expect(at399).toHaveLength(400); // one more low-value event fits, then none
    const full = appendProgress(Array(400).fill(read), [read, list, consultEnd, proposal, { type: "text", delta: "Answer" }, read]);
    expect(full.slice(400)).toEqual([consultEnd, proposal, { type: "text", delta: "Answer" }]);
    const nearCap = appendProgress(Array(498).fill(read), [proposal, proposal, { type: "done", stopReason: "end_turn" }]);
    expect(nearCap.at(-1)).toEqual({ type: "done", stopReason: "end_turn" }); // the terminal slot is kept
    expect(nearCap).toHaveLength(500);
  });
  it("job-run applies it: a job already holding 400 events drops new read events but stores the answer and done", async () => {
    const token = await t.token();
    const nonce = "C".repeat(43);
    const id = "j_01JBBBBBBBBBBBBBBBBBBBBBBB";
    const old = Array(400).fill({ type: "tool", name: "list_files", phase: "end", summary: "Listed the repo root" });
    const now = new Date().toISOString();
    h.blobs.seed("jobs", id, { id, owner: sub(), agent: "open-meteo-integrator", status: "queued", nonceHash: sha256hex(nonce), messages: [{ role: "user", content: "x" }], baseSha: null, readShas: {}, usage: { tokens: 0, rounds: 0 }, events: old, proposalId: null, createdAt: now, updatedAt: now });
    h.anthropic.script(turns.readFile("docs/README.md"), turns.text("The answer."));
    await t.call("POST /api/jobs-run", t.req("POST", "/api/jobs-run", { token, body: { jobId: id, nonce } }));
    await t.settled();
    const rec = h.blobs.peek("jobs", id);
    expect(rec.status).toBe("done");
    expect(rec.events.slice(400)).toEqual([{ type: "text", delta: "The answer." }, { type: "done", stopReason: "end_turn" }]);
  });
  const seedJob = async (n, id) => {
    const nonce = "D".repeat(43);
    const now = new Date().toISOString();
    h.blobs.seed("jobs", id, { id, owner: sub(), agent: "open-meteo-integrator", status: "queued", nonceHash: sha256hex(nonce), messages: [{ role: "user", content: "x" }], baseSha: null, readShas: {}, usage: { tokens: 0, rounds: 0 }, events: Array(n).fill({ type: "text", delta: "." }), proposalId: null, createdAt: now, updatedAt: now });
    await t.call("POST /api/jobs-run", t.req("POST", "/api/jobs-run", { token: await t.token(), body: { jobId: id, nonce } }));
    await t.settled();
    return h.blobs.peek("jobs", id);
  };
  it("(j) inside job-run at 399: a read's end is the 400th event; the next read is dropped; the answer and done are kept", async () => {
    h.anthropic.script(turns.readFile("docs/README.md"), turns.readFile("docs/README.md"), turns.text("Answer."));
    const rec = await seedJob(399, "j_01JCCCCCCCCCCCCCCCCCCCCCCC");
    expect(rec.status).toBe("done");
    expect(rec.events.slice(399)).toEqual([
      { type: "tool", name: "read_file", phase: "end", summary: "Read docs/README.md" }, // its start (>= 380) was dropped first
      { type: "text", delta: "Answer." }, { type: "done", stopReason: "end_turn" },
    ]);
  });
  it("(e) below 380 a read keeps both start and end", async () => {
    h.anthropic.script(turns.readFile("docs/README.md"), turns.text("Answer."));
    const rec = await seedJob(379, "j_01JDDDDDDDDDDDDDDDDDDDDDDD");
    expect(rec.events.slice(379).map((e) => e.phase ?? e.type)).toEqual(["start", "end", "text", "done"]);
  });
});

describe("(c) a failed progress write keeps its events for the next write", () => {
  it("the events of a thrown write are put back and stored by the next one", async () => {
    const jobs = h.blobs.getStore("jobs");
    const real = jobs.setJSON;
    let writes = 0;
    jobs.setJSON = async function (key, value, opts) {
      if (key.startsWith("j_") && opts?.onlyIfMatch && value.status === "running" && (value.events ?? []).length > 0 && ++writes === 1) throw new Error("blobs down");
      return real.call(this, key, value, opts);
    };
    try {
      h.anthropic.script(turns.readFile("docs/README.md"), turns.text("Answer."));
      const token = await t.token();
      const { jobId } = await (await startJob(token, { agent: "open-meteo-integrator", messages: [{ role: "user", content: "Read" }] })).json();
      await t.settled();
      expect(writes).toBeGreaterThanOrEqual(1);
      const evs = h.blobs.peek("jobs", jobId).events;
      expect(evs.filter((e) => e.name === "read_file").map((e) => e.phase)).toEqual(["start", "end"]);
      expect(evs.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
    } finally {
      jobs.setJSON = real;
    }
  });
});
