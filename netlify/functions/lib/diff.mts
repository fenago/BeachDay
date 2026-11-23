// Unified text diffs for the proposal card (docs/04 §1 step 4, §2.1 `diffs`). The browser renders them with
// textContent only; the `+`/`-` markers carry the meaning, colour is extra (WCAG 1.4.1).
// Myers diff is quadratic on adversarial input (R2-1), so every diff is bounded in time and edit length,
// and proposalDiffs has an overall budget; past it, files get the "too large" fallback.
import { createTwoFilesPatch } from "diff";

export const DIFF_CONTEXT_LINES = 3;
export const DIFF_TIMEOUT_MS = 1000;
export const DIFF_MAX_EDIT_LENGTH = 5000;
export const DIFF_TOTAL_BUDGET_MS = 8000;
export const MAX_DIFF_CHARS = 400_000;

const clip = (s: string): string => (s.length > MAX_DIFF_CHARS ? s.slice(0, MAX_DIFF_CHARS) + "\n[diff truncated]\n" : s);

/** Fallback: a note plus the whole new file as "+" lines (still a reviewable, textContent-safe view). */
export function tooLargeDiff(path: string, after: string): string {
  const bytes = Buffer.byteLength(after, "utf8");
  const lines = after.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return clip(`Diff too large to show; new file is ${bytes} bytes. Full new contents:\n+++ b/${path}\n` + lines.map((l) => `+${l}`).join("\n") + "\n");
}

/** `before` is the file on main at the proposal's baseSha, or null for a new file. */
export function unifiedDiff(path: string, before: string | null, after: string, timeoutMs: number = DIFF_TIMEOUT_MS): string {
  if (timeoutMs <= 0) return tooLargeDiff(path, after);
  const oldName = before === null ? "/dev/null" : `a/${path}`;
  const text = createTwoFilesPatch(oldName, `b/${path}`, before ?? "", after, "", "", {
    context: DIFF_CONTEXT_LINES,
    timeout: Math.min(DIFF_TIMEOUT_MS, timeoutMs),
    maxEditLength: DIFF_MAX_EDIT_LENGTH,
  });
  if (typeof text !== "string") return tooLargeDiff(path, after); // timeout or edit length exceeded
  return clip(text.replace(/^=+\n/, "")); // drop the "=====" banner; keep ---/+++/@@
}

/**
 * Diffs for every proposed file. `readBefore(path)` returns the text at baseSha, null if absent.
 * A file that can't be read gets a short note. Total diff time is bounded by `budgetMs`.
 */
export async function proposalDiffs(
  files: ReadonlyArray<{ path: string; content: string }>,
  readBefore: (path: string) => Promise<string | null>,
  { budgetMs = DIFF_TOTAL_BUDGET_MS, now = Date.now }: { budgetMs?: number; now?: () => number } = {},
): Promise<Array<{ path: string; diff: string }>> {
  const start = now();
  const out: Array<{ path: string; diff: string }> = [];
  for (const f of files) {
    let before: string | null;
    try {
      before = await readBefore(f.path); // serial: GitHub prefers serial requests
    } catch {
      out.push({ path: f.path, diff: `Couldn't load the current version of ${f.path}. New contents: ${Buffer.byteLength(f.content, "utf8")} bytes.\n` });
      continue;
    }
    out.push({ path: f.path, diff: unifiedDiff(f.path, before, f.content, budgetMs - (now() - start)) });
  }
  return out;
}
