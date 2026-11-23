// Agent tools: read_file, list_files (GitHub main, pinned to one SHA per turn, ADR-0007) and propose_change
// (stores a PENDING proposal in Blobs). No tool can commit: committing is the human-only Approve endpoint.
// Strict schemas guarantee shape only; every input is validated here in code (policy is code, not prompt).
// Tool results (repo files) are untrusted data and stay inside tool_result blocks.
import type { GitHubRead } from "./github-read.mts";
import { ReadRefused } from "./github-read.mts";
import { createProposal, ProposalRejected, type ProposalRecord } from "./proposals.mts";
import type { BlobStore } from "./blobs.mts";
import type { SseEvent, ToolName } from "./sse.mts";

const str = (description: string) => ({ type: "string", description });

/** Strict, closed schemas (no maxLength/maxItems: limits are enforced below). eager_input_streaming because we stream. */
export const TOOLS = Object.freeze([
  {
    name: "read_file",
    description:
      "Read one UTF-8 text file (at most 200 KB) from the Beach Day repo at the main commit pinned for this turn. " +
      "Use a repo-relative path such as public/js/score.js. Secrets files (.env*, *.pem, *.key) and .git/ can't be read. " +
      "Read a file before proposing a change to it.",
    strict: true,
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { path: str("Repo-relative file path, no leading slash.") }, required: ["path"], additionalProperties: false },
  },
  {
    name: "list_files",
    description: "List the files and folders directly inside one repo directory at the pinned main commit. Use \"\" for the repo root.",
    strict: true,
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { dir: str("Repo-relative directory, no leading or trailing slash; \"\" for the root.") }, required: ["dir"], additionalProperties: false },
  },
  {
    name: "propose_change",
    description:
      "Store a proposed change for a human to review and approve in the Console. This NEVER commits. " +
      "Send complete new contents for each file (1-20 files, at most 200 KB each, text only) and a one-line summary " +
      "of 20-2000 characters saying what changes and why. Only allow-listed paths are accepted: public/** text files, " +
      "tests/**, docs/**, .claude/agents/*.md, .claude/skills/**/*.md. Denied: netlify/**, netlify.toml, scripts/**, " +
      "package*.json, .github/**, public/_headers, public/sw.js, public/sw/**, public/vendor/**, public/generated/**. " +
      "Files can't be deleted. Never include secrets.",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        summary: str("One line, 20-2000 characters: what changes and why."),
        files: {
          type: "array",
          description: "Files to create or replace, each with its full new contents.",
          items: {
            type: "object",
            properties: { path: str("Repo-relative path."), content: str("Complete new file contents.") },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "files"],
      additionalProperties: false,
    },
  },
]);

export const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((t) => t.name));
export const MAX_TOOL_RESULT_CHARS = 210_000;

/** Per-turn (or per-job) state. Serialisable, so a handoff can store it in the job record. */
export interface TurnState { baseSha: string | null; readShas: Record<string, string> }
export const newTurnState = (): TurnState => ({ baseSha: null, readShas: {} });

export interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

export interface ToolRunnerDeps {
  reader: GitHubRead;
  proposals: BlobStore;
  agent: string;
  state: TurnState;           // mutated: baseSha pinned on first use, readShas recorded
  emit?: (ev: SseEvent) => void;
  onProposal?: (record: ProposalRecord) => void | Promise<void>;
  now?: () => Date;
}

class ToolInputError extends Error {}

const clip = (s: string, n = 200): string => ([...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s);
const shortPath = (p: unknown): string => (typeof p === "string" && /^[A-Za-z0-9._\/-]{0,200}$/.test(p) ? p : "a path");

/** One-line, user-safe summary for the `tool` SSE event (never raw input). */
export function toolSummary(name: string, input: any): string {
  if (name === "read_file") return clip(`Read ${shortPath(input?.path)}`);
  if (name === "list_files") return clip(`Listed ${input?.dir === "" ? "the repo root" : shortPath(input?.dir)}`);
  if (name === "propose_change") return clip(`Proposed changes to ${Array.isArray(input?.files) ? input.files.length : 0} file(s)`);
  return "Tool";
}

function requireString(input: any, key: string): string {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input[key] !== "string") throw new ToolInputError(`input.${key} must be a string`);
  const extra = Object.keys(input).filter((k) => k !== key);
  if (extra.length) throw new ToolInputError("unexpected input fields");
  return input[key];
}

