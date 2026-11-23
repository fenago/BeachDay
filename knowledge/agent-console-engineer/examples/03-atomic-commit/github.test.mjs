// node --test github.test.mjs — runs against a local mock GitHub; no network, no real token.
import test from "node:test";
import assert from "node:assert/strict";
import { makeGitHub } from "./github.mjs";
import { startMockGitHub } from "./mock-github.mjs";

const owner = "fenago", repo = "BeachDay", token = "github_pat_EXAMPLE";
const seed = { "public/index.html": "<h1>Beach Day</h1>\n", "public/app.js": "export {}\n", "netlify.toml": "[build]\n" };

async function setup() {
  const mock = await startMockGitHub({ owner, repo, token, files: seed });
  const gh = makeGitHub({ token, owner, repo, baseUrl: mock.url });
  return { mock, gh };
}

test("GET contents returns text + blob sha", async () => {
  const { mock, gh } = await setup();
  const f = await gh.getFile("public/index.html");
  assert.equal(f.text, "<h1>Beach Day</h1>\n");
  assert.match(f.sha, /^[0-9a-f]{40}$/);
  assert.equal(await gh.getFile("public/missing.html"), null);
  mock.close();
});

test("atomic 2-file commit: exact sequence, base_tree kept, force:false", async () => {
  const { mock, gh } = await setup();
  const baseSha = mock.state.main;
  const idx = await gh.getFile("public/index.html");
  mock.calls.length = 0;
  const out = await gh.commitFiles({
    agent: "pwa-mobile-engineer", baseSha, message: "Add NWS link and offline note\n\nProposal prop_1",
    files: [
      { path: "public/index.html", content: "<h1>Beach Day</h1>\n<a href=\"https://www.weather.gov/beach/mfl\">NWS</a>\n", readSha: idx.sha },
      { path: "public/offline.html", content: "<p>Offline</p>\n", readSha: null },
    ],
  });
  console.log(mock.calls.join("\n"));
  assert.equal(out.status, "committed");
  assert.deepEqual(mock.calls, [
    "GET /git/ref/heads/main",
    `GET /git/commits/${baseSha}`,
    "POST /git/trees",
    "POST /git/commits",
    "PATCH /git/refs/heads/main",
  ]);
  const tree = mock.state.trees.get(mock.state.commits.get(mock.state.main).tree);
  assert.deepEqual([...tree.keys()].sort(), ["netlify.toml", "public/app.js", "public/index.html", "public/offline.html"], "untouched files survive (base_tree)");
  assert.equal(mock.state.commits.get(out.commitSha).parents[0], baseSha);
  mock.close();
});

test("main moved but touched files unchanged: commit on new head", async () => {
  const { mock, gh } = await setup();
  const baseSha = mock.state.main;
  const idx = await gh.getFile("public/index.html");
  mock.state.pushConcurrent("docs/notes.md", "unrelated\n");
  const out = await gh.commitFiles({ agent: "a", baseSha, message: "m", files: [{ path: "public/index.html", content: "x\n", readSha: idx.sha }] });
  assert.equal(out.status, "committed");
  assert.notEqual(out.parent, baseSha);
  mock.close();
});

test("touched file changed on main: stale, nothing written", async () => {
  const { mock, gh } = await setup();
  const baseSha = mock.state.main;
  const idx = await gh.getFile("public/index.html");
  mock.state.pushConcurrent("public/index.html", "<h1>edited by a human</h1>\n");
  mock.calls.length = 0;
  const out = await gh.commitFiles({ agent: "a", baseSha, message: "m", files: [{ path: "public/index.html", content: "x\n", readSha: idx.sha }] });
  assert.equal(out.status, "stale");
  assert.ok(!mock.calls.some((c) => c.startsWith("POST") || c.startsWith("PATCH")), "no writes on stale");
  mock.close();
});

test("race at PATCH (not a fast forward): one retry from step 1", async () => {
  const { mock, gh } = await setup();
  const baseSha = mock.state.main;
  const idx = await gh.getFile("public/index.html");
  mock.state.failNextPatch = true; // someone pushes docs/other.md just before our PATCH
  mock.calls.length = 0;
  const out = await gh.commitFiles({ agent: "a", baseSha, message: "m", files: [{ path: "public/index.html", content: "y\n", readSha: idx.sha }] });
  assert.equal(out.status, "committed");
  assert.equal(mock.calls.filter((c) => c === "PATCH /git/refs/heads/main").length, 2);
  const tree = mock.state.trees.get(mock.state.commits.get(mock.state.main).tree);
  assert.ok(tree.has("docs/other.md"), "concurrent commit preserved");
  mock.close();
});

test("bad token -> 401 surfaces as an error", async () => {
  const mock = await startMockGitHub({ owner, repo, token, files: seed });
  const gh = makeGitHub({ token: "github_pat_WRONG", owner, repo, baseUrl: mock.url });
  await assert.rejects(gh.getFile("public/index.html"), (e) => e.status === 401);
  mock.close();
});
