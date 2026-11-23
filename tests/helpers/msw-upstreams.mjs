// In-process upstream fakes for the server side: Anthropic Messages (streaming), the GitHub Git DB API and the
// fake Supabase project, all behind ONE MSW server with onUnhandledRequest = error (loopback is let through).
// Nothing here ever reaches the network. Tokens/keys are built at runtime (secrets.mjs).
import { setupServer } from "msw/node";
import { http, HttpResponse, passthrough } from "msw";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_REPO } from "./secrets.mjs";
import { violations as remyViolations } from "../functions/lib/support/fake-anthropic.mjs"; // Remy-A's request-shape rules (kept stable by contract)

const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const blobSha = (text) => { const b = Buffer.from(text); return sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])); }; // the real git blob hash
const enc = new TextEncoder();
const sleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

// =====================================================================================================
// Anthropic Messages
// =====================================================================================================
export const ALLOWED_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Turn builders: queue them with anthropic.script(turn, turn, ...). One turn answers ONE POST /v1/messages. */
export const turns = {
  text: (text, extra = {}) => ({ blocks: [{ type: "text", chunks: Array.isArray(text) ? text : [text] }], stop: "end_turn", ...extra }),
  toolUse: (name, input, { id, text } = {}) => ({ blocks: [...(text ? [{ type: "text", chunks: [text] }] : []), { type: "tool_use", name, input, id }], stop: "tool_use" }),
  readFile: (path, opts) => turns.toolUse("read_file", { path }, opts),
  listFiles: (dir = "", opts) => turns.toolUse("list_files", { dir }, opts),
  proposeChange: ({ summary, files }, opts) => turns.toolUse("propose_change", { summary, files }, opts),
  refusal: (partial = "I can") => ({ blocks: [{ type: "text", chunks: [partial] }], stop: "refusal" }),
  maxTokens: (text = "cut off") => ({ blocks: [{ type: "text", chunks: [text] }], stop: "max_tokens" }),
  overloaded: (partial = "Part") => ({ blocks: [{ type: "text", chunks: [partial] }], streamError: { type: "overloaded_error", message: "Overloaded" } }),
  // The SDK retries 429/5xx (chat: 1 retry, job: 2), so one failure is not visible. times = how many attempts fail (default 3).
  httpError: (status, type = "api_error", { times = 3, retryAfter = "0" } = {}) => ({ httpError: { status, type, times, retryAfter } }),
  slow: (text, delayMs = 2000) => ({ blocks: [{ type: "text", chunks: [text] }], stop: "end_turn", eventDelayMs: delayMs }),
};

function validateMessagesRequest(body, headers) {
  // The SDK sends `Authorization: Bearer <key>`; raw HTTP clients send x-api-key. Both are valid on the real API.
  if (!headers.get("x-api-key") && !/^Bearer \S+/.test(headers.get("authorization") ?? "")) return "missing x-api-key";
  if (!headers.get("anthropic-version")) return "missing anthropic-version";
  if (!ALLOWED_MODELS.includes(body.model)) return `model ${body.model} is not in the allow-list`;
  if (!(body.max_tokens > 0)) return "max_tokens required";
  return remyViolations(body); // sampling params, thinking.type, forced tool_choice, strict schemas, prefill, tool_result order
}

