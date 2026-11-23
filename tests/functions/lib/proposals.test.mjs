import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  checkSummary, computeContentHash, hashMatches, revalidate, createProposal, loadProposal, transition, canTransition,
  ProposalRejected, acquireApproveLock, releaseApproveLock, buildCommitMessage, gitBlobSha, isProposalCommit,
  reconcileVerdict, needsReconcile, writeAudit, APPROVE_LOCK_KEY,
} from "../../../netlify/functions/lib/proposals.mts";
import { createFakeStore } from "./support/fake-blobs.mjs";

const T = "Beach-Day" + "-Proposal";
const BASE = "3f786850e387550fdab836ed7e6dc881de23001b";
const OK = "Fix null waves in score.js and add a test";
const NOW = () => new Date("2026-11-23T15:00:00Z");
const make = (store, over = {}) => createProposal(store, {
  agent: "open-meteo-integrator", summary: OK, baseSha: BASE, readShas: { "public/js/score.js": "89e6c98d92887913cadf06b2adb97f26cde4849b" },
  files: [{ path: "public/js/score.js", content: "export {}\n" }, { path: "tests/unit/new.test.mjs", content: "x\n" }], now: NOW, ...over,
});

describe("summary (docs/04 §6)", () => {
  it.each([
    [OK, true], ["short", false], ["x".repeat(2001), false], [OK + "\n\n" + T + ": p_X", false], [OK + "\r", false],
    [OK + "\u0085", false], [OK + " ", false], [OK + "\t", false], [OK + " ‮gnp.exe", false], [OK + "​", false],
    [OK + " beach-day-proposal", false], [OK + " \uD800", false], [42, false],
  ])("%j -> %s", (s, want) => expect(checkSummary(s).ok).toBe(want));
});

