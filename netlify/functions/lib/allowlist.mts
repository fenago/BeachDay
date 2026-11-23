// Path allow-list for proposals (canonical list: docs/04 §6) and the read-tool deny rules (ADR-0007).
// Enforced at propose_change AND again at Approve. Validates the EXACT string sent to GitHub:
// charset -> segments -> DENY (case-insensitive, wins) -> ALLOW (exact case). Nothing is decoded or normalised.
// A fine-grained PAT can't be limited to paths (ADR-0005), so this file IS the enforcement point.
import { SETTINGS } from "./settings.mts";

export const MAX_PATH = 200;
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 200 * 1024;
export const TEXT_EXT = Object.freeze(["html", "css", "js", "json", "webmanifest", "svg", "txt", "md"]);

const SAFE_CHARS = /^[A-Za-z0-9._\-/]+$/;

// Tested against the lower-cased path, so "Netlify.toml" and "public/_Headers" can't slip through.
const DENY: ReadonlyArray<RegExp> = [
  /^public\/_headers$/,
  /^public\/_redirects$/,
  /^public\/sw\.js$/,
  /^public\/sw(\/|$)/,
  /^public\/vendor(\/|$)/,
  /^public\/generated(\/|$)/,
  /^public\/version\.json$/,
  /^netlify(\/|$)/,
  /^netlify\.toml$/,
  /^\.github(\/|$)/,
  /^package(-lock)?\.json$/,
  /^scripts(\/|$)/,
  /(^|\/)\.env/,
  /\.(pem|key)$/,
  /^\.git(\/|$)/,
  /(^|\/)\.gitmodules$/,
  /(^|\/)\.git[^/]*$/,           // .gitattributes, .gitignore anywhere (R2-S3)
  /^\.claude\/settings/,
];

// D6: Dr. Lee decided (2026-11-23) to deny the Console UI to agents; settings.mts denyConsoleUi is true.
const CONSOLE_UI = /^public\/(?:console\.html$|js\/console(\/|$))/;

const ALLOW: ReadonlyArray<RegExp> = [
  new RegExp(`^public\\/(?:[^/]+\\/)*[^/]+\\.(?:${TEXT_EXT.join("|")})$`),
  /^tests\/.+/,
  /^docs\/.+/,
  /^\.claude\/agents\/[^/]+\.md$/,
  /^\.claude\/skills\/.+\.md$/,
];

