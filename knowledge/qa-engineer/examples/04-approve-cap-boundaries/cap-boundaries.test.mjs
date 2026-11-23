// QA boundary table for the site-wide Approve cap (ADR-0008, docs/06 §3.4).
// The reference implementation under test is netlify-engineer's example 03; in the real repo, change the
// import to netlify/functions/lib/limits.mts. Run: node --test cap-boundaries.test.mjs   (Node built-ins only)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, nextLocalMidnight, localDay, APPROVE_CAP, WINDOW_MS } from "../../../netlify-engineer/examples/03-cas-rate-limit-counter/ratelimit.mjs";

const D = (s) => new Date(s);
const rep = (iso, n) => Array(n).fill(iso);
// k approvals spread one minute apart starting at iso
const spread = (iso, k) => Array.from({ length: k }, (_, i) => new Date(D(iso).getTime() + i * 60_000).toISOString());

test("constants are the ADR-0008 numbers", () => {
  assert.deepEqual(APPROVE_CAP, { per31Days: 14, perDay: 5 });
  assert.equal(WINDOW_MS, 31 * 24 * 3600_000); // 744 h, a fixed span, not 31 calendar days
});

// ---- per day: the 5th is allowed (4 used), the 6th is refused (5 used) ----
test("day cap: 4 used -> 5th allowed; 5 used -> 6th refused with reason day", () => {
  const now = D("2026-11-23T20:00:00Z"); // 15:00 EST
  const four = evaluate(spread("2026-11-23T14:00:00Z", 4), now);
  assert.deepEqual([four.allowed, four.usedToday], [true, 4]);
  const five = evaluate(spread("2026-11-23T14:00:00Z", 5), now);
  assert.deepEqual([five.allowed, five.reason, five.usedToday], [false, "day", 5]);
});