export function createFakeAnthropic() {
  const requests = []; // { body, headers, error }
  let queue = [];
  let n = 0;
  const api = {
    requests,
    script(...ts) { queue.push(...ts); return api; },
    get pending() { return queue.length; },
    unscripted: 0,
    reset() { queue = []; requests.length = 0; n = 0; api.unscripted = 0; },
    get lastBody() { return requests.at(-1)?.body; },
    /** MSW resolver for POST /v1/messages */
    async handle(request) {
      let body = {};
      try { body = await request.clone().json(); } catch { /* validated below */ }
      const problem = validateMessagesRequest(body, request.headers);
      requests.push({ body, headers: Object.fromEntries(request.headers), error: problem });
      if (problem) return HttpResponse.json({ type: "error", error: { type: "invalid_request_error", message: problem }, request_id: "req_fake_400" }, { status: 400 });
      if (queue.length === 0) api.unscripted += 1; // an empty queue is visible: assert unscripted === 0 when the test scripted everything
      const turn = queue[0] ?? turns.text("Hollywood Beach looks great today.");
      if (turn.httpError) {
        turn.httpError.left = (turn.httpError.left ?? turn.httpError.times) - 1;
        if (turn.httpError.left <= 0) queue.shift();
        return HttpResponse.json({ type: "error", error: { type: turn.httpError.type, message: "fake upstream error" }, request_id: "req_fake_err" }, { status: turn.httpError.status, headers: { "retry-after": String(turn.httpError.retryAfter) } });
      }
      queue.shift();
      const id = `msg_fake_${++n}`;
      const thinking = { type: "thinking", thinking: "", signature: `sig_fake_${n}` }; // adaptive thinking, display omitted: always first
      const content = [thinking, ...turn.blocks.map((b, i) => (b.type === "text" ? { type: "text", text: b.chunks.join("") } : { type: "tool_use", id: b.id ?? `toolu_fake_${n}_${i}`, name: b.name, input: b.input }))];
      const stopReason = turn.stop ?? "end_turn";
      const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      if (body.stream !== true) {
        return HttpResponse.json({ id, type: "message", role: "assistant", model: body.model, content, stop_reason: stopReason, stop_sequence: null, stop_details: null, usage });
      }
      const sig = request.signal;
      const stream = new ReadableStream({
        async start(controller) {
          const send = async (event, data) => { if (sig.aborted) return; controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); if (turn.eventDelayMs) await sleep(turn.eventDelayMs, sig); };
          await send("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, stop_details: null, usage: { ...usage, output_tokens: 1 } } });
          await send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
          await send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: thinking.signature } });
          await send("content_block_stop", { type: "content_block_stop", index: 0 });
          let idx = 1;
          for (const b of turn.blocks) {
            if (b.type === "text") {
              await send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } });
              for (const c of b.chunks) await send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: c } });
            } else {
              const blk = content[idx];
              await send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "tool_use", id: blk.id, name: b.name, input: {} } });
              const json = JSON.stringify(b.input);
              for (let p = 0; p < json.length; p += 40) await send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: json.slice(p, p + 40) } });
            }
            await send("content_block_stop", { type: "content_block_stop", index: idx });
            idx += 1;
          }
          if (turn.streamError) await send("error", { type: "error", error: turn.streamError });
          else {
            const delta = stopReason === "refusal"
              ? { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: "cyber", explanation: "This request was declined." } }
              : { stop_reason: stopReason, stop_sequence: null, stop_details: null };
            await send("message_delta", { type: "message_delta", delta, usage: { output_tokens: 20 } });
            await send("message_stop", { type: "message_stop" });
          }
          controller.close();
        },
      });
      return new HttpResponse(stream, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_fake_1" } });
    },
  };
  return api;
}

// =====================================================================================================
// GitHub Git DB (one repo). Enforces what Beach Day relies on: base_tree on every tree, force:false, fast-forward only,
// one parent, 100644 blobs, no deletions, no workflow paths. Real git blob SHAs, so the reconciler's blob check is real.
// =====================================================================================================
export const DEFAULT_SEED = Object.freeze({
  "public/index.html": "<!doctype html><title>Beach Day</title>\n",
  "public/js/score-config.js": "export const SCORE_CONFIG = {};\n",
  "docs/README.md": "# Docs\n",
  "tests/unit/example.test.mjs": "// placeholder\n",
  ".claude/agents/orchestrator.md": "---\nname: orchestrator\n---\nKai.\n",
  "netlify.toml": "[build]\n  publish = \"public\"\n",
  ".env": "NOT_A_REAL_SECRET=1\n",
});

/** Load real repo files from disk as the seed (paths relative to the repo root). */
export function seedFromDisk(root, paths) {
  return Object.fromEntries(paths.map((p) => [p, readFileSync(join(root, p), "utf8")]));
}

