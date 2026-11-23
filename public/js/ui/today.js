// Today screen: builds a view model { title, status, nodes, condition, refresh, focusTryAgain, hasVerdict }.
import { t } from "../copy/copy-deck.js";
import { fetchedAtLabel } from "../data/cache-age.js";
import { h, icon } from "./dom.js";
import { SafetyBlock } from "./safety.js";
import { VerdictCard, DayStrip } from "./verdict.js";

export const skeleton = () => h("div", { class: "skeleton", "aria-hidden": "true", "data-testid": "skeleton" },
  h("div", { class: "skeleton__line skeleton__line--title" }, ), h("div", { class: "skeleton__line" }), h("div", { class: "skeleton__line skeleton__line--short" }));

export function tryAgainButton(onRetry, primary = true) {
  return h("button", { class: `btn ${primary ? "btn--primary" : "btn--secondary"}`, type: "button", "data-testid": "try-again", onclick: onRetry }, t("btn.tryAgain"));
}

export function messageBanner(kind, text, role) {
  return h("div", { class: `banner banner--${kind}`, role, "data-testid": role === "alert" ? "error" : "message" },
    icon(kind === "error" ? "x-circle" : "alert"), h("div", { class: "banner__body" }, h("p", { class: "banner__title" }, text)));
}

/** Which day the Today card shows: today, or tomorrow once today's beach hours are over. */
export function pickShownDay(days) {
  const today = days.find((d) => d.isToday);
  const afterHours = today && today.verdict === null && today.reasons.some((r) => r.code === "no_beach_window");
  if (afterHours) return { day: days.find((d) => d.dayIndex === 1) ?? null, afterHours: true };
  return { day: today ?? days[0] ?? null, afterHours: false };
}

export function conditionFor(day, { nowHHMM } = {}) {
  if (!day) return "sunny";
  if (day.isToday && nowHHMM && day.sunrise && day.sunset && (nowHHMM < day.sunrise || nowHHMM >= day.sunset)) return "night";
  if (day.verdict === "skip") return "stormy";
  if (day.verdict === "fair") return "overcast";
  return "sunny";
}

export function statusText(f, { online, afterHours }) {
  if (f.tooOld) return t("status.too.old");
  if (f.error || !online) return t("status.offline.cache", { time: fetchedAtLabel(f.fetchedAt) });
  if (afterHours) return t("status.after.hours");
  if (f.partial?.marine) return t("status.partial");
  return t("status.updated", { time: fetchedAtLabel(f.fetchedAt) });
}

/**
 * @param o {beach, forecast, error, online, nowHHMM, onRetry}
 */
export function todayView({ beach, forecast, error, online, nowHHMM, onRetry }) {
  const safety = SafetyBlock(beach);
  if (!forecast) {
    if (!error) return { title: beach.name, status: t("status.loading"), nodes: [skeleton(), safety], condition: "sunny", refresh: true };
    const offline = error.kind === "offline" || !online;
    return {
      title: beach.name, status: "", condition: "sunny", refresh: true, focusTryAgain: true,
      nodes: [h("div", { class: "state-stack" }, messageBanner("error", t(offline ? "error.offline.nocache" : "error.forecast"), "alert"), tryAgainButton(onRetry)), safety],
    };
  }
  if (forecast.tooOld) {
    return { title: beach.name, status: statusText(forecast, { online }), condition: "sunny", refresh: true,
      nodes: [h("div", { class: "state-stack" }, messageBanner("warn", t("status.too.old")), tryAgainButton(onRetry)), safety] };
  }
  const { day, afterHours } = pickShownDay(forecast.days);
  const banners = [];
  if (forecast.staleBanner && online && !forecast.error) {
    banners.push(messageBanner("warn", t("status.stale", { hours: Math.max(3, Math.floor(forecast.ageMs / 3_600_000)) })));
  }
  if (!day) {
    return { title: beach.name, status: statusText(forecast, { online }), condition: "sunny", refresh: true,
      nodes: [h("div", { class: "state-stack" }, ...banners, messageBanner("warn", t("status.no.verdict")), tryAgainButton(onRetry)), safety] };
  }
  const see = day.verdict
    ? h("a", { class: "btn btn--primary", href: `#/day/${day.date}`, "data-testid": "see-hourly" }, t("btn.seeHourly"))
    : tryAgainButton(onRetry);
  const card = VerdictCard({ day, beach, actions: see });
  const partialRetry = forecast.partial?.marine && day.verdict ? tryAgainButton(onRetry, false) : null;
  const next = forecast.days.filter((d) => d.dayIndex > day.dayIndex);
  const nodes = [
    h("div", { class: "state-stack" }, ...banners),
    card,
    partialRetry,
    safety,
    next.length ? h("section", { class: "view-section", "aria-labelledby": "next-days" }, h("h2", { id: "next-days", class: "t-title-3 panel panel--inset" }, t("ui.nextDays")), DayStrip(next)) : null,
  ];
  return { title: beach.name, status: statusText(forecast, { online, afterHours }), nodes, condition: conditionFor(day, { nowHHMM }), refresh: true, hasVerdict: Boolean(day.verdict) };
}
