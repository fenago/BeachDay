import { t } from "../copy/copy-deck.js";
import { h } from "./dom.js";

/** "A new version is ready." + Refresh. Does not move focus, does not auto-dismiss, shows once. */
export function showUpdateToast(region, apply) {
  if (region.querySelector("[data-testid=update-toast]")) return;
  region.append(h("div", { class: "toast toast--update", "data-testid": "update-toast" },
    h("span", { class: "toast__text" }, t("ui.update.ready")),
    h("button", { class: "btn btn--primary btn--sm", type: "button", "data-testid": "update-refresh", onclick: apply }, t("btn.refresh"))));
}
