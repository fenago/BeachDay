// Shapes for docs/04 §6 (summary rule) and §7 (buildCommitMessage, reconciler matching).
// Goal: an agent's text can never make the reconciler credit the wrong commit with a proposal's
// Approve slot, and the reconciler never calls "not found" when it simply did not look far enough.
import { createHash } from "node:crypto";

const ID = /^p_[0-9A-Z]{26}$/;
const TRAILER = "Beach-Day-Proposal";
// Cc: C0/C1 controls incl. \n \r \t NUL and U+0085 (NEL). Zl/Zp: U+2028/U+2029.
// Cf: format characters, incl. bidi overrides/isolates (U+202A-202E, U+2066-2069) and zero-width
// characters, which can make the summary in the proposal card read differently from its bytes.
const BAD_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const BAD_CHARS_G = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** propose_change: reject (is_error: true) rather than repair. Returns { ok } or { ok:false, reason }. */
export function checkSummary(s) {
  if (typeof s !== "string") return { ok: false, reason: "not a string" };
  if (!s.isWellFormed()) return { ok: false, reason: "lone surrogate (not valid UTF-8)" };
  const n = [...s].length; // code points, not UTF-16 units
  if (n < 20 || n > 2000) return { ok: false, reason: "length must be 20-2000 characters" };
  if (BAD_CHARS.test(s)) return { ok: false, reason: "control, format or line-break character" };
  if (s.toLowerCase().includes(TRAILER.toLowerCase())) return { ok: false, reason: `contains ${TRAILER}` };
  return { ok: true };
}

/** Server-only. Sanitises again even though checkSummary already ran (stored data is not trusted). */
export function buildCommitMessage(summary, id) {
  if (!ID.test(id)) throw new Error("bad proposal id");
  let line = String(summary ?? "").toWellFormed().replace(BAD_CHARS_G, " ");
  // Remove until stable: one pass over "Beach-DayBeach-Day-Proposal-Proposal" would leave the word behind.
  for (let prev; prev !== line; ) { prev = line; line = line.replace(/beach-day-proposal/gi, ""); }
  line = [...line.replace(/ {2,}/g, " ").trim()].slice(0, 200).join("").trim(); // cut by code point
  if (line === "") line = "Agent proposal";
  return `${line}\n\n${TRAILER}: ${id}`;
}

/** Git blob SHA-1 of the exact UTF-8 bytes GitHub stores for `content`. */
export function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * Reconciler match (docs/04 §7). `c` = one commit from GET /commits?sha=main, plus the blob SHAs at that
 * commit for the proposal's paths: { message, authorName, parents: [sha], blobs: { path: sha|null } }.
 * All of: final line is exactly the trailer; author name exact; one parent; every blob SHA equal.
 */
export function isProposalCommit(c, proposal) {
  const lines = String(c?.message ?? "").replace(/\n$/, "").split("\n");
  if (lines.at(-1) !== `${TRAILER}: ${proposal.id}`) return false;
  if (c.authorName !== `Beach Day Agent (${proposal.agent})`) return false;
  if (!Array.isArray(c.parents) || c.parents.length !== 1) return false;
  return proposal.files.every((f) => c.blobs?.[f.path] === gitBlobSha(f.content));
}

/**
 * Decide from one page of commits. "not_found" (-> CAS failed, no slot) only when the page was NOT full:
 * a full page means older commits in the window were not seen, so the answer is "unknown" (stay committing).
 */
export function reconcileVerdict(commits, proposal, perPage = 50) {
  const hit = commits.find((c) => isProposalCommit(c, proposal));
  if (hit) return { verdict: "found", commitSha: hit.sha };
  return { verdict: commits.length >= perPage ? "unknown" : "not_found" };
}