export function createToolRunner(deps: ToolRunnerDeps) {
  const { reader, state } = deps;

  async function pin(): Promise<string> {
    state.baseSha ??= await reader.getMainSha(); // one SHA per turn/job (ADR-0007)
    return state.baseSha;
  }

  const impl: Record<ToolName, (input: any) => Promise<string>> = {
    async read_file(input) {
      const path = requireString(input, "path");
      const sha = await pin();
      const f = await reader.readFile(path, sha);
      if (!f) return `No file at ${path} on main (${sha.slice(0, 7)}). It would be a new file.`;
      state.readShas[path] = f.sha;
      return f.text.length > MAX_TOOL_RESULT_CHARS ? f.text.slice(0, MAX_TOOL_RESULT_CHARS) + "\n[truncated]" : f.text;
    },
    async list_files(input) {
      const dir = requireString(input, "dir");
      const sha = await pin();
      const entries = await reader.listDir(dir, sha);
      if (!entries) return `No directory ${dir === "" ? "(root)" : dir} on main.`;
      return entries.map((e) => (e.type === "dir" ? `${e.path}/` : e.path)).join("\n") || "(empty)";
    },
    async propose_change(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolInputError("input must be an object");
      const extra = Object.keys(input).filter((k) => k !== "summary" && k !== "files");
      if (extra.length) throw new ToolInputError("unexpected input fields");
      const sha = await pin();
      const record = await createProposal(deps.proposals, {
        agent: deps.agent,
        summary: input.summary,
        files: Array.isArray(input.files) ? input.files.map((f: any) => (f && typeof f === "object" ? { path: f.path, content: f.content } : f)) : input.files,
        baseSha: sha,
        readShas: state.readShas,
        now: deps.now,
      });
      deps.emit?.({
        type: "proposal",
        proposalId: record.id,
        summary: record.summary,
        files: record.files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content, "utf8") })),
      });
      await deps.onProposal?.(record);
      return `Proposal ${record.id} is stored as pending. A human reviews the diff and decides in the Console; you cannot commit. Tell the user what you proposed and how to test it.`;
    },
  };

  /** Run one tool_use block. Always returns a tool_result (is_error on any failure); never throws. */
  return async function runTool(block: ToolUseBlock): Promise<ToolResultBlock> {
    const name = block.name as ToolName;
    if (!TOOL_NAMES.has(name)) return { type: "tool_result", tool_use_id: block.id, content: `unknown tool: ${clip(String(block.name), 60)}`, is_error: true };
    deps.emit?.({ type: "tool", name, phase: "start", summary: toolSummary(name, block.input) });
    let result: ToolResultBlock;
    try {
      result = { type: "tool_result", tool_use_id: block.id, content: await impl[name](block.input) };
    } catch (e) {
      // Expected refusals go back to Claude so it can recover; internals stay out of the model's context.
      const msg =
        e instanceof ToolInputError || e instanceof ReadRefused ? e.message
        : e instanceof ProposalRejected ? `proposal rejected: ${e.message}`
        : "the tool failed (GitHub or storage unavailable); try again later";
      if (!(e instanceof ToolInputError || e instanceof ReadRefused || e instanceof ProposalRejected)) {
        console.error("tool_failed", { tool: name, error: (e as Error)?.name });
      }
      result = { type: "tool_result", tool_use_id: block.id, content: msg, is_error: true };
    }
    deps.emit?.({ type: "tool", name, phase: "end", summary: toolSummary(name, block.input) });
    return result;
  };
}

export type RunTool = ReturnType<typeof createToolRunner>;