export function createFakeGithub({ owner = FIXTURE_REPO.owner, repo = FIXTURE_REPO.repo, writeToken, readToken = null, files = DEFAULT_SEED, now = () => Date.now() } = {}) {
  if (!writeToken) throw new Error("createFakeGithub needs writeToken (build it with fakeGithubToken())");
  const blobs = new Map(); // sha -> text
  const trees = new Map(); // sha -> Map(path -> blobSha)  (flat)
  const commits = new Map(); // sha -> { tree, parents, message, author, committer }
  const putBlob = (text) => { const id = blobSha(text); blobs.set(id, text); return id; };
  const putTree = (map) => { const id = sha1("tree " + JSON.stringify([...map].sort())); trees.set(id, new Map(map)); return id; };
  let main;
  const calls = [];
  const seed = new Map(Object.entries(files).map(([p, t]) => [p, putBlob(t)]));
  const rootTree = putTree(seed);
  main = sha1("commit root");
  commits.set(main, { tree: rootTree, parents: [], message: "root", author: { name: "Dr. Lee", email: "lee@example.test", date: new Date(0).toISOString() } });
  const baseMain = main;
  const mode = { patch: null, readDown: false, failNext: [] }; // see the setters below
  const prefix = `/repos/${owner}/${repo}`;
  const err = (status, message) => HttpResponse.json({ message, documentation_url: "https://docs.github.com/rest" }, { status });
  const chain = () => { const out = []; let c = main; while (c) { out.push(c); c = commits.get(c).parents[0]; } return out; };
  const commitJson = (sha) => { const c = commits.get(sha); return { sha, node_id: "C_fake", tree: { sha: c.tree }, parents: c.parents.map((p) => ({ sha: p })), message: c.message, author: c.author, committer: c.author }; };

  const state = {
    owner, repo, calls, blobs, trees, commits,
    get main() { return main; },
    get commitCount() { return chain().length; },
    fileText(path, ref = main) { const t = trees.get(commits.get(ref).tree); const b = t.get(path); return b === undefined ? null : blobs.get(b); },
    log() { return chain().map((sha) => ({ sha, ...commits.get(sha) })); },
    /** Someone else pushes to main (moves it under a proposal). */
    pushConcurrent(path, text, message = "concurrent change") {
      const t = new Map(trees.get(commits.get(main).tree)); t.set(path, putBlob(text));
      const tid = putTree(t);
      const c = sha1("commit " + tid + main + message);
      commits.set(c, { tree: tid, parents: [main], message, author: { name: "Someone Else", email: "else@example.test", date: new Date(now()).toISOString() } });
      main = c; return c;
    },
    /** The next PATCH ref loses a race: someone else pushes first, then the PATCH answers 422 "not a fast forward". */
    failNextPatchWithRace() { mode.patch = "race"; },
    /** The next PATCH ref is APPLIED on GitHub but the answer is lost: "502" or "network". The reconciler must find it. */
    patchAppliesThen(kind) { mode.patch = kind === "network" ? "applies_network" : "applies_502"; },
    /** The next PATCH ref fails and is NOT applied (502). */
    patchFails502() { mode.patch = "fails_502"; },
    /** Every read (ref, commits, trees, contents) answers 502 until cleared: "GitHub is down" for the reconciler. */
    setReadDown(v = true) { mode.readDown = v; },
    /** Fail the next request whose "METHOD /path" matches the regexp. */
    failNext(re, status = 500) { mode.failNext.push({ re, status }); },
    reset() { state.resetRepo(); mode.patch = null; mode.readDown = false; mode.failNext = []; calls.length = 0; },
    resetRepo() { main = baseMain; state.violations.length = 0; },
    violations: [], // things Beach Day must never do (deletions, workflow paths, force, missing base_tree), recorded even if answered
  };

  async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(prefix)) return err(404, "Not Found");
    const p = url.pathname.slice(prefix.length);
    const method = request.method;
    calls.push(`${method} ${p}${url.search}`);
    const auth = request.headers.get("authorization") ?? "";
    const tok = /^(?:Bearer|token) (.+)$/.exec(auth)?.[1];
    const isWrite = tok === writeToken;
    const isRead = tok === readToken;
    if (!isWrite && !isRead) return err(401, "Bad credentials");
    if (!request.headers.get("user-agent")) return err(403, "Request forbidden by administrative rules. Please make sure your request has a User-Agent header.");
    if (!/^application\/vnd\.github(\.(raw|object|json|diff|patch))?(\+json)?$/.test(request.headers.get("accept") ?? "")) return err(415, "Unsupported Accept (Beach Day sends application/vnd.github+json)");
    if (request.headers.get("x-github-api-version") !== "2022-11-28") return err(400, "X-GitHub-Api-Version 2022-11-28 is required by Beach Day");
    if (method !== "GET" && !isWrite) return err(403, "Resource not accessible by personal access token");
    const key = `${method} ${p}`;
    const fi = mode.failNext.findIndex((f) => f.re.test(key));
    if (fi >= 0) { const [f] = mode.failNext.splice(fi, 1); return err(f.status, "fake failure"); }
    if (mode.readDown && method === "GET") return err(502, "Bad Gateway");

    if (method === "GET" && (p === "/git/ref/heads/main" || p === "/git/refs/heads/main")) return HttpResponse.json({ ref: "refs/heads/main", node_id: "R_fake", url: "", object: { type: "commit", sha: main } });
    let m;
    if (method === "GET" && (m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(p))) return commits.has(m[1]) ? HttpResponse.json(commitJson(m[1])) : err(404, "Not Found");
    if (method === "GET" && (m = /^\/git\/trees\/([0-9a-f]{40})$/.exec(p))) {
      const t = trees.get(m[1]); if (!t) return err(404, "Not Found");
      const recursive = url.searchParams.get("recursive");
      if (recursive) return HttpResponse.json({ sha: m[1], truncated: false, tree: [...t].map(([path, sha]) => ({ path, mode: "100644", type: "blob", sha, size: blobs.get(sha).length })) });
      const top = new Map();
      for (const [path, sha] of t) { const [head, ...rest] = path.split("/"); top.set(head, rest.length ? { type: "tree", mode: "040000", sha: sha1("dir " + head) } : { type: "blob", mode: "100644", sha }); }
      return HttpResponse.json({ sha: m[1], truncated: false, tree: [...top].map(([path, e]) => ({ path, ...e })) });
    }
    if (method === "GET" && (m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(p))) { const b = blobs.get(m[1]); return b === undefined ? err(404, "Not Found") : HttpResponse.json({ sha: m[1], size: Buffer.byteLength(b), encoding: "base64", content: Buffer.from(b).toString("base64") }); }
    if (method === "GET" && p.startsWith("/contents")) {
      const path = decodeURIComponent(p.slice("/contents".length).replace(/^\//, ""));
      const ref = url.searchParams.get("ref") ?? "main";
      const sha = ref === "main" ? main : ref;
      const c = commits.get(sha); if (!c) return err(404, "No commit found for the ref " + ref);
      const t = trees.get(c.tree);
      const hit = t.get(path);
      if (hit) { const text = blobs.get(hit); if (Buffer.byteLength(text) > 1_000_000) return HttpResponse.json({ type: "file", encoding: "none", size: Buffer.byteLength(text), name: path.split("/").pop(), path, sha: hit, content: "" }); return HttpResponse.json({ type: "file", encoding: "base64", size: Buffer.byteLength(text), name: path.split("/").pop(), path, sha: hit, content: Buffer.from(text).toString("base64") }); }
      const dir = path ? `${path}/` : "";
      const names = new Map();
      for (const [fp, bs] of t) if (fp.startsWith(dir)) { const rest = fp.slice(dir.length); const [head, ...tail] = rest.split("/"); names.set(head, tail.length ? { type: "dir", sha: sha1("dir " + dir + head) } : { type: "file", sha: bs }); }
      if (!names.size) return err(404, "Not Found");
      return HttpResponse.json([...names].map(([name, e]) => ({ name, path: dir + name, type: e.type, sha: e.sha })));
    }
    if (method === "GET" && p === "/commits") {
      const since = url.searchParams.get("since");
      const per = Math.min(100, Number(url.searchParams.get("per_page") ?? 30)); const page = Number(url.searchParams.get("page") ?? 1);
      let list = chain();
      if (since) list = list.filter((sha) => Date.parse(commits.get(sha).author.date) >= Date.parse(since));
      list = list.slice((page - 1) * per, page * per);
      return HttpResponse.json(list.map((sha) => { const c = commits.get(sha); return { sha, commit: { message: c.message, author: c.author, committer: c.author, tree: { sha: c.tree } }, parents: c.parents.map((x) => ({ sha: x })) }; }));
    }
    if (method === "GET" && (m = /^\/commits\/([^/]+)$/.exec(p))) { const sha = m[1] === "main" ? main : m[1]; return commits.has(sha) ? HttpResponse.json({ ...commitJson(sha), commit: { message: commits.get(sha).message, tree: { sha: commits.get(sha).tree } } }) : err(404, "Not Found"); }

    // ---- writes ----
    const body = await request.clone().json().catch(() => ({}));
    if (method === "POST" && p === "/git/blobs") { const text = body.encoding === "base64" ? Buffer.from(body.content, "base64").toString() : String(body.content ?? ""); return HttpResponse.json({ sha: putBlob(text) }, { status: 201 }); }
    if (method === "POST" && p === "/git/trees") {
      if (!body.base_tree) { state.violations.push("tree without base_tree"); return err(422, "fake: base_tree is REQUIRED by Beach Day (omitting it drops every other file)"); }
      const base = trees.get(body.base_tree); if (!base) return err(404, "Not Found");
      const t = new Map(base);
      for (const e of body.tree ?? []) {
        if (e.mode !== "100644" || e.type !== "blob") { state.violations.push(`bad mode/type ${e.mode} ${e.type}`); return err(422, "fake: only 100644 blobs are allowed"); }
        if (e.sha === null) { state.violations.push(`deletion of ${e.path}`); return err(422, "fake: Beach Day never deletes (sha:null)"); }
        if (typeof e.content === "string") t.set(e.path, putBlob(e.content));
        else { state.violations.push(`tree entry without content: ${e.path}`); return err(422, "fake: Beach Day always sends content in tree entries"); }
      }
      return HttpResponse.json({ sha: putTree(t), truncated: false }, { status: 201 });
    }
    if (method === "POST" && p === "/git/commits") {
      if (!trees.has(body.tree)) return err(422, "Tree SHA does not exist");
      if (!Array.isArray(body.parents) || body.parents.length !== 1 || !commits.has(body.parents[0])) { state.violations.push("commit without exactly one known parent"); return err(422, "fake: exactly one existing parent required"); }
      const author = { name: body.author?.name ?? "unknown", email: body.author?.email ?? "unknown@example.test", date: body.author?.date ?? new Date(now()).toISOString() };
      const sha = sha1("commit " + body.tree + body.parents[0] + body.message + author.name + author.date);
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message, author });
      return HttpResponse.json({ ...commitJson(sha) }, { status: 201 });
    }
    if (method === "PATCH" && (p === "/git/refs/heads/main" || p === "/git/refs/heads/main/")) {
      if (body.force !== false) { state.violations.push(`force=${body.force}`); return err(body.force === undefined ? 400 : 422, "fake: Beach Day always sends force:false"); }
      const patchMode = mode.patch; mode.patch = null;
      if (patchMode === "race") { state.pushConcurrent("docs/other.md", "someone else\n"); return err(422, "Update is not a fast forward"); }
      if (patchMode === "fails_502") return err(502, "Bad Gateway");
      const c = commits.get(body.sha);
      if (!c) return err(422, "Object does not exist");
      if (c.parents[0] !== main) return err(422, "Update is not a fast forward");
      const before = trees.get(commits.get(main).tree);
      for (const [path, sha] of trees.get(c.tree)) if (before.get(path) !== sha && path.startsWith(".github/workflows/")) return err(404, "Resource not accessible by personal access token");
      main = body.sha;
      if (patchMode === "applies_502") return err(502, "Bad Gateway");
      if (patchMode === "applies_network") return HttpResponse.error();
      return HttpResponse.json({ ref: "refs/heads/main", object: { type: "commit", sha: main } });
    }
    if (method === "DELETE") { state.violations.push(`DELETE ${p}`); return err(405, "fake: DELETE is never used by Beach Day"); }
    return err(404, "Not Found");
  }
  return { handle, state, calls };
}