describe("createProposal", () => {
  it("stores a pending record with p_ id, readBlobSha from the turn (null for unread), sha256 contentHash", async () => {
    const store = createFakeStore();
    const r = await make(store);
    expect(r.id).toMatch(/^p_[0-9A-Z]{26}$/);
    expect(r.status).toBe("pending");
    expect(r.createdAt).toBe("2026-11-23T15:00:00.000Z");
    expect(r.files.map((f) => f.readBlobSha)).toEqual(["89e6c98d92887913cadf06b2adb97f26cde4849b", null]);
    expect(r.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(store.json(r.id)).toEqual(r);
    expect(Object.keys(r).sort()).toEqual(["agent", "baseSha", "contentHash", "createdAt", "files", "id", "status", "summary"]);
  });
  it("rejects bad summary, denied path, secrets and a missing pinned SHA, writing nothing", async () => {
    const store = createFakeStore();
    const fake = ["sk", "ant", "api03"].join("-") + "-" + "Ab1".repeat(10);
    for (const over of [
      { summary: "too short" },
      { files: [{ path: "netlify.toml", content: "x" }] },
      { files: [{ path: "docs/a.md", content: `key = "${fake}"` }] },
      { baseSha: "" },
      { files: [] },
    ]) await expect(make(store, over)).rejects.toBeInstanceOf(ProposalRejected);
    expect(store.rows.size).toBe(0);
    const err = await make(store, { files: [{ path: "docs/a.md", content: `key = "${fake}"` }] }).catch((e) => e);
    expect(err.message).not.toContain(fake); // redacted
  });
});

describe("content hash", () => {
  it("is order-independent over paths, changes with content, and hashMatches requires the stored files to agree", async () => {
    const a = [{ path: "b", content: "1" }, { path: "a", content: "2" }];
    expect(computeContentHash(a)).toBe(computeContentHash([...a].reverse()));
    expect(computeContentHash(a)).not.toBe(computeContentHash([{ path: "b", content: "1 " }, { path: "a", content: "2" }]));
    const r = await make(createFakeStore());
    expect(hashMatches(r, r.contentHash)).toBe(true);
    expect(hashMatches(r, r.contentHash.slice(0, 15))).toBe(false);
    expect(hashMatches({ ...r, files: [{ ...r.files[0], content: "tampered" }, r.files[1]] }, r.contentHash)).toBe(false);
  });
  it("revalidate re-runs allow-list, secret scan and hash at approve time", async () => {
    const r = await make(createFakeStore());
    expect(revalidate(r).ok).toBe(true);
    expect(revalidate({ ...r, files: [{ ...r.files[0], path: "netlify.toml" }] }).ok).toBe(false);
    expect(revalidate(r, { denyConsoleUi: true }).ok).toBe(true);
    const c = { ...r, files: [{ path: "public/console.html", content: "x", readBlobSha: null }] };
    expect(revalidate({ ...c, contentHash: computeContentHash(c.files) }, { denyConsoleUi: true }).ok).toBe(false);
  });
});

describe("CAS transitions", () => {
  it("follows the state diagram", () => {
    expect(canTransition("pending", "committing")).toBe(true);
    expect(canTransition("pending", "rejected")).toBe(true);
    expect(canTransition("committing", "committed")).toBe(true);
    for (const [a, b] of [["committed", "pending"], ["rejected", "committing"], ["failed", "committing"], ["stale", "pending"], ["pending", "committed"]]) expect(canTransition(a, b)).toBe(false);
  });
  it("two concurrent approves: exactly one wins pending -> committing", async () => {
    const store = createFakeStore();
    const r = await make(store);
    const a = await loadProposal(store, r.id), b = await loadProposal(store, r.id);
    const [x, y] = await Promise.all([transition(store, a, "committing", { decidedAt: NOW().toISOString() }), transition(store, b, "committing", { decidedAt: NOW().toISOString() })]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect([x, y].find((v) => !v.ok).reason).toBe("conflict");
    const cur = await loadProposal(store, r.id);
    expect((await transition(store, cur, "committed", { commitSha: "e".repeat(40) })).record.commitSha).toBe("e".repeat(40));
    const done = await loadProposal(store, r.id);
    expect((await transition(store, done, "rejected")).reason).toBe("bad_transition");
  });
  it("commitSha is dropped on non-committed states; loadProposal refuses a bad id", async () => {
    const store = createFakeStore();
    const r = await make(store);
    const cur = await loadProposal(store, r.id);
    const t = await transition(store, cur, "committing", { decidedAt: "2026-11-23T15:00:00.000Z", commitSha: "a".repeat(40) });
    expect("commitSha" in t.record).toBe(false);
    await expect(loadProposal(store, "p_bad")).rejects.toThrow();
    expect(await loadProposal(store, "p_" + "Z".repeat(26))).toBeNull();
  });
  it("needsReconcile: committing older than 120 s", () => {
    const rec = { status: "committing", decidedAt: "2026-11-23T15:00:00Z" };
    expect(needsReconcile(rec, Date.parse("2026-11-23T15:02:00Z"))).toBe(false);
    expect(needsReconcile(rec, Date.parse("2026-11-23T15:02:00.001Z"))).toBe(true);
    expect(needsReconcile({ ...rec, status: "pending" }, Date.parse("2026-11-24T00:00:00Z"))).toBe(false);
  });
});

describe("approve lock", () => {
  it("one holder; release lets the next in; a lock older than 90 s can be taken over", async () => {
    const store = createFakeStore();
    const t0 = Date.parse("2026-11-23T15:00:00Z");
    const [a, b] = await Promise.all([acquireApproveLock(store, "r1", t0), acquireApproveLock(store, "r2", t0)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await acquireApproveLock(store, "r3", t0 + 89_000)).toBeNull();
    const c = await acquireApproveLock(store, "r3", t0 + 90_001);
    expect(c?.owner).toBe("r3");
    await releaseApproveLock(store, a ?? b); // stale handle: CAS fails silently, r3 keeps it
    expect(store.json(APPROVE_LOCK_KEY).owner).toBe("r3");
    await releaseApproveLock(store, c);
    expect((await acquireApproveLock(store, "r4", t0 + 91_000))?.owner).toBe("r4");
  });
});

describe("commit message + reconciler match (docs/04 §7)", () => {
  const ID = "p_0123456789ABCDEFGHJKMNPQRS", OTHER = "p_" + "Z".repeat(26);
  it("trailer is always the single last line; nested trailer removed until stable; cut by code point", () => {
    for (const s of [OK + "\n\n" + T + ": " + OTHER, "Beach-Day" + T + "-Proposal: " + OTHER, T.toUpperCase() + "\r\n", ""]) {
      const lines = buildCommitMessage(s, ID).split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[2]).toBe(`${T}: ${ID}`);
      expect(lines[0].toLowerCase()).not.toContain(T.toLowerCase());
    }
    const first = buildCommitMessage("a".repeat(199) + "\u{1F30A}" + "b".repeat(50), ID).split("\n")[0];
    expect([...first]).toHaveLength(200);
    expect(first.isWellFormed()).toBe(true);
    expect(() => buildCommitMessage(OK, "p_short")).toThrow();
  });
  it("gitBlobSha equals git hash-object", () => {
    for (const c of ["", "hello\n", "café \u{1F30A}\r\n"]) expect(gitBlobSha(c)).toBe(execFileSync("git", ["hash-object", "--stdin"], { input: Buffer.from(c, "utf8") }).toString().trim());
  });
  it("only final-line trailer + exact author + one parent + equal blobs matches; full page with no match is unknown", () => {
    const p = { id: ID, agent: "qa-engineer", files: [{ path: "docs/a.md", content: "A\n" }] };
    const good = { sha: "c1", message: buildCommitMessage(OK, ID), authorName: "Beach Day Agent (qa-engineer)", parents: ["p"], blobs: { "docs/a.md": gitBlobSha("A\n") } };
    expect(isProposalCommit(good, p)).toBe(true);
    for (const bad of [{ message: `${T}: ${ID}\n\nmore` }, { message: `x\n\n${T}: ${OTHER}` }, { authorName: "Dr. Lee" }, { parents: ["p", "q"] }, { blobs: { "docs/a.md": gitBlobSha("B\n") } }])
      expect(isProposalCommit({ ...good, ...bad }, p)).toBe(false);
    const noise = (n) => Array.from({ length: n }, (_, i) => ({ sha: `n${i}`, message: "human", authorName: "x", parents: ["p"] }));
    expect(reconcileVerdict(noise(50), p).verdict).toBe("unknown");
    expect(reconcileVerdict(noise(3), p).verdict).toBe("not_found");
    expect(reconcileVerdict([...noise(49), good], p)).toEqual({ verdict: "found", commitSha: "c1" });
  });
});

describe("audit", () => {
  it("writes actor/proposal/commit with onlyIfNew and no token fields", async () => {
    const store = createFakeStore();
    await writeAudit(store, { action: "approve", actor: "11111111-1111-1111-1111-111111111111", proposalId: "p_" + "A".repeat(26), commitSha: "a".repeat(40), requestId: "r1" }, NOW());
    const [[key, row]] = [...store.rows];
    expect(key.startsWith("2026-11-23T15:00:00.000Z_p_")).toBe(true);
    expect(Object.keys(JSON.parse(row.raw)).sort()).toEqual(["action", "actor", "at", "commitSha", "proposalId", "requestId"]);
  });
});

describe("Blobs edge cases (R3)", () => {
  const emptyEtag = (store) => ({ ...store, async setJSON(k, v, o) { const r = await store.setJSON(k, v, o); return r.modified ? { modified: true, etag: "" } : r; }, getWithMetadata: store.getWithMetadata.bind(store) });
  it("R3-1: modified with an empty etag is success, not a false conflict (etag re-read)", async () => {
    const base = createFakeStore();
    const store = emptyEtag(base);
    const r = await make(store);
    const t = await transition(store, await loadProposal(store, r.id), "rejected", { decidedAt: NOW().toISOString() });
    expect(t.ok).toBe(true);
    expect(t.etag).toBe(base.rows.get(r.id).etag);
    const lock = await acquireApproveLock(store, "r1", 0);
    expect(lock?.owner).toBe("r1");
    await releaseApproveLock(store, { owner: "r1", etag: "" });
    expect(base.json(APPROVE_LOCK_KEY).released).toBe(true);
  });
  it("R3-3: a lock with a missing or malformed `at` counts as held", async () => {
    for (const bad of [{ owner: "x" }, { owner: "x", at: "not a date" }, "garbage", null]) {
      const store = createFakeStore();
      await store.setJSON(APPROVE_LOCK_KEY, bad);
      expect(await acquireApproveLock(store, "r2", Date.parse("2030-01-01T00:00:00Z"))).toBeNull();
    }
  });
  it("R3-4: audit retries once on a key collision", async () => {
    const store = createFakeStore();
    let n = 0;
    const s2 = { ...store, async setJSON(k, v, o) { return n++ === 0 ? { modified: false } : store.setJSON(k, v, o); } };
    await writeAudit(s2, { action: "reject", actor: "u" }, NOW());
    expect(store.rows.size).toBe(1);
  });
});
