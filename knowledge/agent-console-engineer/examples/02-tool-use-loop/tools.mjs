// Beach Day agent tools: definitions (strict JSON schemas) + server-side implementations.
// The model only ever *proposes*; nothing here can commit. Policy lives in code, not in the prompt.

export const TOOLS = [
  {
    name: "read_file",
    description: "Read one UTF-8 text file from the Beach Day repo at the current main commit. Use a repo-relative path such as public/index.html.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative file path, no leading slash." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "List files and folders directly inside one repo directory. Use \"\" for the repo root.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { dir: { type: "string", description: "Repo-relative directory, no leading or trailing slash." } },
      required: ["dir"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_change",
    description: "Store a proposed change for a human to review and approve. This never commits. Only allow-listed paths are accepted; whole-file contents only.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences: what changes and why." },
        files: {
          type: "array",
          description: "Files to create or replace, with their full new contents.",
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "files"],
      additionalProperties: false,
    },
  },
];

// Minimal stand-in for lib/allowlist (the full validator is in knowledge/security-engineer/examples/02).
const DENY = [/^netlify(\/|\.toml$)/i, /^\.github\//i, /^scripts\//i, /^package(-lock)?\.json$/i, /(^|\/)\.env/i];
const ALLOW = [/^public\//, /^tests\//, /^docs\//, /^\.claude\/agents\/[^/]+\.md$/, /^\.claude\/skills\/.+\.md$/];
export function checkPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 200) return "path must be a non-empty string";
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0") || p.split("/").some((s) => s === ".." || s === "." || s === "")) return "path is not a normalized repo-relative path";
  if (DENY.some((r) => r.test(p))) return `path is on the deny list: ${p}`;
  if (!ALLOW.some((r) => r.test(p))) return `path is not on the allow list: ${p}`;
  return null;
}

class ToolError extends Error {}

/** repo: { read(path) -> string|undefined, list(dir) -> string[] }, proposals: { put(p) -> id } */
export function makeToolRunner({ repo, proposals }) {
  const impl = {
    read_file({ path }) {
      // Reading is allowed outside the write allow-list, but never secrets-bearing files.
      if (/(^|\/)\.env/i.test(path) || path.startsWith("/") || path.includes("..")) throw new ToolError("read denied");
      const text = repo.read(path);
      if (text === undefined) throw new ToolError(`not found: ${path}`);
      return text.length > 100_000 ? text.slice(0, 100_000) + "\n[truncated]" : text;
    },
    list_files({ dir }) {
      if (dir.startsWith("/") || dir.includes("..")) throw new ToolError("bad dir");
      return repo.list(dir).join("\n");
    },
    propose_change({ summary, files }) {
      if (files.length === 0 || files.length > 20) throw new ToolError("1 to 20 files per proposal");
      for (const f of files) {
        const why = checkPath(f.path);
        if (why) throw new ToolError(why);
        if (Buffer.byteLength(f.content) > 200 * 1024) throw new ToolError(`file too large: ${f.path}`);
      }
      const id = proposals.put({ summary, files, status: "pending" });
      return `Proposal ${id} stored as pending. A human must approve it in the Console; you cannot commit.`;
    },
  };
  return async function runTool(block) {
    const fn = impl[block.name];
    if (!fn) return { type: "tool_result", tool_use_id: block.id, content: `unknown tool: ${block.name}`, is_error: true };
    try {
      return { type: "tool_result", tool_use_id: block.id, content: String(await fn(block.input)) };
    } catch (err) {
      // Expected failures go back to Claude as is_error so it can recover; internals stay out.
      const msg = err instanceof ToolError ? err.message : "internal tool error";
      return { type: "tool_result", tool_use_id: block.id, content: msg, is_error: true };
    }
  };
}
