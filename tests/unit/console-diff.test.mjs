// Console diff rendering (R12, Vera): invisible format characters and U+2028/2029 must show as ⟨U+XXXX⟩ tokens,
// never raw, and the proposal card must warn. Pure parts run in node; the DOM part uses a tiny document stub.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { splitHidden, hasHiddenChars, hiddenLabel, parseDiff, diffLines, warningsFor } from "../../public/js/console/proposal.js";

describe("splitHidden / hasHiddenChars", () => {
  it.each([
    ["a‮b", [{ text: "a" }, { hidden: "⟨U+202E⟩" }, { text: "b" }]],             // RIGHT-TO-LEFT OVERRIDE
    ["​x", [{ hidden: "⟨U+200B⟩" }, { text: "x" }]],                               // zero-width space
    ["x﻿", [{ text: "x" }, { hidden: "⟨U+FEFF⟩" }]],                               // BOM
    ["p q r", [{ text: "p" }, { hidden: "⟨U+2028⟩" }, { text: "q" }, { hidden: "⟨U+2029⟩" }, { text: "r" }]],
    ["­", [{ hidden: "⟨U+00AD⟩" }]],                                               // soft hyphen, padded to 4
    ["a\u{E0041}b", [{ text: "a" }, { hidden: "⟨U+E0041⟩" }, { text: "b" }]],           // astral tag char, one token
    ["⁦⁩", [{ hidden: "⟨U+2066⟩" }, { hidden: "⟨U+2069⟩" }]],                 // isolates, adjacent
    ["plain ascii only", [{ text: "plain ascii only" }]],
    ["", []],
  ])("%j", (input, want) => {
    expect(splitHidden(input)).toEqual(want);
    expect(hasHiddenChars(input)).toBe(want.some((s) => s.hidden));
  });
  it("labels are uppercase hex, at least 4 digits", () => {
    expect(hiddenLabel("‍")).toBe("⟨U+200D⟩");
    expect(hiddenLabel("\u{1D173}")).toBe("⟨U+1D173⟩");
  });
  it("tabs, newlines and emoji are not hidden characters", () => {
    expect(hasHiddenChars("a\tb\nc 🌊 é")).toBe(false);
  });
});

describe("parseDiff", () => {
  it("keeps U+2028 inside its line and classifies markers", () => {
    expect(parseDiff("@@ -1 +1 @@\n-old\n+a b\n ctx\n")).toEqual([
      { kind: "hunk", text: "@@ -1 +1 @@" }, { kind: "del", text: "old" }, { kind: "add", text: "a b" }, { kind: "ctx", text: "ctx" },
    ]);
  });
});

describe("warningsFor", () => {
  it("public js/html, .claude and tests", () => {
    expect(warningsFor("public/js/x.js")).toEqual(["agents.proposal.warn.code"]);
    expect(warningsFor(".claude/agents/a.md")).toEqual(["agents.proposal.warn.agents"]);
    expect(warningsFor("tests/unit/a.test.mjs")).toEqual(["agents.proposal.warn.tests"]);
    expect(warningsFor("docs/a.md")).toEqual([]);
  });
});

// Minimal DOM stub: enough for h() (createElement, setAttribute, append, Text nodes). No innerHTML anywhere.
class Node {}
class Text extends Node { constructor(d) { super(); this.data = String(d); } get textContent() { return this.data; } }
class El extends Node {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.dataset = {}; this.style = { setProperty() {} }; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "class") this.className = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  set className(v) { this.attrs.class = v; } get className() { return this.attrs.class ?? ""; }
  append(...c) { this.children.push(...c); }
  addEventListener() {}
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
}
describe("diffLines (DOM)", () => {
  let saved;
  beforeAll(() => {
    saved = { document: globalThis.document, Node: globalThis.Node };
    globalThis.Node = Node;
    globalThis.document = { createElement: (t) => new El(t), createTextNode: (d) => new Text(d) };
  });
  afterAll(() => { globalThis.document = saved.document; globalThis.Node = saved.Node; });

  it('"+a\\u202Eb" renders the override as a visible token in a .diff__hidden span, never raw', () => {
    const [line] = diffLines("+a‮b");
    expect(line.className).toBe("diff__line diff__line--add");
    expect(line.textContent).toBe("+Added line: a⟨U+202E⟩b");
    expect(line.textContent).not.toMatch(/[\p{Cf}  ]/u);
    const hidden = line.children.filter((c) => c instanceof El && c.className === "diff__hidden");
    expect(hidden.map((c) => c.textContent)).toEqual(["⟨U+202E⟩"]);
  });
  it("hunk headers and removed lines are covered too", () => {
    const [hunk, del] = diffLines("@@ ​ @@\n-x y");
    expect(hunk.textContent).toBe("@@ ⟨U+200B⟩ @@");
    expect(del.textContent).toBe("−Removed line: x⟨U+2029⟩y");
  });
});
