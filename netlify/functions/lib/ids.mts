// IDs for proposals (p_<ULID>) and jobs (j_<ULID>), docs/04 §2.1.
// ULID = 48-bit ms timestamp + 80 random bits, Crockford base32, 26 chars [0-9A-Z] (no I, L, O, U).
// Validate every :id with isId() BEFORE any Blobs lookup.
import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ID_RE = /^[pj]_[0-9A-Z]{26}$/;
export const PROPOSAL_ID_RE = /^p_[0-9A-Z]{26}$/;
export const JOB_ID_RE = /^j_[0-9A-Z]{26}$/;

export function ulid(now: number = Date.now(), rand: (n: number) => Uint8Array = randomBytes): string {
  let t = Math.floor(now);
  if (!Number.isSafeInteger(t) || t < 0 || t > 2 ** 48 - 1) throw new Error("ulid: bad time");
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = rand(16);
  let r = "";
  for (let i = 0; i < 16; i++) r += CROCKFORD[bytes[i] % 32];
  return time + r;
}

export const newProposalId = (now?: number): string => `p_${ulid(now)}`;
export const newJobId = (now?: number): string => `j_${ulid(now)}`;

export const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
export const isProposalId = (v: unknown): v is string => typeof v === "string" && PROPOSAL_ID_RE.test(v);
export const isJobId = (v: unknown): v is string => typeof v === "string" && JOB_ID_RE.test(v);
