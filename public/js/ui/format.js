// Date/number formatting for the beach views. Dates are beach-local "YYYY-MM-DD" strings, so we format them in UTC.
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

const noon = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };

/** { weekday: "Mon", date: "24 Nov", weekdayLong: "Monday" } */
export function dayParts(ymd) {
  const d = noon(ymd);
  return { weekday: WEEKDAY.format(d), weekdayLong: WEEKDAY_LONG.format(d), date: `${d.getUTCDate()} ${MONTH.format(d)}` };
}

export const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
const num = (n) => (Number.isFinite(n) ? Math.round(n) : null);
export const roundHalf = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
export { num };