const WARN: ReadonlyArray<[RegExp, string]> = [
  [/^public\/.*\.(?:js|html)$/, "runs in the site origin, next to the Console's tokens"],
  [CONSOLE_UI, "Console code (denied by default, D6)"],
  [/^\.claude\//, "changes agent behaviour or model"],
  [/^tests\//, "runs as code in CI"],
];

export type PathCheck = { ok: true; sensitive: boolean; warnings: string[] } | { ok: false; reason: string };
export interface PolicyOptions { denyConsoleUi?: boolean }

const deny = (reason: string): PathCheck => ({ ok: false, reason });

/** Shape rules shared by write and read checks. Returns a reason or null. */
function shapeProblem(path: unknown): string | null {
  if (typeof path !== "string") return "not a string";
  if (path.length === 0 || path.length > MAX_PATH) return "length";
  if (!SAFE_CHARS.test(path)) return "characters outside [A-Za-z0-9._-/]";
  if (path.startsWith("/")) return "absolute path";
  const segs = path.split("/");
  if (segs.some((s) => s === "")) return "empty segment (// or trailing /)";
  if (segs.some((s) => s === "." || s === "..")) return "dot segment";
  if (segs.some((s) => s.endsWith("."))) return "segment ends with '.'";
  return null;
}

/** May an agent propose a write to `path`? */
export function checkPath(path: unknown, opts: PolicyOptions = {}): PathCheck {
  const bad = shapeProblem(path);
  if (bad) return deny(bad);
  const p = path as string;
  const lower = p.toLowerCase();
  if (DENY.some((r) => r.test(lower))) return deny("deny list");
  if ((opts.denyConsoleUi ?? SETTINGS.denyConsoleUi) && CONSOLE_UI.test(lower)) return deny("deny list (Console UI)");
  if (!ALLOW.some((r) => r.test(p))) return deny("not on allow list");
  const warnings = WARN.filter(([r]) => r.test(p)).map(([, why]) => why);
  return { ok: true, sensitive: warnings.length > 0, warnings };
}

export interface ProposedFile { path: string; content: string; mode?: string }

/** Whole-proposal rules: used at propose time AND at approve time. */
export function checkProposal(files: unknown, opts: PolicyOptions = {}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const list = Array.isArray(files) ? (files as ProposedFile[]) : [];
  if (!Array.isArray(files) || list.length === 0 || list.length > MAX_FILES) errors.push(`1-${MAX_FILES} files required`);
  const seen = new Set<string>();
  for (const f of list.slice(0, MAX_FILES + 1)) {
    const r = checkPath(f?.path, opts);
    if (!r.ok) {
      errors.push(`${JSON.stringify(String(f?.path ?? "")).slice(0, 220)}: ${r.reason}`);
      continue;
    }
    const key = f.path.toLowerCase();
    if (seen.has(key)) errors.push(`${f.path}: duplicate (case-insensitive)`);
    seen.add(key);
    if (f.mode !== undefined && f.mode !== "100644") errors.push(`${f.path}: mode ${String(f.mode)} not allowed`);
    if (typeof f.content !== "string") {
      errors.push(`${f.path}: content must be text`);
      continue;
    }
    if (!f.content.isWellFormed()) errors.push(`${f.path}: not valid UTF-8 (lone surrogate)`);
    if (Buffer.byteLength(f.content, "utf8") > MAX_FILE_BYTES) errors.push(`${f.path}: larger than ${MAX_FILE_BYTES} bytes`);
    if (f.content.includes("\u0000")) errors.push(`${f.path}: NUL byte (binary?)`);
  }
  return { ok: errors.length === 0, errors };
}

// ---- Read tools (ADR-0007): read_file / list_files refuse secrets-bearing and git-internal paths. ----
const READ_DENY: ReadonlyArray<RegExp> = [/(^|\/)\.env/, /\.(pem|key)$/, /^\.git(\/|$)/];

/** read_file path. Returns a reason string, or null when the read may go to GitHub. */
export function checkReadPath(path: unknown): string | null {
  const bad = shapeProblem(path);
  if (bad) return bad;
  return READ_DENY.some((r) => r.test((path as string).toLowerCase())) ? "this file can't be read" : null;
}

/** list_files dir: "" is the repo root. */
export function checkReadDir(dir: unknown): string | null {
  if (dir === "") return null;
  return checkReadPath(dir);
}

/** Hide denied entries from directory listings too. */
export const isReadable = (path: string): boolean => checkReadPath(path) === null;

// ---- Hidden Unicode warning (Vera-B R12 S1): format characters (\p{Cf}: bidi controls, zero-width) and U+2028/2029
// in code that runs next to the tokens (public/**/*.js, *.html) can make a diff read differently from what runs.
// A WARNING, never a refusal: the human reviews, and the Console renders these characters visibly.
const HIDDEN_UNICODE = /[\p{Cf}\u2028\u2029]/u;
const RUNS_IN_PAGE = /^public\/.+\.(js|html)$/;
export type ContentWarning = { path: string; code: "hidden_unicode" };
export function contentWarnings(files: ReadonlyArray<{ path: string; content: string }>): ContentWarning[] {
  return (files ?? [])
    .filter((f) => typeof f?.path === "string" && RUNS_IN_PAGE.test(f.path) && typeof f.content === "string" && HIDDEN_UNICODE.test(f.content))
    .map((f) => ({ path: f.path, code: "hidden_unicode" as const }));
}
