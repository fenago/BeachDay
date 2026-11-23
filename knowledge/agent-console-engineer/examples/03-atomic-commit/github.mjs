// lib/github shape for Beach Day: read a file (Contents API) and write ONE atomic multi-file
// commit to main (Git Database API). Plain fetch, no SDK. Requests are made serially.
// Docs: https://docs.github.com/en/rest/git/refs · /git/commits · /git/trees · /repos/contents

const API_VERSION = "2022-11-28"; // supported until 2028-03-10; 2026-03-10 exists — read its changelog before switching

export function makeGitHub({ token, owner, repo, baseUrl = "https://api.github.com", fetchImpl = fetch }) {
  if (!token) throw new Error("GITHUB_TOKEN missing (Production context only)");

  async function gh(method, path, body) {
    const res = await fetchImpl(`${baseUrl}/repos/${owner}/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": "beach-day-console",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path} -> ${res.status}: ${data?.message ?? ""}`);
      err.status = res.status;
      err.retryAfter = res.headers.get("retry-after");
      err.data = data;
      throw err;
    }
    return data;
  }

  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

  /** GET /repos/{owner}/{repo}/contents/{path}?ref= — text file + blob sha (needed for stale checks). */
  async function getFile(path, ref = "main") {
    try {
      const d = await gh("GET", `/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
      if (Array.isArray(d) || d.type !== "file") throw Object.assign(new Error("not a file"), { status: 422 });
      // Files up to 1 MB come back base64 in `content`; larger ones need the raw media type.
      if (d.encoding !== "base64") throw Object.assign(new Error("file too large for JSON contents"), { status: 413 });
      return { path: d.path, sha: d.sha, text: Buffer.from(d.content, "base64").toString("utf8") };
    } catch (e) {
      if (e.status === 404) return null; // new file
      throw e;
    }
  }

  /**
   * One atomic commit for N files.
   * files: [{path, content, readSha}]  readSha = blob sha the agent saw (null for new files)
   */
  async function commitFiles({ files, message, agent, baseSha, attempt = 1 }) {
    // 1. Current head of main.
    const ref = await gh("GET", "/git/ref/heads/main");
    const headSha = ref.object.sha;

    // 2. Stale-base check: main moved since the proposal was made -> compare the touched files only.
    if (headSha !== baseSha) {
      for (const f of files) {
        const now = await getFile(f.path, headSha);
        if ((now?.sha ?? null) !== (f.readSha ?? null)) return { status: "stale", path: f.path, headSha };
      }
    }

    // 3. Tree of the head commit.
    const head = await gh("GET", `/git/commits/${headSha}`);

    // 4. New tree ON TOP OF base_tree (omitting base_tree would delete every other file).
    const tree = await gh("POST", "/git/trees", {
      base_tree: head.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
    });

    // 5. Commit with exactly one parent.
    const commit = await gh("POST", "/git/commits", {
      message,
      tree: tree.sha,
      parents: [headSha],
      author: { name: `Beach Day Agent (${agent})`, email: "agent@beachday.invalid" },
    });

    // 6. Fast-forward main only. A concurrent push makes this fail; retry the whole thing once.
    try {
      await gh("PATCH", "/git/refs/heads/main", { sha: commit.sha, force: false });
    } catch (e) {
      if ((e.status === 422 || e.status === 409) && attempt === 1) {
        return commitFiles({ files, message, agent, baseSha, attempt: 2 });
      }
      if (e.status === 422 || e.status === 409) return { status: "stale", headSha };
      throw e;
    }
    return { status: "committed", commitSha: commit.sha, parent: headSha };
  }

  return { getFile, commitFiles };
}
