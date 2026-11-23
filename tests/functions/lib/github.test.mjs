// GitHub read + write against an MSW fake GitHub (in-memory git). No network, no real token.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { setupServer } from "msw/node";
import { createFakeGitHub, blobSha } from "./support/fake-github.mjs";
import { createGitHubRead, githubReadFromEnv, ReadRefused, GITHUB_API } from "../../../netlify/functions/lib/github-read.mts";
import { createGitHubWrite, treeEntries } from "../../../netlify/functions/lib/github-write.mts";
import { buildCommitMessage, computeContentHash } from "../../../netlify/functions/lib/proposals.mts";

const TOKEN = ["github", "pat", "TESTONLY"].join("_");
const SEED = { "public/index.html": "<h1>Beach Day</h1>\n", "public/js/app.js": "export {}\n", "netlify.toml": "[build]\n", ".env": "X=1\n", "docs/a.md": "A\n" };
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let gh;
beforeEach(() => { gh = createFakeGitHub({ token: TOKEN, files: SEED }); server.use(...gh.handlers); });

const ID = "p_01JDQ8Z5K3M7N2P4R6S8T0V9WX";
function proposal(files, over = {}) {
  return { id: ID, agent: "pwa-mobile-engineer", status: "committing", createdAt: "2026-11-23T15:00:00.000Z", decidedAt: "2026-11-23T15:00:30.000Z", baseSha: gh.state.main, summary: "Add the NWS rip-current link to the footer", files, contentHash: computeContentHash(files), ...over };
}

