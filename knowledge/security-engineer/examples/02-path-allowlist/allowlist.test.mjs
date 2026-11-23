// node --test allowlist.test.mjs — table-driven attack cases for the path allow-list.
import test from "node:test";
import assert from "node:assert/strict";
import { checkPath, checkProposal } from "./allowlist.mjs";

// [path, expected ok, why]
const CASES = [
  // allowed
  ["public/index.html", true, "page"],
  ["public/js/console/chat.js", true, "nested js"],
  ["public/manifest.webmanifest", true, "manifest"],
  ["public/console.html", true, "Console page (deny recommended; open for Dr. Lee)"],
  ["docs/notes/readme.md", true, "markdown in docs"],
  ["tests/unit/score.test.js", true, "tests"],
  ["docs/adr/0006-example.md", true, "docs"],
  [".claude/agents/qa-engineer.md", true, "agent file (sensitive)"],
  [".claude/skills/beach-day-scoring/SKILL.md", true, "skill file (sensitive)"],
  ["docs/netlify/notes.md", true, "'netlify' deeper in docs is fine"],
  // traversal and absolute
  ["../netlify.toml", false, "parent traversal"],
  ["public/../netlify.toml", false, "traversal inside allowed dir"],
  ["public/./index.html", false, "dot segment"],
  ["/public/index.html", false, "absolute"],
  ["/etc/passwd", false, "absolute system path"],
  ["public//index.html", false, "empty segment"],
  ["public/", false, "trailing slash"],
  // backslash / Windows
  ["public\\..\\netlify.toml", false, "backslash traversal"],
  ["C:/netlify.toml", false, "drive letter"],
  ["netlify.toml.", false, "trailing dot (Windows strips it)"],
  ["netlify.toml::$DATA", false, "NTFS stream"],
  // case tricks
  ["Netlify.toml", false, "case variant of denied file"],
  ["NETLIFY/functions/approve.mts", false, "case variant of denied dir"],
  [".GitHub/workflows/deploy.yml", false, "case variant of .github"],
  ["PUBLIC/index.html", false, "allow-list is exact case"],
  ["Package.json", false, "case variant of package.json"],
  // denied directories and files
  ["netlify/functions/approve.mts", false, "functions"],
  ["netlify/functions/lib/allowlist.mts", false, "the allow-list itself"],
  [".github/workflows/ci.yml", false, "workflows"],
  ["scripts/build-agents.mjs", false, "build script"],
  ["package-lock.json", false, "lockfile"],
  ["public/.env", false, ".env under an allowed dir"],
  ["docs/.env.production", false, ".env variant"],
  ["tests/fixtures/server.pem", false, "private key file"],
  ["docs/id_rsa.key", false, ".key file"],
  [".git/config", false, "git internals"],
  [".gitmodules", false, "submodules"],
  [".claude/settings.json", false, "Claude Code settings"],
  // canonical public/ denies (docs/04 §6, ADR-0006)
  ["public/_headers", false, "CSP and security headers"],
  ["public/_Headers", false, "case variant of _headers"],
  ["public/_redirects", false, "redirects"],
  ["public/sw.js", false, "service worker"],
  ["public/SW.js", false, "case variant of sw.js"],
  ["public/sw/cache.js", false, "file sw.js imports"],
  ["public/vendor/supabase-auth-js-2.119.2.mjs", false, "vendored auth client"],
  ["public/generated/config.js", false, "build output config"],
  ["public/version.json", false, "build output version"],
  [".claude/settings.local.json", false, "local Claude Code settings"],
  // not on the allow list
  ["README.md", false, "root file not listed"],
  ["public/app.exe", false, "extension not listed"],
  ["public/icons/icon-512.png", false, "binary type (png) not proposable"],
  ["public/index.html.php", false, "double extension"],
  [".claude/agents/sub/x.md", false, "agents must be flat"],
  // NUL, control chars, encoding, unicode
  ["public/index.html\u0000.png", false, "NUL byte"],
  ["public/index.html\n", false, "newline"],
  ["public/%2e%2e/netlify.toml", false, "percent-encoded traversal"],
  ["public%2Findex.html", false, "encoded slash"],
  ["n\u0435tlify.toml", false, "Cyrillic homoglyph"],
  ["public\uFF0Findex.html", false, "fullwidth solidus"],
  ["public/inde\u0301x.html", false, "combining mark"],
  ["public/index .html", false, "space"],
  ["a".repeat(201), false, "too long"],
  [null, false, "not a string"],
];

test("path allow-list attack table", () => {
  const rows = [];
  for (const [path, want, why] of CASES) {
    const got = checkPath(path);
    rows.push(`${got.ok === want ? "PASS" : "FAIL"}  ${String(got.ok).padEnd(5)} ${JSON.stringify(path).slice(0, 44).padEnd(46)} ${why}${got.ok ? (got.sensitive ? " [sensitive]" : "") : ` -> ${got.reason}`}`);
    assert.equal(got.ok, want, `${JSON.stringify(path)} (${why}): ${got.reason ?? "allowed"}`);
  }
  console.log(rows.join("\n"));
  console.log(`${CASES.length} cases`);
});

test("warnings on allowed but sensitive paths", () => {
  assert.equal(checkPath(".claude/agents/qa-engineer.md").sensitive, true);
  assert.deepEqual(checkPath("public/js/console/approve.js").warnings, [
    "runs in the site origin, next to the Console's tokens",
    "Console code (deny recommended, open for Dr. Lee)",
  ]);
  assert.deepEqual(checkPath("tests/unit/a.test.js").warnings, ["runs as code in CI"]);
  assert.equal(checkPath("public/css/app.css").sensitive, false);
  assert.equal(checkPath("docs/README.md").sensitive, false);
});

test("proposal-level checks: count, size, mode, duplicates, binary", () => {
  assert.equal(checkProposal([{ path: "public/a.html", content: "<p>ok</p>" }]).ok, true);
  assert.match(checkProposal([]).errors[0], /1-20 files/);
  assert.match(checkProposal(Array.from({ length: 21 }, (_, i) => ({ path: `docs/${i}.md`, content: "" }))).errors[0], /1-20/);
  assert.match(checkProposal([{ path: "docs/big.md", content: "x".repeat(200 * 1024 + 1) }]).errors[0], /larger/);
  assert.match(checkProposal([{ path: "docs/l.md", content: "x", mode: "120000" }]).errors[0], /mode 120000/);
  assert.match(checkProposal([{ path: "docs/A.md", content: "" }, { path: "docs/a.md", content: "" }]).errors[0], /duplicate/);
  assert.match(checkProposal([{ path: "public/x.svg", content: "\u0000PNG" }]).errors[0], /NUL/);
  assert.match(checkProposal([{ path: "docs/s.md", content: "ok \uD800" }]).errors[0], /lone surrogate/);
  assert.match(checkProposal([{ path: "netlify.toml", content: "" }]).errors[0], /deny list/);
});
