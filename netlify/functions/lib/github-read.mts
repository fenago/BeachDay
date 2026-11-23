// READ-ONLY GitHub module (ADR-0007; D2 / ADR-0009 Proposed). It has NO write methods: its request
// function refuses any method but GET. Used by chat/job-run (read_file, list_files, pinning main) and by
// GET /api/proposals/:id (the reconciler). The token comes from SETTINGS.githubReadTokenEnv, read only
// in githubReadFromEnv(), which handlers call AFTER the production-context check. No fallback token.
// Docs: knowledge/agent-console-engineer/docs/05, 06; github-repo-workflow skill.
import { SETTINGS } from "./settings.mts";
import { checkReadDir, checkReadPath, isReadable, MAX_FILE_BYTES } from "./allowlist.mts";
import { hasFinalTrailer, isProposalCommit, commitAuthorName, type CandidateCommit, type ProposalRecord, type ReconcileVerdict } from "./proposals.mts";

export const GITHUB_API = "https://api.github.com"; // hard-coded: no env var may redirect it
export const OWNER = "fenago";
export const REPO = "BeachDay";
export const API_VERSION = "2022-11-28"; // supported until 2028-03-10; read the 2026-03-10 changelog before switching
export const USER_AGENT = "beach-day-console";
export const REQUEST_TIMEOUT_MS = 10_000;
const SHA1 = /^[0-9a-f]{40}$/;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A GitHub failure. `definite` = GitHub answered (a status); otherwise network/timeout (outcome unknown). */
export class GitHubError extends Error {
  status: number | null;
  retryAfter: string | null;
  definite: boolean;
  constructor(message: string, status: number | null, retryAfter: string | null = null) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.definite = status !== null && status < 500;
  }
}

/** Not an upstream failure: the tool input or file is refused. Message is agent-safe. */
export class ReadRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadRefused";
  }
}

export interface GhOptions { token: string; fetchImpl?: FetchLike; signal?: AbortSignal; timeoutMs?: number }

export function ghHeaders(token: string, withBody: boolean): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": API_VERSION,
    "user-agent": USER_AGENT,
    ...(withBody ? { "content-type": "application/json" } : {}),
  };
}

/** Low-level request used by both modules. `allowWrite` is false in this module, always. */
export function makeRequester({ token, fetchImpl, signal, timeoutMs = REQUEST_TIMEOUT_MS }: GhOptions, allowWrite: boolean) {
  if (!token) throw new Error("GitHub token missing");
  const doFetch: FetchLike = fetchImpl ?? ((u, i) => fetch(u, i));
  return async function gh(method: string, path: string, body?: unknown): Promise<any> {
    if (method !== "GET" && !allowWrite) throw new Error("read-only GitHub module");
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
    if (!res.ok) {
      // Never keep GitHub's body text in the message: it goes to logs; callers map status to user copy.
      throw new GitHubError(`GitHub ${method} ${path.split("?")[0]} -> ${res.status}`, res.status, res.headers.get("retry-after"));
    }
    return data;
  };
}

const encPath = (p: string): string => p.split("/").map(encodeURIComponent).join("/");
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface RepoFile { path: string; sha: string; text: string; size: number }
export interface DirEntry { name: string; path: string; type: "file" | "dir" }

