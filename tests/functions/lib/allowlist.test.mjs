import { describe, it, expect } from "vitest";
import { checkPath, checkProposal, checkReadPath, checkReadDir } from "../../../netlify/functions/lib/allowlist.mts";

// [path, allowed?, why] — the canonical docs/04 §6 table (security-engineer example 02) plus extras.
const CASES = [
  ["public/index.html", true, "page"], ["public/js/console/chat.js", true, "console js (D6 off)"],
  ["public/manifest.webmanifest", true, "manifest"], ["public/console.html", true, "console page (D6 off)"],
  ["docs/notes/readme.md", true, "docs"], ["tests/unit/score.test.js", true, "tests"],
  [".claude/agents/qa-engineer.md", true, "agent"], [".claude/skills/beach-day-scoring/SKILL.md", true, "skill"],
  ["docs/netlify/notes.md", true, "'netlify' deeper in docs"],
  ["../netlify.toml", false, "traversal"], ["public/../netlify.toml", false, "traversal in allowed dir"],
  ["public/./index.html", false, "dot segment"], ["/public/index.html", false, "absolute"], ["public//index.html", false, "empty seg"],
  ["public/", false, "trailing slash"], ["public\\..\\netlify.toml", false, "backslash"], ["C:/netlify.toml", false, "drive"],
  ["netlify.toml.", false, "trailing dot"], ["netlify.toml::$DATA", false, "NTFS stream"],
  ["Netlify.toml", false, "case"], ["NETLIFY/functions/approve.mts", false, "case dir"], [".GitHub/workflows/x.yml", false, "case .github"],
  ["PUBLIC/index.html", false, "allow is exact case"], ["Package.json", false, "case package.json"],
  ["netlify/functions/approve.mts", false, "functions"], ["netlify/functions/lib/allowlist.mts", false, "this file"],
  [".github/workflows/ci.yml", false, "workflows"], ["scripts/build-agents.mjs", false, "scripts"], ["package-lock.json", false, "lockfile"],
  ["public/.env", false, ".env"], ["docs/.env.production", false, ".env variant"], ["tests/fixtures/server.pem", false, "pem"],
  ["docs/id_rsa.key", false, "key"], [".git/config", false, "git"], [".gitmodules", false, "submodules"],
  [".claude/settings.json", false, "settings"], [".claude/settings.local.json", false, "local settings"],
  ["public/_headers", false, "_headers"], ["public/_Headers", false, "_headers case"], ["public/_redirects", false, "_redirects"],
  ["public/sw.js", false, "sw"], ["public/SW.js", false, "sw case"], ["public/sw/cache.js", false, "sw import"],
  ["public/vendor/supabase-auth-js-2.119.2.mjs", false, "vendor"], ["public/generated/config.js", false, "generated"],
  ["public/version.json", false, "version"], ["README.md", false, "root file"], ["public/app.exe", false, "ext"],
  ["public/icons/icon-512.png", false, "png"], ["public/index.html.php", false, "double ext"], [".claude/agents/sub/x.md", false, "nested agent"],
  ["public/index.html\u0000.png", false, "NUL"], ["public/index.html\n", false, "newline"], ["public/%2e%2e/netlify.toml", false, "pct"],
  ["public%2Findex.html", false, "encoded slash"], ["n\u0435tlify.toml", false, "homoglyph"], ["public\uFF0Findex.html", false, "fullwidth"],
  ["public/inde\u0301x.html", false, "combining"], ["public/index .html", false, "space"], ["a".repeat(201), false, "too long"], [null, false, "not string"],
];

describe("allowlist.checkPath (docs/04 §6 canonical table)", () => {
  it.each(CASES)("%j -> %s (%s)", (path, want) => {
    expect(checkPath(path).ok).toBe(want);
  });
  it("D6: denyConsoleUi=true denies the Console UI, including case variants", () => {
    for (const p of ["public/console.html", "public/js/console/chat.js", "public/JS/console/x.js"]) expect(checkPath(p, { denyConsoleUi: true }).ok).toBe(false);
    expect(checkPath("public/js/app.js", { denyConsoleUi: true }).ok).toBe(true);
    expect(checkPath("public/console.html").ok).toBe(true); // default from SETTINGS (false)
  });
  it("warnings for sensitive allowed paths", () => {
    expect(checkPath("public/js/console/approve.js").warnings).toEqual(["runs in the site origin, next to the Console's tokens", "Console code (deny recommended, open for Dr. Lee)"]);
    expect(checkPath("tests/unit/a.test.js").warnings).toEqual(["runs as code in CI"]);
    expect(checkPath(".claude/agents/x.md").sensitive).toBe(true);
    expect(checkPath("public/css/app.css").sensitive).toBe(false);
  });
});

describe("allowlist.checkProposal", () => {
  it("count, size, mode, duplicates, binary, lone surrogate, deny", () => {
    expect(checkProposal([{ path: "public/a.html", content: "<p>ok</p>" }]).ok).toBe(true);
    expect(checkProposal([]).errors[0]).toMatch(/1-20 files/);
    expect(checkProposal("x").ok).toBe(false);
    expect(checkProposal(Array.from({ length: 21 }, (_, i) => ({ path: `docs/${i}.md`, content: "" }))).errors[0]).toMatch(/1-20/);
    expect(checkProposal([{ path: "docs/big.md", content: "x".repeat(200 * 1024 + 1) }]).errors[0]).toMatch(/larger/);
    expect(checkProposal([{ path: "docs/ok.md", content: "é".repeat(102_400) + "x" }]).errors[0]).toMatch(/larger/); // bytes, not chars
    expect(checkProposal([{ path: "docs/l.md", content: "x", mode: "120000" }]).errors[0]).toMatch(/mode 120000/);
    expect(checkProposal([{ path: "docs/A.md", content: "" }, { path: "docs/a.md", content: "" }]).errors[0]).toMatch(/duplicate/);
    expect(checkProposal([{ path: "public/x.svg", content: "\u0000PNG" }]).errors[0]).toMatch(/NUL/);
    expect(checkProposal([{ path: "docs/s.md", content: "ok \uD800" }]).errors[0]).toMatch(/lone surrogate/);
    expect(checkProposal([{ path: "docs/s.md", content: 5 }]).errors[0]).toMatch(/text/);
    expect(checkProposal([{ path: "netlify.toml", content: "" }]).errors[0]).toMatch(/deny list/);
  });
});

describe("read-tool paths (ADR-0007)", () => {
  it("refuses .env*, *.pem, *.key, .git/** and bad shapes; allows ordinary files anywhere", () => {
    for (const p of [".env", "public/.ENV.local", "a/b.pem", "x.KEY", ".git/config", "../x", "/etc/passwd", "a//b", ""]) expect(checkReadPath(p)).not.toBeNull();
    for (const p of ["netlify/functions/lib/allowlist.mts", "package.json", "docs/04-agent-console.md", ".gitignore"]) expect(checkReadPath(p)).toBeNull();
    expect(checkReadDir("")).toBeNull();
    expect(checkReadDir("public")).toBeNull();
    expect(checkReadDir(".git")).not.toBeNull();
  });
});