// =====================================================================================================
// One MSW server for all three hosts.
// =====================================================================================================
export function createUpstreams({ supabase, github, anthropic = createFakeAnthropic(), allowedLoopback = true } = {}) {
  const unexpected = [];
  const handlers = [
    http.post("https://api.anthropic.com/v1/messages", ({ request }) => anthropic.handle(request)),
    ...(github ? [http.all("https://api.github.com/*", ({ request }) => github.handle(request))] : []),
    ...(supabase ? [http.all(`${supabase.origin}/*`, async ({ request }) => {
      const res = await supabase.handle(request);
      return res.type === "error" ? HttpResponse.error() : res;
    })] : []),
    http.all("*", ({ request }) => { // catch-all, last: anything that is not one of the fakes above
      const u = new URL(request.url);
      if (allowedLoopback && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return passthrough(); // the harness calling itself
      unexpected.push(`${request.method} ${u.origin}${u.pathname}`);
      return HttpResponse.error(); // the request fails: no test can reach a real host
    }),
  ];
  const server = setupServer(...handlers);
  const api = {
    server, anthropic, github, supabase, unexpected,
    listen() {
      // MSW 3 renamed `onUnhandledRequest` to `onUnhandledFrame` and the old name is silently ignored (default "warn"),
      // and throwing from the callback does not fail the request. So unexpected hosts are caught by the LAST handler instead.
      server.listen({ onUnhandledFrame: "bypass" });
      return api;
    },
    resetHandlers() { server.resetHandlers(); },
    close() { server.close(); },
    reset() { server.resetHandlers(); anthropic.reset(); github?.state.reset(); unexpected.length = 0; },
  };
  return api;
}
