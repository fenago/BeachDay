import { t, SAFETY } from "../copy/copy-deck.js";
import { h, icon, withLink } from "./dom.js";

const MIAMI = "https://www.weather.gov/beach/mfl";

/** The always-visible safety block (ADR-0002): full exact line, NWS link for the beach's office, posted flags. */
export function SafetyBlock(beach) {
  const href = beach?.nws?.url ?? MIAMI;
  return h("div", { class: "safety-block", "data-testid": "safety" },
    h("div", { class: "safety-line" },
      icon("flag"),
      h("div", { class: "safety-line__body" },
        h("p", { class: "safety-line__title" }, t("ui.safety.heading")),
        h("p", {}, withLink(SAFETY.text, SAFETY.linkText, href)),
        h("p", { class: "safety-line__flags" }, t("ui.safety.flags")))));
}