export function createGitHubRead(opts: GhOptions) {
  const gh = makeRequester(opts, false);

  async function getMainSha(): Promise<string> {
    const ref = await gh("GET", "/git/ref/heads/main");
    const sha = ref?.object?.sha;
    if (typeof sha !== "string" || !SHA1.test(sha)) throw new GitHubError("GitHub ref: bad shape", 502);
    return sha;
  }

  /** Raw contents entry, or null on 404. No path policy here (callers decide). */
  async function getContents(path: string, ref: string): Promise<any | null> {
    try {
      return await gh("GET", `/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /** Blob SHA of `path` at `ref`, or null if absent. Works for any size (no decoding). */
  async function getBlobSha(path: string, ref: string): Promise<string | null> {
    const d = await getContents(path, ref);
    if (d === null) return null;
    if (Array.isArray(d) || d?.type !== "file" || typeof d.sha !== "string") return "not-a-file";
    return d.sha;
  }

  /** read_file: policy-checked, UTF-8 text only, at most 200 KB. Null when the file doesn't exist. */
  async function readFile(path: string, ref: string): Promise<RepoFile | null> {
    const why = checkReadPath(path);
    if (why) throw new ReadRefused(`can't read ${JSON.stringify(path).slice(0, 210)}: ${why}`);
    if (!SHA1.test(ref)) throw new Error("readFile needs a pinned commit SHA");
    const d = await getContents(path, ref);
    if (d === null) return null;
    if (Array.isArray(d) || d.type !== "file") throw new ReadRefused(`${path} is not a file`);
    if (typeof d.size === "number" && d.size > MAX_FILE_BYTES) throw new ReadRefused(`${path} is larger than 200 KB`);
    if (d.encoding !== "base64" || typeof d.content !== "string") throw new ReadRefused(`${path} is too large to read`);
    const bytes = Buffer.from(d.content, "base64");
    if (bytes.length > MAX_FILE_BYTES) throw new ReadRefused(`${path} is larger than 200 KB`);
    if (bytes.includes(0)) throw new ReadRefused(`${path} is binary`);
    let text: string;
    try {
      text = utf8.decode(bytes);
    } catch {
      throw new ReadRefused(`${path} is not UTF-8 text`);
    }
    return { path, sha: d.sha, text, size: bytes.length };
  }

  /** list_files: entries directly inside `dir` ("" = root), denied paths hidden. */
  async function listDir(dir: string, ref: string): Promise<DirEntry[] | null> {
    const why = checkReadDir(dir);
    if (why) throw new ReadRefused(`can't list ${JSON.stringify(dir).slice(0, 210)}: ${why}`);
    if (!SHA1.test(ref)) throw new Error("listDir needs a pinned commit SHA");
    const d = await getContents(dir, ref);
    if (d === null) return null;
    if (!Array.isArray(d)) throw new ReadRefused(`${dir} is not a directory`);
    return d
      .filter((e: any) => typeof e?.path === "string" && isReadable(e.path))
      .map((e: any) => ({ name: String(e.name), path: String(e.path), type: e.type === "dir" ? "dir" : "file" }) as DirEntry);
  }

  /** GET /commits?sha=main&since=…&per_page=50, mapped to the reconciler's candidate shape. */
  async function listMainCommitsSince(sinceIso: string, perPage = 50): Promise<CandidateCommit[]> {
    const q = `?sha=main&since=${encodeURIComponent(sinceIso)}&per_page=${perPage}`;
    const list = await gh("GET", `/commits${q}`);
    if (!Array.isArray(list)) throw new GitHubError("GitHub commits: bad shape", 502);
    return list.map((c: any) => ({
      sha: String(c?.sha ?? ""),
      message: String(c?.commit?.message ?? ""),
      authorName: String(c?.commit?.author?.name ?? ""),
      parents: Array.isArray(c?.parents) ? c.parents.map((p: any) => String(p?.sha ?? "")) : [],
    }));
  }

  /**
   * Reconciler search (docs/04 §7). Reads only. Returns found / not_found / unknown, or throws GitHubError
   * when GitHub is unreachable (caller leaves the record `committing`).
   */
  async function findProposalCommit(proposal: Pick<ProposalRecord, "id" | "agent" | "files" | "decidedAt">, perPage = 50): Promise<ReconcileVerdict> {
    const decided = Date.parse(proposal.decidedAt ?? "");
    if (!Number.isFinite(decided)) return { verdict: "unknown" };
    const since = new Date(decided - 5 * 60_000).toISOString();
    const commits = await listMainCommitsSince(since, perPage);
    for (const c of commits) {
      // Cheap filters first; blob reads (≤20, serial) only for a real candidate.
      if (!hasFinalTrailer(c.message, proposal.id) || c.authorName !== commitAuthorName(proposal.agent) || c.parents.length !== 1) continue;
      const blobs: Record<string, string | null> = {};
      for (const f of proposal.files) blobs[f.path] = await getBlobSha(f.path, c.sha);
      if (isProposalCommit({ ...c, blobs }, proposal)) return { verdict: "found", commitSha: c.sha };
      console.warn("reconcile_candidate_ignored", { proposalId: proposal.id, sha: c.sha });
    }
    return commits.length >= perPage ? { verdict: "unknown" } : { verdict: "not_found" };
  }

  return { getMainSha, getBlobSha, readFile, listDir, listMainCommitsSince, findProposalCommit };
}

export type GitHubRead = ReturnType<typeof createGitHubRead>;

/** Production wiring. Call only after context.deploy.context === "production". Fails closed, no fallback. */
export function githubReadFromEnv(extra: Omit<GhOptions, "token"> = {}): GitHubRead {
  const token = process.env[SETTINGS.githubReadTokenEnv];
  if (!token) throw new Error("GitHub read token is not configured");
  return createGitHubRead({ ...extra, token });
}
