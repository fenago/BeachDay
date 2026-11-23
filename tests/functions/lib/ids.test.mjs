import { describe, it, expect } from "vitest";
import { ulid, newProposalId, newJobId, isId, isProposalId, isJobId, ID_RE } from "../../../netlify/functions/lib/ids.mts";

describe("ids", () => {
  it("makes p_/j_ ULIDs that match ^[pj]_[0-9A-Z]{26}$ and sort by time", () => {
    const a = newProposalId(1_700_000_000_000), b = newProposalId(1_700_000_000_001), j = newJobId();
    for (const id of [a, b, j]) expect(id).toMatch(ID_RE);
    expect(isProposalId(a)).toBe(true);
    expect(isJobId(j)).toBe(true);
    expect(isJobId(a)).toBe(false);
    expect(a.slice(2, 12) < b.slice(2, 12)).toBe(true);
    expect(ulid(0, () => new Uint8Array(16))).toBe("0".repeat(26));
    expect(ulid()).not.toMatch(/[ILOU]/);
  });
  it("rejects anything else before a lookup", () => {
    for (const bad of ["p_short", "p_" + "a".repeat(26), "x_" + "A".repeat(26), "p_" + "A".repeat(26) + "\n", "../p_x", null, 7])
      expect(isId(bad)).toBe(false);
  });
});
