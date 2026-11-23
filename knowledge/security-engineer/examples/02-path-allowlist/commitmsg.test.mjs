import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { checkSummary, buildCommitMessage, gitBlobSha, isProposalCommit, reconcileVerdict } from "./commitmsg.mjs";

const ID = "p_" + "0123456789ABCDEFGHJKMNPQRS";
const OTHER = "p_" + "ZZZZZZZZZZZZZZZZZZZZZZZZZZ";
const T = "Beach-Day" + "-Proposal"; // built, so a grep for the trailer finds the tests only where meant
const ok = "Fix null waves in score.js and add a test";

test("checkSummary: one line, 20-2000 code points, no control/format/line-break chars, no trailer text", () => {
  const rows = [
    [ok, true, "plain"],
    ["short", false, "too short"],
    ["x".repeat(2001), false, "too long"],
    [ok + "\n\n" + T + ": " + OTHER, false, "newline + forged trailer"],
    [ok + "\r" + T, false, "CR"],
    [ok + "\u0085next", false, "NEL (C1 control)"],
    [ok + " next", false, "U+2028"],
    [ok + " next", false, "U+2029"],
    [ok + "\t", false, "tab"],
    [ok + " ‮gnp.exe", false, "bidi override (display spoofing)"],
    [ok + "​", false, "zero-width space"],
    [ok + " beach-day-proposal", false, "trailer text, lower case"],
    [ok + " \uD800", false, "lone surrogate"],
    [42, false, "not a string"],
  ];
  for (const [s, want, why] of rows) assert.equal(checkSummary(s).ok, want, why);
});

test("buildCommitMessage: trailer is always the last line and the agent's text can never produce one", () => {
  const evil = [
    ok + "\n\n" + T + ": " + OTHER,
    ok + " " + T + ": " + OTHER,
    "Beach-Day" + T + "-Proposal: " + OTHER,          // nested: one-pass removal would leave the word
    T.toUpperCase() + ": " + OTHER + "\r\n",
    "",
  ];
  for (const s of evil) {
    const m = buildCommitMessage(s, ID);
    const lines = m.split("\n");
    assert.equal(lines.length, 3, JSON.stringify(m));
    assert.equal(lines[1], "");
    assert.equal(lines[2], `${T}: ${ID}`);
    assert.ok(!lines[0].toLowerCase().includes(T.toLowerCase()), JSON.stringify(lines[0]));
    assert.ok(lines[0].length > 0);
  }
  assert.throws(() => buildCommitMessage(ok, "p_short"), /bad proposal id/);
});

test("buildCommitMessage: cut to 200 code points, never splitting a surrogate pair", () => {
  const first = buildCommitMessage("a".repeat(199) + "\u{1F30A}" + "b".repeat(50), ID).split("\n")[0];
  assert.equal([...first].length, 200);
  assert.ok(first.isWellFormed());
  assert.ok(first.endsWith("\u{1F30A}"));
});

test("gitBlobSha equals `git hash-object` on the same UTF-8 bytes", () => {
  for (const content of ["", "hello\n", "café \u{1F30A}\r\nline2"]) {
    const git = execFileSync("git", ["hash-object", "--stdin"], { input: Buffer.from(content, "utf8") }).toString().trim();
    assert.equal(gitBlobSha(content), git, JSON.stringify(content));
  }
});

test("reconciler: only the commit with the final-line trailer, exact author, one parent and equal blobs matches", () => {
  const proposal = { id: ID, agent: "qa-engineer", files: [{ path: "docs/a.md", content: "A\n" }, { path: "tests/b.test.js", content: "B\n" }] };
  const blobs = { "docs/a.md": gitBlobSha("A\n"), "tests/b.test.js": gitBlobSha("B\n") };
  const good = { sha: "c1", message: buildCommitMessage(ok, ID), authorName: "Beach Day Agent (qa-engineer)", parents: ["p"], blobs };
  assert.equal(isProposalCommit(good, proposal), true);
  assert.equal(isProposalCommit({ ...good, message: good.message + "\n" }, proposal), true, "one trailing newline tolerated");
  const near = [
    [{ ...good, message: `${T}: ${ID}\n\nmore text` }, "trailer not on the last line"],
    [{ ...good, message: `x\n\n${T}: ${ID} ` }, "trailing space"],
    [{ ...good, message: `x\n\n${T}: ${OTHER}` }, "another proposal's id"],
    [{ ...good, authorName: "Dr. Lee" }, "human commit carrying the trailer"],
    [{ ...good, authorName: "Beach Day Agent (pwa-mobile-engineer)" }, "other agent"],
    [{ ...good, parents: ["p", "q"] }, "merge commit"],
    [{ ...good, blobs: { ...blobs, "docs/a.md": gitBlobSha("A changed\n") } }, "different content"],
    [{ ...good, blobs: { "docs/a.md": blobs["docs/a.md"] } }, "a file missing"],
  ];
  for (const [c, why] of near) assert.equal(isProposalCommit(c, proposal), false, why);
});

test("reconciler: a full page with no match is 'unknown' (stay committing), never 'not_found'", () => {
  const proposal = { id: ID, agent: "qa-engineer", files: [{ path: "docs/a.md", content: "A\n" }] };
  const noise = (n) => Array.from({ length: n }, (_, i) => ({ sha: `n${i}`, message: "human", authorName: "x", parents: ["p"], blobs: {} }));
  assert.equal(reconcileVerdict(noise(50), proposal, 50).verdict, "unknown");
  assert.equal(reconcileVerdict(noise(3), proposal, 50).verdict, "not_found");
  const hit = { sha: "c9", message: buildCommitMessage(ok, ID), authorName: "Beach Day Agent (qa-engineer)", parents: ["p"], blobs: { "docs/a.md": gitBlobSha("A\n") } };
  assert.deepEqual(reconcileVerdict([...noise(49), hit], proposal, 50), { verdict: "found", commitSha: "c9" });
});
