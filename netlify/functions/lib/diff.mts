// Unified text diffs for the proposal card (docs/04 §1 step 4, §2.1 `diffs`). The browser renders them with
// textContent only; the `+`/`-` markers carry the meaning, colour is extra (WCAG 1.4.1).
import { createTwoFilesPatch } from "diff";

export const DIFF_CONTEXT_LINES = 3;
export const MAX_DIFF_CHARS = 400_000; // two 200 KB files can't produce more than this in practice

/** `before` is the file on main at the proposal's baseSha, or null for a new file. */
export function unifiedDiff(path: string, before: string | null, after: string): string {
  const oldName = before === null ? "/dev/null" : `a/${path}`;
  const text = createTwoFilesPatch(oldName, `b/${path}`, before ?? "", after, "", "", { context: DIFF_CONTEXT_LINES });
  // Drop the "=====" banner line the library adds; keep standard ---/+++/@@ lines.
  const out = text.replace(/^=+\n/, "");
  return out.length > MAX_DIFF_CHARS ? out.slice(0, MAX_DIFF_CHARS) + "\n[diff truncated]\n" : out;
}

/**
 * Diffs for every proposed file. `readBefore(path)` returns the text at baseSha, null if absent.
 * A file that can't be read (binary, too large, GitHub down) gets a short note instead of a diff.
 */
export async function proposalDiffs(
  files: ReadonlyArray<{ path: string; content: string }>,
  readBefore: (path: string) => Promise<string | null>,
): Promise<Array<{ path: string; diff: string }>> {
  const out: Array<{ path: string; diff: string }> = [];
  for (const f of files) {
    let before: string | null;
    try {
      before = await readBefore(f.path); // serial: GitHub prefers serial requests
    } catch {
      out.push({ path: f.path, diff: `Couldn't load the current version of ${f.path}. New contents: ${Buffer.byteLength(f.content, "utf8")} bytes.\n` });
      continue;
    }
    out.push({ path: f.path, diff: unifiedDiff(f.path, before, f.content) });
  }
  return out;
}
