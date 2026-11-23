// Verdict card, reasons, advice, key numbers, day strip and hourly list. Pure functions that return elements.
import { t, STRINGS, VERDICTS, verdictFor } from "../copy/copy-deck.js";
import { formatClock } from "../data/beach-window.js";
import { h, icon, spoken } from "./dom.js";
import { dayParts, num, roundHalf } from "./format.js";

const safeT = (id, params) => { try { return t(id, params ?? {}); } catch { return null; } };

export function VerdictChip(verdictKey, { large = true } = {}) {
  const v = VERDICTS[verdictKey];
  if (!v) {
    const id = STRINGS["ui.verdict.none.short"] ? "ui.verdict.none.short" : "status.no.verdict"; // short chip id from Wren; full sentence until it exists
    return h("span", { class: `verdict verdict--none${large ? " verdict--lg" : ""}` }, t(large ? "status.no.verdict" : id));
  }
  return h("span", { class: `verdict verdict--${verdictKey}${large ? " verdict--lg" : ""}`, "data-verdict": verdictKey }, icon(v.icon), v.label);
}

function reasonKind(copyId) {
  if (copyId.startsWith("reason.pos.")) return ["--positive", "check-circle"];
  if (copyId === "reason.feels" || copyId === "reason.water") return ["", "info"];
  return ["--negative", "alert"];
}

export function ReasonList(reasons) {
  const items = [];
  for (const r of (reasons ?? []).slice(0, 4)) {
    const text = safeT(r.copyId, r.params);
    if (!text) continue;
    const [mod, ic] = reasonKind(r.copyId);
    items.push(h("li", { class: `reason-list__item${mod ? " reason-list__item" + mod : ""}` }, icon(ic), text));
  }
  return items.length ? h("ul", { class: "reason-list", "data-testid": "reasons" }, items) : null; // a Great day may have none
}

export const dateLine = (day, beach) => {
  const p = dayParts(day.date);
  return `${day.isToday ? t("ui.today") + " · " : ""}${p.weekday} ${p.date}${beach ? " · " + beach.name : ""}`;
};

export const bestHoursText = (day) =>
  day.bestWindow ? t("ui.bestHours", { start: formatClock(day.bestWindow.start), end: formatClock(day.bestWindow.end) }) : "";

/** The hero card. `actions` is an optional element (e.g. the See Hourly link). */
export function VerdictCard({ day, beach, actions }) {
  const id = `verdict-${day.date}`;
  const none = !day.verdict;
  const outlook = day.confidence === "outlook";
  const advice = (day.advice ?? []).map((a) => safeT(a.copyId, a.params)).filter(Boolean);
  if (outlook && !(day.advice ?? []).some((a) => a.copyId === "advice.outlook")) advice.push(t("advice.outlook"));
  const confidence = day.confidence === "medium" ? t("advice.confidence.medium") : day.confidence === "low" && !none ? t("advice.confidence.low") : "";
  return h("section", { class: "verdict-card", "aria-labelledby": id, "data-testid": "verdict-card", "data-verdict": day.verdict ?? "none", "data-date": day.date },
    h("p", { class: "verdict-card__date" }, dateLine(day, beach)),
    h("h2", { id, class: "verdict-card__title", "data-testid": "verdict-title" }, none ? VerdictChip(null) : VerdictChip(day.verdict)),
    outlook ? h("div", { class: "verdict-card__tags" }, h("span", { class: "tag tag--outlook" }, t("ui.outlook"))) : null,
    !none && day.bestWindow ? h("p", { class: "verdict-card__best", "data-testid": "best-hours" }, bestHoursText(day)) : null,
    none ? null : ReasonList(day.reasons),
    advice.map((a) => h("p", { class: "verdict-card__advice" }, a)),
    confidence ? h("p", { class: "verdict-card__confidence" }, confidence) : null,
    actions ? h("div", { class: "verdict-card__actions" }, actions) : null);
}

