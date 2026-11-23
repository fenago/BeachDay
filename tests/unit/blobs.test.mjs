import { test, expect, vi } from "vitest";
const getStore = vi.fn((opts) => ({ opts }));
vi.mock("@netlify/blobs", () => ({ getStore }));
const { STORE_NAMES, openStore, realStores } = await import("../../netlify/functions/lib/blobs.mts");

test("store names are legal (at most 64 bytes, no / or :) and are the four documented stores", () => {
  expect(Object.keys(STORE_NAMES).sort()).toEqual(["audit", "jobs", "proposals", "ratelimit"]);
  for (const n of Object.values(STORE_NAMES)) { expect(Buffer.byteLength(n)).toBeLessThanOrEqual(64); expect(n).not.toMatch(/[/:]/); }
});

test("every store is site-wide (getStore) with strong consistency", () => {
  expect(openStore("jobs").opts).toEqual({ name: "jobs", consistency: "strong" });
});

test("realStores opens nothing until used, and opens each store once", () => {
  getStore.mockClear();
  const s = realStores();
  expect(getStore).not.toHaveBeenCalled();
  expect(s.proposals).toBe(s.proposals);
  expect(getStore).toHaveBeenCalledTimes(1);
  void s.ratelimit;
  expect(getStore).toHaveBeenCalledTimes(2);
});