// ---- per rolling 31 days: the 14th is allowed (13 used), the 15th is refused (14 used) ----
// spread over distinct days so the day cap cannot be what refuses
const days = (n) => Array.from({ length: n }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}T15:00:00Z`);
test("31-day cap: 13 used -> 14th allowed; 14 used -> 15th refused with reason month", () => {
  const now = D("2026-11-23T20:00:00Z");
  const thirteen = evaluate(days(13), now);
  assert.deepEqual([thirteen.allowed, thirteen.used31, thirteen.usedToday], [true, 13, 0]);
  const fourteen = evaluate(days(14), now);
  assert.deepEqual([fourteen.allowed, fourteen.reason, fourteen.used31], [false, "month", 14]);
  assert.equal(fourteen.retryAt, "2026-12-02T15:00:00.000Z"); // oldest of the last 14 (Nov 1 15:00Z) + 31 days
});

// ---- New York midnight, to the millisecond, in standard time (EST, UTC-5) ----
test("NY midnight in EST: 23:59:59.999 is still the same day, 00:00:00.000 is a new day", () => {
  const used = rep("2026-11-23T15:00:00Z", 5); // Nov 23 NY
  assert.equal(evaluate(used, D("2026-11-24T04:59:59.999Z")).allowed, false); // 23:59:59.999 Nov 23 NY
  assert.equal(evaluate(used, D("2026-11-24T05:00:00.000Z")).allowed, true);  // 00:00:00.000 Nov 24 NY
  assert.equal(nextLocalMidnight(D("2026-11-23T15:00:00Z")).toISOString(), "2026-11-24T05:00:00.000Z");
});

test("the New York day decides, not the UTC day: 8 pm EST is already tomorrow in UTC", () => {
  const used = rep("2026-11-24T01:30:00Z", 5); // 20:30 Nov 23 NY, but Nov 24 in UTC
  assert.equal(evaluate(used, D("2026-11-24T03:00:00Z")).allowed, false); // 22:00 Nov 23 NY: same NY day
  assert.equal(evaluate(used, D("2026-11-24T05:00:00Z")).allowed, true);  // Nov 24 NY
});

// ---- DST 1: spring forward, Sunday 2027-03-14 (a 23-hour day: 05:00Z to 04:00Z next day, EST then EDT) ----
test("DST spring forward 2027-03-14: the day is 23 h long and ends at 04:00Z, not 05:00Z", () => {
  assert.equal(nextLocalMidnight(D("2027-03-14T06:00:00Z")).toISOString(), "2027-03-15T04:00:00.000Z");
  const dayLen = D("2027-03-15T04:00:00Z") - D("2027-03-14T05:00:00Z");
  assert.equal(dayLen / 3600_000, 23);
  const used = [...rep("2027-03-14T05:30:00Z", 2), ...rep("2027-03-14T07:30:00Z", 3)]; // 00:30 EST x2, 03:30 EDT x3 (02:xx does not exist)
  assert.equal(evaluate(used, D("2027-03-15T03:59:59.999Z")).allowed, false);
  assert.equal(evaluate(used, D("2027-03-15T04:00:00.000Z")).allowed, true);
});
test("DST spring forward: approvals on both sides of the missing 02:00 hour are the same day", () => {
  const used = [...rep("2027-03-14T06:59:00Z", 2), ...rep("2027-03-14T07:00:00Z", 3)]; // 01:59 EST x2, 03:00 EDT x3
  assert.equal(localDay(D("2027-03-14T06:59:00Z")), localDay(D("2027-03-14T07:00:00Z")));
  assert.deepEqual([evaluate(used, D("2027-03-14T12:00:00Z")).allowed, evaluate(used, D("2027-03-14T12:00:00Z")).usedToday], [false, 5]);
});

// ---- DST 2: fall back, Sunday 2026-11-01 (a 25-hour day: 04:00Z to 05:00Z next day, EDT then EST) ----
test("DST fall back 2026-11-01: the day is 25 h long and ends at 05:00Z (04:59Z on the 2nd is still the 1st in New York)", () => {
  assert.equal(nextLocalMidnight(D("2026-11-01T12:00:00Z")).toISOString(), "2026-11-02T05:00:00.000Z");
  const dayLen = D("2026-11-02T05:00:00Z") - D("2026-11-01T04:00:00Z");
  assert.equal(dayLen / 3600_000, 25);
  const used = rep("2026-11-01T12:00:00Z", 5);
  assert.equal(evaluate(used, D("2026-11-02T04:59:59.999Z")).allowed, false); // 23:59:59.999 EST, a UTC-"tomorrow" at 4 am
  assert.equal(evaluate(used, D("2026-11-02T05:00:00.000Z")).allowed, true);
});
test("DST fall back: the repeated 01:30 (05:30Z EDT and 06:30Z EST) counts as one day, so 3 + 2 = 5 refuses the 6th", () => {
  assert.equal(localDay(D("2026-11-01T05:30:00Z")), localDay(D("2026-11-01T06:30:00Z")));
  const used = [...rep("2026-11-01T05:30:00Z", 3), ...rep("2026-11-01T06:30:00Z", 2)];
  const r = evaluate(used, D("2026-11-01T07:00:00Z"));
  assert.deepEqual([r.allowed, r.usedToday, r.reason], [false, 5, "day"]);
});

// ---- the rolling window: exact edge and DST ----
test("rolling 31 days: a record exactly 31 x 24 h old has expired; one millisecond younger still counts", () => {
  const now = D("2026-12-04T15:00:00.000Z");
  const oldest = D(now - WINDOW_MS); // Nov 3 15:00Z
  const rest = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => `${d}T15:00:00Z`); // 13
  assert.equal(rest.length, 13);
  const edge = evaluate([oldest.toISOString(), ...rest], now);
  assert.deepEqual([edge.allowed, edge.used31], [true, 13]); // the oldest fell out: 13 used, so the 14th is allowed
  const younger = evaluate([new Date(oldest.getTime() + 1).toISOString(), ...rest], now);
  assert.deepEqual([younger.allowed, younger.used31], [false, 14]);
});
test("rolling window is 744 h across a DST change, not 31 calendar days", () => {
  // 2027-02-20 15:00Z is 10:00 EST. Plus 744 h it is 2027-03-23 15:00Z, which is 11:00 EDT, because the clocks moved on Mar 14.
  // "31 calendar days" would expire the first record at 10:00 EDT (14:00Z), an hour early. The window is 744 h.
  const start = D("2027-02-20T15:00:00Z");
  const times = Array.from({ length: 14 }, (_, i) => new Date(start.getTime() + i * 3600_000).toISOString()); // 14 hourly records; only used31 is asserted
  const r = evaluate(times, D("2027-03-23T14:59:59.999Z"));
  assert.equal(r.used31, 14); // still inside 744 h
  const later = evaluate(times, D("2027-03-23T15:00:00.001Z"));
  assert.equal(later.used31, 13); // the first has just expired
});

// ---- retryAt tells the user when the next slot frees (Wren copy: "Next slot frees Dec 2") ----
test("retryAt: day cap -> next NY midnight; month cap -> oldest of the last 14 + 31 days; both -> the later one", () => {
  const now = D("2026-11-23T20:00:00Z");
  const dayOnly = evaluate(spread("2026-11-23T14:00:00Z", 5), now);
  assert.equal(dayOnly.retryAt, "2026-11-24T05:00:00.000Z");
  const both = evaluate([...days(9), ...spread("2026-11-23T14:00:00Z", 5)], now);
  assert.deepEqual([both.allowed, both.used31, both.usedToday, both.reason], [false, 14, 5, "month"]);
  assert.equal(both.retryAt, "2026-12-02T15:00:00.000Z");
});

// ---- mutation check: the table must tell a correct cap from three plausible bugs ----
// Each mutant is a typical mistake. The cases below must pass on the real code and FAIL on every mutant.
const dayFmtUTC = (d) => d.toISOString().slice(0, 10);
// New York UTC offset in ms at instant d (negative), read through Intl so it knows about DST.
const nyOffsetMs = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
};
function mutant(kind) {
  return (times, now) => {
    // "calendar-days": the same wall-clock time 31 days ago, which is not 744 h when DST changed in between
    const back = new Date(now.getTime() - WINDOW_MS);
    const cutoff = kind === "calendar-days" ? now.getTime() - WINDOW_MS + (nyOffsetMs(now) - nyOffsetMs(back)) : now.getTime() - WINDOW_MS;
    const inWin = times.map((t) => new Date(t)).filter((t) => (kind === "inclusive-edge" ? t.getTime() >= cutoff : t.getTime() > cutoff));
    const dayOf = kind === "utc-day" ? dayFmtUTC : localDay;
    const todayN = inWin.filter((t) => dayOf(t) === dayOf(now)).length;
    const perDay = kind === "off-by-one-day" ? 6 : 5;
    return { allowed: inWin.length < 14 && todayN < perDay };
  };
}
const CASES = [
  ["6th on a day refused", rep("2026-11-23T15:00:00Z", 5), "2026-11-23T20:00:00Z", false],
  ["NY 23:59:59.999 still same day", rep("2026-11-23T15:00:00Z", 5), "2026-11-24T04:59:59.999Z", false],
  ["NY midnight opens a new day", rep("2026-11-23T15:00:00Z", 5), "2026-11-24T05:00:00.000Z", true],
  ["evening EST approvals are still today at 22:00", rep("2026-11-24T01:30:00Z", 5), "2026-11-24T03:00:00Z", false],
  ["edge record exactly 31 d old has expired", [new Date(D("2026-12-04T15:00:00Z") - WINDOW_MS).toISOString(), ...days(13).map((d) => d.replace("2026-11-0", "2026-11-1"))], "2026-12-04T15:00:00.000Z", true],
  ["744 h not 31 calendar days across DST", [D("2027-02-20T15:00:00Z").toISOString(), ...days(13).map((d) => d.replace("2026-11", "2027-03"))], "2027-03-23T14:30:00.000Z", false],
  ["fall-back day is 25 h", rep("2026-11-01T12:00:00Z", 5), "2026-11-02T04:59:59.999Z", false],
];
const real = (t, n) => ({ allowed: evaluate(t, n).allowed });
for (const [name, times, now, want] of CASES) {
  test(`case table, real code: ${name}`, () => assert.equal(real(times, D(now)).allowed, want));
}
for (const kind of ["utc-day", "inclusive-edge", "calendar-days", "off-by-one-day"]) {
  test(`mutant "${kind}" is caught by at least one case`, () => {
    const m = mutant(kind);
    const caught = CASES.filter(([, times, now, want]) => m(times, D(now)).allowed !== want).map(([n]) => n);
    console.log(`  mutant ${kind} caught by: ${caught.join(" | ") || "NOTHING"}`);
    assert.ok(caught.length > 0, `no case distinguishes the ${kind} bug`);
  });
}