describe("github-read (read-only, pinned)", () => {
  it("hard-codes api.github.com and has no write path", async () => {
    expect(GITHUB_API).toBe("https://api.github.com");
    const src = readFileSync(new URL("../../../netlify/functions/lib/github-read.mts", import.meta.url), "utf8");
    expect(src).not.toMatch(/"(POST|PATCH|PUT|DELETE)"/);
    expect(src).not.toMatch(/allowWrite|makeRequester/);
    expect(src).not.toMatch(/GITHUB_TOKEN|GITHUB_READ_TOKEN/); // token name comes only from SETTINGS (D2)
    const wsrc = readFileSync(new URL("../../../netlify/functions/lib/github-write.mts", import.meta.url), "utf8");
    expect(wsrc).not.toMatch(/GITHUB_READ_TOKEN|githubReadTokenEnv/);
    expect(wsrc).not.toMatch(/sha:\s*null/);
  });
  it("runtime: no github-read export can send a non-GET request", async () => {
    const mod = await import("../../../netlify/functions/lib/github-read.mts");
    expect(Object.keys(mod).sort()).toEqual(["API_VERSION", "GITHUB_API", "GitHubError", "OWNER", "REPO", "REQUEST_TIMEOUT_MS", "ReadRefused", "USER_AGENT", "createGitHubRead", "ghHeaders", "githubReadFromEnv"]);
    const methods = [];
    const spy = (url, init) => { methods.push(init?.method); return fetch(url, init); };
    const r = mod.createGitHubRead({ token: TOKEN, fetchImpl: spy });
    const sha = await r.getMainSha();
    await r.getBlobSha("docs/a.md", sha); await r.readFile("docs/a.md", sha); await r.listDir("", sha);
    await r.listMainCommitsSince("2026-01-01T00:00:00Z"); await r.findProposalCommit(proposal([{ path: "docs/a.md", content: "A\n", readBlobSha: null }]));
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    for (const fn of Object.values(r)) expect(fn.length).toBeLessThanOrEqual(2); // no method/body parameter anywhere
    expect(gh.state.calls.every((c) => c.startsWith("GET "))).toBe(true);
  });
  it("reads text + blob sha at a pinned commit; 404 -> null; refuses secrets files, binaries, non-UTF-8, >200 KB", async () => {
    const r = createGitHubRead({ token: TOKEN });
    const sha = await r.getMainSha();
    expect(sha).toBe(gh.state.main);
    const f = await r.readFile("public/index.html", sha);
    expect(f).toMatchObject({ text: SEED["public/index.html"], sha: blobSha(SEED["public/index.html"]) });
    expect(await r.readFile("public/missing.html", sha)).toBeNull();
    await expect(r.readFile(".env", sha)).rejects.toBeInstanceOf(ReadRefused);
    await expect(r.readFile("a/../netlify.toml", sha)).rejects.toBeInstanceOf(ReadRefused);
    gh.state.putRawBlob("public/img.svg", Buffer.from([0x3c, 0x00, 0x3e]));
    gh.state.putRawBlob("docs/latin1.md", Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    gh.state.putRawBlob("docs/big.md", Buffer.alloc(200 * 1024 + 1, 0x61));
    const s2 = await r.getMainSha();
    await expect(r.readFile("public/img.svg", s2)).rejects.toThrow(/binary/);
    await expect(r.readFile("docs/latin1.md", s2)).rejects.toThrow(/UTF-8/);
    await expect(r.readFile("docs/big.md", s2)).rejects.toThrow(/200 KB/);
    await expect(r.readFile("public/index.html", "main")).rejects.toThrow(/pinned/);
  });
  it("lists a directory and hides denied entries; the root is listable", async () => {
    const r = createGitHubRead({ token: TOKEN });
    const sha = await r.getMainSha();
    expect((await r.listDir("", sha)).map((e) => e.path).sort()).toEqual(["docs", "netlify.toml", "public"]);
    expect((await r.listDir("public", sha)).map((e) => `${e.path}:${e.type}`)).toEqual(["public/index.html:file", "public/js:dir"]);
    await expect(r.listDir(".git", sha)).rejects.toBeInstanceOf(ReadRefused);
  });
  it("sends the required headers; a wrong token surfaces as 401", async () => {
    await expect(createGitHubRead({ token: "wrong" }).getMainSha()).rejects.toMatchObject({ status: 401 });
  });
  it("githubReadFromEnv fails closed with no token and never falls back", () => {
    const keep = process.env.GITHUB_TOKEN; delete process.env.GITHUB_TOKEN;
    try { expect(() => githubReadFromEnv()).toThrow(/not configured/); } finally { if (keep !== undefined) process.env.GITHUB_TOKEN = keep; }
  });
});

describe("github-write: one atomic commit (docs/04 §7)", () => {
  it("exact serial sequence, base_tree always, 100644 content blobs, one parent, force:false, trailer last", async () => {
    const r = createGitHubRead({ token: TOKEN });
    const base = gh.state.main;
    const idx = await r.readFile("public/index.html", base);
    gh.state.calls.length = 0;
    const p = proposal([{ path: "public/index.html", content: "<h1>Beach Day</h1>\n<a href=\"https://www.weather.gov/beach/mfl\">NWS</a>\n", readBlobSha: idx.sha }, { path: "docs/new.md", content: "new\n", readBlobSha: null }]);
    const out = await createGitHubWrite({ token: TOKEN }).commitProposal(p);
    expect(out.status).toBe("committed");
    expect(gh.state.calls).toEqual(["GET /git/ref/heads/main", `GET /git/commits/${base}`, "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/main"]);
    const tree = gh.state.bodies.find(([k]) => k === "POST /git/trees")[1];
    expect(typeof tree.base_tree).toBe("string");
    for (const e of tree.tree) { expect(e).toEqual({ path: e.path, mode: "100644", type: "blob", content: e.content }); expect("sha" in e).toBe(false); }
    const commit = gh.state.bodies.find(([k]) => k === "POST /git/commits")[1];
    expect(commit.parents).toEqual([base]);
    expect(commit.author.name).toBe("Beach Day Agent (pwa-mobile-engineer)");
    expect(commit.message).toBe(buildCommitMessage(p.summary, ID));
    expect(gh.state.bodies.find(([k]) => k.startsWith("PATCH"))[1]).toEqual({ sha: out.commitSha, force: false });
    expect(gh.state.main).toBe(out.commitSha);
    expect(gh.state.fileAt("netlify.toml")).toBe("[build]\n"); // untouched files survive
    expect(gh.state.fileAt("docs/new.md")).toBe("new\n");
  });
  it("main moved but touched files unchanged -> commits on the new head", async () => {
    const base = gh.state.main;
    gh.state.push("docs/other.md", "x\n");
    const out = await createGitHubWrite({ token: TOKEN }).commitProposal(proposal([{ path: "public/index.html", content: "y\n", readBlobSha: blobSha(SEED["public/index.html"]) }], { baseSha: base }));
    expect(out.status).toBe("committed");
    expect(out.headSha).not.toBe(base);
  });
  it("touched file changed, or an unread file now exists -> stale, nothing written", async () => {
    const base = gh.state.main;
    gh.state.push("public/index.html", "<h1>human edit</h1>\n");
    gh.state.push("docs/new.md", "someone made it\n");
    for (const f of [{ path: "public/index.html", content: "z\n", readBlobSha: blobSha(SEED["public/index.html"]) }, { path: "docs/new.md", content: "n\n", readBlobSha: null }]) {
      gh.state.calls.length = 0;
      const out = await createGitHubWrite({ token: TOKEN }).commitProposal(proposal([f], { baseSha: base }));
      expect(out).toMatchObject({ status: "stale", path: f.path });
      expect(gh.state.calls.some((c) => /^(POST|PATCH)/.test(c))).toBe(false);
    }
  });
  it("6b: not fast-forward -> redo 1–6 once; twice -> stale", async () => {
    gh.state.failNextPatch = true;
    const p = proposal([{ path: "public/index.html", content: "y\n", readBlobSha: blobSha(SEED["public/index.html"]) }]);
    const out = await createGitHubWrite({ token: TOKEN }).commitProposal(p);
    expect(out.status).toBe("committed");
    expect(gh.state.calls.filter((c) => c.startsWith("PATCH"))).toHaveLength(2);
    expect(gh.state.fileAt("docs/other.md")).toBe("someone else\n");
  });
  it("6c: unknown PATCH outcome -> re-read main: landed => committed, not landed => failed, all re-reads fail => unknown", async () => {
    const f = () => [{ path: "docs/a.md", content: "A2\n", readBlobSha: blobSha("A\n") }];
    gh.state.patchUnknown = "landed";
    const a = await createGitHubWrite({ token: TOKEN }).commitProposal(proposal(f()));
    expect(a.status).toBe("committed");
    expect(gh.state.main).toBe(a.commitSha);

    gh.state.patchUnknown = "not_landed";
    const b = await createGitHubWrite({ token: TOKEN }).commitProposal(proposal([{ path: "docs/a.md", content: "A3\n", readBlobSha: blobSha("A2\n") }]));
    expect(b).toMatchObject({ status: "failed", error: "The commit did not reach main." });

    // Unknown outcome AND every re-read fails: the step-1 ref read passes, the 6c re-reads hit a network error.
    gh.state.patchUnknown = "landed";
    const p2 = proposal([{ path: "docs/a.md", content: "A5\n", readBlobSha: blobSha("A2\n") }]);
    let reads = 0;
    const flaky = (url, init) => (String(url).endsWith("/git/ref/heads/main") && reads++ >= 1 ? Promise.reject(new TypeError("network down")) : fetch(url, init));
    const c = await createGitHubWrite({ token: TOKEN, fetchImpl: flaky }).commitProposal(p2);
    expect(c.status).toBe("unknown");
    expect(c.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(reads).toBe(4); // step 1 + 3 serial re-reads
  });
  it("definite failures in steps 1–5 -> failed with user-safe text (no GitHub body)", async () => {
    gh.state.failPostTrees = 403;
    const out = await createGitHubWrite({ token: TOKEN }).commitProposal(proposal([{ path: "docs/a.md", content: "B\n", readBlobSha: blobSha("A\n") }]));
    expect(out).toMatchObject({ status: "failed", httpStatus: 403 });
    expect(out.error).not.toContain("nope");
    expect(gh.state.calls.some((c) => c.startsWith("PATCH"))).toBe(false);
  });
  it("re-validates the record itself before any write (R2-S1)", async () => {
    const files = [{ path: "netlify/functions/approve.mts", content: "x\n", readBlobSha: null }];
    gh.state.calls.length = 0;
    const out = await createGitHubWrite({ token: TOKEN }).commitProposal(proposal(files));
    expect(out).toMatchObject({ status: "failed" });
    expect(gh.state.calls).toEqual([]);
  });
  it("refuses a record that is not committing; treeEntries never emits sha", async () => {
    await expect(createGitHubWrite({ token: TOKEN }).commitProposal(proposal([], { status: "pending" }))).rejects.toThrow();
    expect(treeEntries([{ path: "a", content: "b", readBlobSha: null }])).toEqual([{ path: "a", mode: "100644", type: "blob", content: "b" }]);
    expect(() => treeEntries([{ path: "a", content: undefined }])).toThrow();
  });
});

describe("reconciler search (read-only)", () => {
  it("finds the proposal commit; ignores near-misses; not_found when the page isn't full; unknown when it is", async () => {
    const files = [{ path: "docs/a.md", content: "R\n", readBlobSha: blobSha("A\n") }];
    const p = proposal(files);
    const r = createGitHubRead({ token: TOKEN });
    expect((await r.findProposalCommit(p)).verdict).toBe("not_found");
    // near-misses: human author with the trailer; right author, wrong content
    gh.state.addCommit({ message: buildCommitMessage("x".repeat(25), ID), author: "Dr. Lee", files: { "docs/a.md": "R\n" } });
    gh.state.addCommit({ message: buildCommitMessage("x".repeat(25), ID), author: "Beach Day Agent (pwa-mobile-engineer)", files: { "docs/a.md": "other\n" } });
    expect((await r.findProposalCommit(p)).verdict).toBe("not_found");
    const real = gh.state.addCommit({ message: buildCommitMessage(p.summary, ID), author: "Beach Day Agent (pwa-mobile-engineer)", files: { "docs/a.md": "R\n" } });
    expect(await r.findProposalCommit(p)).toEqual({ verdict: "found", commitSha: real });
    expect((await r.findProposalCommit({ ...p, id: "p_" + "Z".repeat(26) }, 3)).verdict).toBe("unknown"); // full page of 3
    gh.state.failRefReads = 0;
  });
});