// ---- key numbers ----
export function KeyNumbers(n, day) {
  if (!n) return null;
  const cell = (key, label, ic, value) =>
    h("div", { class: "key-number", "data-key": key }, h("dt", {}, icon(ic, "icon--sm"), label), h("dd", {}, value));
  const f = (v) => (v == null ? null : num(v));
  const temp = (v) => (v == null ? "–" : spoken(`${f(v)} °F`, `${f(v)} degrees Fahrenheit`));
  return h("dl", { class: "key-numbers", "data-testid": "key-numbers" },
    cell("feels", t("ui.key.feels"), "thermometer", temp(n.feelsF)),
    cell("wind", t("ui.key.wind"), "wind", n.windMph == null ? "–" : spoken(`${f(n.windMph)} mph`, `${f(n.windMph)} miles per hour`)),
    cell("rain", t("ui.key.rain"), "rain", n.rainChancePct == null ? "–" : spoken(`${f(n.rainChancePct)}%`, `${f(n.rainChancePct)} percent`)),
    cell("waves", t("ui.key.waves"), "wave", n.waveFt == null || !day.marineAvailable ? t("status.waves.na") : spoken(`${roundHalf(n.waveFt)} ft`, `${roundHalf(n.waveFt)} ${roundHalf(n.waveFt) === 1 ? "foot" : "feet"}`)),
    cell("water", t("ui.key.water"), "thermometer", n.seaTempF == null ? t("status.water.na") : temp(n.seaTempF)),
    cell("uv", t("ui.key.uv"), "uv", n.uv == null ? "–" : String(f(n.uv))));
}

// ---- next days ----
export function DayStrip(days) {
  return h("ul", { class: "day-strip", "data-testid": "day-strip" }, days.map((d) => {
    const p = dayParts(d.date);
    const outlook = d.confidence === "outlook";
    return h("li", {},
      h("a", { class: `day-row${outlook ? " day-row--outlook" : ""}`, href: `#/day/${d.date}`, "data-date": d.date, "data-verdict": d.verdict ?? "none" },
        h("span", { class: "day-row__name" }, p.weekday, h("span", { class: "day-row__date" }, p.date)),
        h("span", { class: "day-row__verdict" }, VerdictChip(d.verdict, { large: false }), outlook ? h("span", { class: "tag tag--outlook" }, t("ui.outlook")) : null),
        icon("chevron-right", "icon--chevron")));
  }));
}

// ---- hourly ----
const ORDER = ["skip", "fair", "good", "great"];
const STOP_COPY = { thunderstorms: "reason.thunder", thunder_wait: "reason.thunder.wait", too_windy: "reason.wind.stop", dangerous_heat: "reason.heat.stop" };
export function HourlyList(day, { id } = {}) {
  const best = day.bestWindow;
  const inBest = (time) => {
    if (!best) return false;
    const hhmm = time.slice(11, 16);
    return hhmm >= best.start && hhmm < best.end;
  };
  // A short window caps the day at Good, so no hour may read better than the card.
  const capped = day.verdict && day.rawScore != null && day.score != null && day.score < day.rawScore;
  const rows = (day.hourScores ?? []).map((hs) => {
    const stopId = (hs.hardStops ?? []).map((c) => STOP_COPY[c]).find(Boolean);
    let v = hs.score == null ? null : stopId ? VERDICTS.skip : verdictFor(hs.score);
    if (v && capped && ORDER.indexOf(v.id.split(".")[1]) > ORDER.indexOf(day.verdict)) v = VERDICTS[day.verdict];
    const isBest = inBest(hs.time);
    const cls = `hourly-row${isBest ? " hourly-row--best" : stopId ? " hourly-row--stop" : ""}`;
    return h("li", {}, h("div", { class: cls, "data-time": hs.time.slice(11, 16) },
      h("span", { class: "hourly-row__time" }, formatClock(hs.time)),
      v ? icon(v.icon) : icon("info"),
      h("span", { class: "hourly-row__detail" }, stopId ? t(stopId) : isBest ? t("ui.hourly.best") : ""),
      h("span", { class: "hourly-row__label" }, v ? v.short : "–")));
  });
  return h("ul", { class: "hourly-list", id, "data-testid": "hourly", hidden: true }, rows);
}
