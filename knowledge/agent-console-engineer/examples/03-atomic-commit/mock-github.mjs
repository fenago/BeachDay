// Local mock GitHub REST server for one repo. Keeps a tiny in-memory git (commits -> trees -> blobs),
// asserts the request headers on EVERY call, and records the call sequence.
import http from "node:http";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

export function startMockGitHub({ owner, repo, token, files }) {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const putBlob = (text) => { const id = sha("blob " + text); blobs.set(id, text); return id; };
  const putTree = (entries) => { const id = sha("tree " + JSON.stringify([...entries].sort())); trees.set(id, new Map(entries)); return id; };
  const rootTree = putTree(Object.entries(files).map(([p, t]) => [p, putBlob(t)]));
  let main = sha("commit root"); commits.set(main, { tree: rootTree, parents: [], message: "root" });

  const calls = [];
  const state = { failNextPatch: false, get main() { return main; }, commits, trees, blobs,
    pushConcurrent(path, text) { // simulate someone else pushing to main
      const t = new Map(trees.get(commits.get(main).tree)); t.set(path, putBlob(text));
      const tid = putTree([...t]); const c = sha("commit " + tid + main);
      commits.set(c, { tree: tid, parents: [main], message: "concurrent" }); main = c;
    } };

  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const ch of req) raw += ch;
    const body = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url, "http://x");
    calls.push(`${req.method} ${url.pathname.replace(`/repos/${owner}/${repo}`, "")}`);
    const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };

    // Header assertions (what GitHub expects; wrong token -> 401 like the real API).
    const h = req.headers;
    if (h.authorization !== `Bearer ${token}`) return send(401, { message: "Bad credentials" });
    if (h.accept !== "application/vnd.github+json") return send(400, { message: "mock: wrong Accept" });
    if (h["x-github-api-version"] !== "2022-11-28") return send(400, { message: "mock: missing/unsupported X-GitHub-Api-Version" });
    if (!h["user-agent"]) return send(403, { message: "mock: User-Agent required" });

    const p = url.pathname.replace(`/repos/${owner}/${repo}`, "");
    if (req.method === "GET" && p === "/git/ref/heads/main") return send(200, { ref: "refs/heads/main", object: { type: "commit", sha: main } });
    if (req.method === "GET" && p.startsWith("/git/commits/")) {
      const c = commits.get(p.split("/").pop()); if (!c) return send(404, { message: "Not Found" });
      return send(200, { sha: p.split("/").pop(), tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })), message: c.message });
    }
    if (req.method === "GET" && p.startsWith("/contents/")) {
      const path = decodeURIComponent(p.slice("/contents/".length));
      const ref = url.searchParams.get("ref") ?? main;
      const c = commits.get(ref === "main" ? main : ref); const blob = c && trees.get(c.tree).get(path);
      if (!blob) return send(404, { message: "Not Found" });
      return send(200, { type: "file", encoding: "base64", size: blobs.get(blob).length, name: path.split("/").pop(), path, sha: blob, content: Buffer.from(blobs.get(blob)).toString("base64") });
    }
    if (req.method === "POST" && p === "/git/trees") {
      if (!body.base_tree) return send(422, { message: "mock: base_tree is REQUIRED by Beach Day (omitting it deletes every other file)" });
      const base = trees.get(body.base_tree); if (!base) return send(404, { message: "Not Found" });
      const t = new Map(base);
      for (const e of body.tree) {
        if (e.mode !== "100644" || e.type !== "blob") return send(422, { message: "mock: only 100644 blobs allowed" });
        if (e.sha === null) t.delete(e.path); else t.set(e.path, putBlob(e.content));
      }
      return send(201, { sha: putTree([...t]) });
    }
    if (req.method === "POST" && p === "/git/commits") {
      if (!trees.has(body.tree) || body.parents?.length !== 1) return send(422, { message: "mock: bad commit" });
      const c = sha("commit " + body.tree + body.parents[0] + body.message);
      commits.set(c, { tree: body.tree, parents: body.parents, message: body.message, author: body.author });
      return send(201, { sha: c, tree: { sha: body.tree } });
    }
    if (req.method === "PATCH" && p === "/git/refs/heads/main") {
      if (body.force !== false) return send(400, { message: "mock: Beach Day always sends force:false" });
      if (state.failNextPatch) { state.failNextPatch = false; state.pushConcurrent("docs/other.md", "someone else\n"); }
      const c = commits.get(body.sha);
      if (!c || c.parents[0] !== main) return send(422, { message: "Update is not a fast forward" });
      main = body.sha; return send(200, { ref: "refs/heads/main", object: { sha: main } });
    }
    send(404, { message: "Not Found" });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}`, calls, state, close: () => server.close() })));
}
