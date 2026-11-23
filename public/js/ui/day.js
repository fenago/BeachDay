// Day detail screen (#/day/YYYY-MM-DD).
import { t } from "../copy/copy-deck.js";
import { h, icon } from "./dom.js";
import { dayParts } from "./format.js";
import { SafetyBlock } from "./safety.js";
import { VerdictCard, KeyNumbers, HourlyList } from "./verdict.js";
import { conditionFor, messageBanner, statusText, tryAgainButton, skeleton } from "./today.js";

export function dayView({ beach, forecast, error, date, online, nowHHMM, expandHourly, onRetry, cameFromToday }) {
  const p = dayParts(date);
  const title = `${p.weekdayLong}, ${p.date}`;
  const back = h("a", { class: "back-link", href: "#/", "data-testid": "back" }, icon("chevron-left"), t("ui.day.back"));
  if (cameFromToday) back.addEventListener("click", (e) => { e.preventDefault(); history.back(); }); // no new history entry
  const safety = SafetyBlock(beach);
  if (!forecast) {
    return { title, status: error ? "" : t("status.loading"), condition: "sunny", refresh: true,
      nodes: [back, error ? h("div", { class: "state-stack" }, messageBanner("error", t(error.kind === "offline" || !online ? "error.offline.nocache" : "error.forecast"), "alert"), tryAgainButton(onRetry)) : skeleton(), safety] };
  }
  const idx = forecast.days.findIndex((d) => d.date === date);
  const day = forecast.days[idx];
  if (!day) return { title, status: statusText(forecast, { online }), condition: "sunny", refresh: true, notFound: true, nodes: [] };

  const prev = forecast.days[idx - 1], next = forecast.days[idx + 1];
  const navLink = (d, dir) => h("a", { class: "btn btn--secondary", href: `#/day/${d.date}`, "data-testid": dir === "prev" ? "prev-day" : "next-day", "aria-label": `${t(dir === "prev" ? "ui.day.prev" : "ui.day.next")}: ${dayParts(d.date).weekday} ${dayParts(d.date).date}` },
    dir === "prev" ? icon("chevron-left") : null, dayParts(d.date).weekday, dir === "next" ? icon("chevron-right") : null);

  const hourlyId = "hourly-list";
  const list = HourlyList(day, { id: hourlyId });
  const toggle = h("button", { class: "btn btn--secondary", type: "button", "aria-expanded": "false", "aria-controls": hourlyId, "data-testid": "hourly-toggle" }, t("btn.showHourly"));
  const setOpen = (open) => {
    list.hidden = !open;
    toggle.textContent = open ? t("btn.hideHourly") : t("btn.showHourly");
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setOpen(list.hidden));
  if (expandHourly) queueMicrotask(() => setOpen(true));

  const nodes = [
    back,
    VerdictCard({ day, beach }),
    day.verdict ? h("div", { class: "day-summary" }, KeyNumbers(day.numbers, day)) : null,
    day.hourScores?.length ? h("div", { class: "view-section" }, toggle, list) : null,
    safety,
    (prev || next) ? h("div", { class: "button-row" }, prev ? navLink(prev, "prev") : null, next ? navLink(next, "next") : null) : null,
  ];
  return { title, status: statusText(forecast, { online }), nodes, condition: conditionFor(day, { nowHHMM }), refresh: true };
}
