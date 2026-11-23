// WRITE GitHub module: ONE atomic multi-file commit to main via the Git Database API (ADR-0003, ADR-0005).
// Only the approve function imports this file. It loads GITHUB_TOKEN (never the read-token setting).
// Steps follow docs/04 §7 1–6 exactly: serial requests, base_tree ALWAYS, mode 100644 blobs with content
// (never a null blob sha, so no deletions), one parent, force:false, 6b retry once, 6c re-read on unknown outcome.
// The handler owns the lock, the CAS status changes, the cap and the audit; this module only talks to GitHub.
import { createGitHubRead, ghHeaders, GitHubError, GITHUB_API, OWNER, REPO, REQUEST_TIMEOUT_MS, type FetchLike, type GhOptions } from "./github-read.mts";
import { buildCommitMessage, commitAuthorName, COMMIT_AUTHOR_EMAIL, revalidate, type ProposalRecord } from "./proposals.mts";

/** Write-capable requester. It lives only here, so modules that import github-read can't build one (R2-5). */
function makeWriteRequester({ token, fetchImpl, signal, timeoutMs = REQUEST_TIMEOUT_MS }: GhOptions) {
  if (!token) throw new Error("GitHub token missing");
  const doFetch: FetchLike = fetchImpl ?? ((u, i) => fetch(u, i));
  return async function gh(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<any> {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let res: Response;
    try {
      res = await doFetch(`${GITHUB_API}/repos/${OWNER}/${REPO}${path}`, {
        method,
        headers: ghHeaders(token, body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch {
      throw new GitHubError(`GitHub ${method} unreachable`, null);
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError(`GitHub ${method} ${path.split("?")[0]} -> ${res.status}`, res.status, res.headers.get("retry-after"));
    return data;
  };
}

const SHA1 = /^[0-9a-f]{40}$/;

export type CommitOutcome =
  | { status: "committed"; commitSha: string; headSha: string }
  | { status: "stale"; path?: string; headSha?: string }
  | { status: "failed"; error: string; httpStatus: number | null; retryAfter: string | null }
  | { status: "unknown"; commitSha: string }; // 6c: every re-read failed; leave `committing`

export interface TreeEntry { path: string; mode: "100644"; type: "blob"; content: string }

/** The only tree entries approve can send: content blobs, mode 100644. No sha, so never a deletion. */
export function treeEntries(files: ProposalRecord["files"]): TreeEntry[] {
  return files.map((f) => {
    if (typeof f.content !== "string") throw new Error("tree entry without content");
    return { path: f.path, mode: "100644", type: "blob", content: f.content };
  });
}

/** User-safe text for a definite GitHub failure (never GitHub's body). */
export function githubFailureMessage(status: number | null): string {
  if (status === 401 || status === 403) return "GitHub refused the token. Rotate GITHUB_TOKEN (Contents read/write, this repo only).";
  if (status === 404) return "GitHub token can't see the repo.";
  if (status === 409 || status === 422) return "GitHub rejected the commit (possibly push protection or a conflict).";
  if (status === 429) return "GitHub is busy. Try again later.";
  return "GitHub failed while committing.";
}

export interface CommitDeps extends GhOptions { reReadTries?: number }

export function createGitHubWrite(opts: CommitDeps) {
  const gh = makeWriteRequester(opts);
  const reader = createGitHubRead(opts); // approve's own GETs (stale check, reconciler)
  const reReadTries = opts.reReadTries ?? 3;

  async function headSha(): Promise<string> {
    return reader.getMainSha();
  }

  /**
   * GET /compare/{commitSha}...{mainSha}: "ahead"/"identical" -> main contains our commit;
   * "behind"/"diverged" -> it doesn't; anything else or an error -> unclear.
   */
  async function ancestry(commitSha: string, mainSha: string): Promise<"contains" | "absent" | "unclear"> {
    try {
      const c = await gh("GET", `/compare/${commitSha}...${mainSha}`);
      if (c?.status === "ahead" || c?.status === "identical") return "contains";
      if (c?.status === "behind" || c?.status === "diverged") return "absent";
    } catch {
      /* unclear */
    }
    return "unclear";
  }

  /** Steps 1–5 then 6. `attempt` 2 is the single 6b retry. */
  async function commitOnce(p: ProposalRecord, attempt: number): Promise<CommitOutcome> {
    let head: string;
    let commitSha: string;
    try {
      // 1. head of main
      head = await headSha();
      // 2. stale check, touched files only. null readBlobSha: the file must not exist on main now.
      if (head !== p.baseSha) {
        for (const f of p.files) {
          const now = await reader.getBlobSha(f.path, head);
          if ((now ?? null) !== (f.readBlobSha ?? null)) return { status: "stale", path: f.path, headSha: head };
        }
      }
      // 3. tree of head
      const headCommit = await gh("GET", `/git/commits/${head}`);
      const baseTree = headCommit?.tree?.sha;
      if (typeof baseTree !== "string" || !SHA1.test(baseTree)) throw new GitHubError("GitHub commit: bad shape", 422);
      // 4. new tree ON TOP OF base_tree (omitting it deletes every other file)
      const tree = await gh("POST", "/git/trees", { base_tree: baseTree, tree: treeEntries(p.files) });
      if (typeof tree?.sha !== "string") throw new GitHubError("GitHub tree: bad shape", 422);
      // 5. commit, one parent, server-built message
      const commit = await gh("POST", "/git/commits", {
        message: buildCommitMessage(p.summary, p.id),
        tree: tree.sha,
        parents: [head],
        author: { name: commitAuthorName(p.agent), email: COMMIT_AUTHOR_EMAIL },
      });
      if (typeof commit?.sha !== "string" || !SHA1.test(commit.sha)) throw new GitHubError("GitHub commit: bad shape", 422);
      commitSha = commit.sha;
    } catch (e) {
      // 8. any failure in 1–5 is definite for the commit: nothing moved main.
      const status = e instanceof GitHubError ? e.status : null;
      return { status: "failed", error: githubFailureMessage(status), httpStatus: status, retryAfter: e instanceof GitHubError ? e.retryAfter : null };
    }

    // 6. fast-forward only
    try {
      await gh("PATCH", "/git/refs/heads/main", { sha: commitSha, force: false });
      return { status: "committed", commitSha, headSha: head }; // 6a
    } catch (e) {
      const ge = e instanceof GitHubError ? e : new GitHubError("unknown", null);
      if (ge.status === 422 || ge.status === 409) {
        // 6b: a definite "no" — main moved first. Redo 1–6 once, else stale.
        return attempt === 1 ? commitOnce(p, 2) : { status: "stale", headSha: head };
      }
      if (ge.definite) {
        return { status: "failed", error: githubFailureMessage(ge.status), httpStatus: ge.status, retryAfter: ge.retryAfter };
      }
      // 6c: unknown outcome (timeout, network, 5xx). Never assume failure: re-read main.
      let now: string | null = null;
      for (let i = 0; i < reReadTries && now === null; i++) {
        try {
          now = await headSha();
        } catch {
          /* try again, serially */
        }
      }
      if (now === null) return { status: "unknown", commitSha };
      if (now === commitSha) return { status: "committed", commitSha, headSha: head };
      // main moved on: did someone push on top of OUR commit? (docs/04 §7 6c, Rowan closing R2-S2)
      const anc = await ancestry(commitSha, now);
      if (anc === "contains") return { status: "committed", commitSha, headSha: head }; // step 7: it counts
      if (anc === "absent") return { status: "failed", error: "The commit did not reach main.", httpStatus: ge.status, retryAfter: null };
      return { status: "unknown", commitSha }; // unclear: stay committing, reconciler decides
    }
  }

  /** docs/04 §7 steps 1–6 for a proposal the handler has already moved to `committing`. */
  async function commitProposal(p: ProposalRecord): Promise<CommitOutcome> {
    if (p.status !== "committing") throw new Error("commitProposal needs a committing record");
    // Last hop before the write PAT (which can't be path-scoped): re-check policy even if a handler forgot (R2-S1).
    const v = revalidate(p);
    if (!v.ok) return { status: "failed", error: "The proposal failed its safety checks.", httpStatus: null, retryAfter: null };
    return commitOnce(p, 1);
  }

  return { commitProposal, reader };
}

export type GitHubWrite = ReturnType<typeof createGitHubWrite>;

/** Production wiring for approve only. Call after the production-context check. */
export function githubWriteFromEnv(extra: Omit<CommitDeps, "token"> = {}): GitHubWrite {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GitHub write token is not configured");
  return createGitHubWrite({ ...extra, token });
}
