// MSW fake of the GitHub REST endpoints the Console uses, backed by a tiny in-memory git.
// Asserts the required headers on EVERY call (401 wrong token, 400 missing Accept/version, 403 no UA),
// enforces base_tree + 100644 content blobs on POST /git/trees, force:false + fast-forward on PATCH,
// and records the call sequence so tests can assert the exact order.
import { http, HttpResponse } from "msw";
import { createHash } from "node:crypto";

export const OWNER = "fenago";
export const REPO = "BeachDay";
const BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
export const blobSha = (text) => {
  const b = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
};

export function createFakeGitHub({ token, files }) {
  const blobs = new Map(); // sha -> Buffer
  const trees = new Map(); // sha -> Map(path -> blobSha)
  const commits = new Map(); // sha -> {tree, parents, message, author, date}
  let clock = Date.parse("2026-11-23T15:00:00Z");
  const putBlob = (text) => { const b = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"); const id = createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); blobs.set(id, b); return id; };
  const putTree = (entries) => { const id = sha1("tree " + JSON.stringify([...entries].sort())); trees.set(id, new Map(entries)); return id; };
  const putCommit = (c) => { const id = sha1("commit " + JSON.stringify(c) + Math.random()); commits.set(id, { ...c, date: new Date(clock += 1000).toISOString() }); return id; };
  let main = putCommit({ tree: putTree(Object.entries(files).map(([p, t]) => [p, putBlob(t)])), parents: [], message: "root", author: { name: "Dr. Lee" } });

  const calls = [];
  const bodies = [];
  const state = {
    calls, bodies, commits, trees, blobs,
    get main() { return main; },
    failNextPatch: false,        // someone pushes first -> 422 not fast-forward
    patchUnknown: null,          // "landed" | "not_landed": PATCH answers 502 after (maybe) moving main
    failRefReads: 0,             // next N GET ref calls answer 503
    failPostTrees: null,         // status for POST /git/trees (e.g. 403)
    push(path, text, { message = "human", author = "Dr. Lee" } = {}) {
      const t = new Map(trees.get(commits.get(main).tree)); t.set(path, putBlob(text));
      main = putCommit({ tree: putTree([...t]), parents: [main], message, author: { name: author } });
      return main;
    },
    addCommit({ message, author, parents, files: fs }) { // a commit object on main with explicit fields
      const t = new Map(trees.get(commits.get(main).tree)); for (const [p, c] of Object.entries(fs ?? {})) t.set(p, putBlob(c));
      main = putCommit({ tree: putTree([...t]), parents: parents ?? [main], message, author: { name: author } });
      return main;
    },
    fileAt(path, ref = main) { const b = trees.get(commits.get(ref).tree).get(path); return b ? blobs.get(b).toString("utf8") : undefined; },
    putRawBlob(path, buf) { const t = new Map(trees.get(commits.get(main).tree)); t.set(path, putBlob(buf)); main = putCommit({ tree: putTree([...t]), parents: [main], message: "raw", author: { name: "x" } }); },
  };

  const check = (request) => {
    const h = request.headers;
    if (h.get("authorization") !== `Bearer ${token}`) return HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
    if (h.get("accept") !== "application/vnd.github+json") return HttpResponse.json({ message: "mock: wrong Accept" }, { status: 400 });
    if (h.get("x-github-api-version") !== "2022-11-28") return HttpResponse.json({ message: "mock: api version" }, { status: 400 });
    if (!h.get("user-agent")) return HttpResponse.json({ message: "mock: User-Agent required" }, { status: 403 });
    return null;
  };
  const rec = (request) => { const u = new URL(request.url); calls.push(`${request.method} ${u.pathname.replace(`/repos/${OWNER}/${REPO}`, "")}`); };

  const handlers = [
    http.get(`${BASE}/git/ref/heads/main`, ({ request }) => {
      rec(request); const bad = check(request); if (bad) return bad;
      if (state.failRefReads > 0) { state.failRefReads--; return HttpResponse.json({ message: "down" }, { status: 503 }); }
      return HttpResponse.json({ ref: "refs/heads/main", object: { type: "commit", sha: main } });
    }),
    http.get(`${BASE}/git/commits/:sha`, ({ request, params }) => {
      rec(request); const bad = check(request); if (bad) return bad;
      const c = commits.get(params.sha); if (!c) return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      return HttpResponse.json({ sha: params.sha, tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })), message: c.message });
    }),
    http.get(`${BASE}/contents/*`, ({ request }) => {
      rec(request); const bad = check(request); if (bad) return bad;
      const u = new URL(request.url);
      const path = decodeURIComponent(u.pathname.split("/contents/")[1] ?? "");
      const ref = u.searchParams.get("ref") ?? main;
      const c = commits.get(ref === "main" ? main : ref); if (!c) return HttpResponse.json({ message: "No commit found" }, { status: 404 });
      const tree = trees.get(c.tree);
      const b = tree.get(path);
      if (b) {
        const buf = blobs.get(b);
        const big = buf.length > 1024 * 1024;
        return HttpResponse.json({ type: "file", encoding: big ? "none" : "base64", size: buf.length, name: path.split("/").pop(), path, sha: b, content: big ? "" : buf.toString("base64") });
      }
      const prefix = path === "" ? "" : path + "/";
      const kids = new Map();
      for (const p of tree.keys()) if (p.startsWith(prefix)) { const rest = p.slice(prefix.length); const [first, ...more] = rest.split("/"); kids.set(first, more.length ? "dir" : "file"); }
      if (!kids.size) return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      return HttpResponse.json([...kids].map(([name, type]) => ({ name, path: prefix + name, type })));
    }),
    http.get(`${BASE}/commits`, ({ request }) => {
      rec(request); const bad = check(request); if (bad) return bad;
      const u = new URL(request.url);
      const since = Date.parse(u.searchParams.get("since") ?? "1970-01-01T00:00:00Z");
      const per = Number(u.searchParams.get("per_page") ?? 30);
      const out = [];
      for (let s = main; s && out.length < per; s = commits.get(s).parents[0]) {
        const c = commits.get(s); if (Date.parse(c.date) < since) break;
        out.push({ sha: s, commit: { message: c.message, author: { name: c.author?.name, date: c.date } }, parents: c.parents.map((p) => ({ sha: p })) });
      }
      return HttpResponse.json(out);
    }),
    http.post(`${BASE}/git/trees`, async ({ request }) => {
      rec(request); const bad = check(request); if (bad) return bad;
      const body = await request.json(); bodies.push(["POST /git/trees", body]);
      if (state.failPostTrees) return HttpResponse.json({ message: "nope" }, { status: state.failPostTrees });
      if (!body.base_tree) return HttpResponse.json({ message: "mock: base_tree REQUIRED" }, { status: 422 });
      const base = trees.get(body.base_tree); if (!base) return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      const t = new Map(base);
      for (const e of body.tree) {
        if (e.mode !== "100644" || e.type !== "blob" || typeof e.content !== "string" || "sha" in e) return HttpResponse.json({ message: "mock: only 100644 content blobs" }, { status: 422 });
        t.set(e.path, putBlob(e.content));
      }
      return HttpResponse.json({ sha: putTree([...t]) }, { status: 201 });
    }),
    http.post(`${BASE}/git/commits`, async ({ request }) => {
      rec(request); const bad = check(request); if (bad) return bad;
      const body = await request.json(); bodies.push(["POST /git/commits", body]);
      if (!trees.has(body.tree) || body.parents?.length !== 1) return HttpResponse.json({ message: "mock: bad commit" }, { status: 422 });
      const id = putCommit({ tree: body.tree, parents: body.parents, message: body.message, author: body.author });
      return HttpResponse.json({ sha: id, tree: { sha: body.tree } }, { status: 201 });
    }),
    http.patch(`${BASE}/git/refs/heads/main`, async ({ request }) => {
      rec(request); const bad = check(request); if (bad) return bad;
      const body = await request.json(); bodies.push(["PATCH /git/refs/heads/main", body]);
      if (body.force !== false) return HttpResponse.json({ message: "mock: force must be false" }, { status: 400 });
      if (state.failNextPatch) { state.failNextPatch = false; state.push("docs/other.md", "someone else\n"); }
      const c = commits.get(body.sha);
      if (!c || c.parents[0] !== main) return HttpResponse.json({ message: "Update is not a fast forward" }, { status: 422 });
      if (state.patchUnknown) { const mode = state.patchUnknown; state.patchUnknown = null; if (mode === "landed") main = body.sha; return HttpResponse.json({ message: "upstream" }, { status: 502 }); }
      main = body.sha;
      return HttpResponse.json({ ref: "refs/heads/main", object: { sha: main } });
    }),
  ];
  return { handlers, state };
}
