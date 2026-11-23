import { t, STRINGS } from "../copy/copy-deck.js";
import { BEACHES } from "../data/beaches.js";
import { h, icon } from "./dom.js";

const COUNTY = {
  "miami-beach": "miamidade", "key-biscayne": "miamidade", "cape-florida": "miamidade", haulover: "miamidade",
  hollywood: "broward", "fort-lauderdale": "broward", deerfield: "broward",
  "boca-raton": "palmbeach", delray: "palmbeach", "palm-beach": "palmbeach", jupiter: "palmbeach",
  "key-west": "monroe", "bahia-honda": "monroe",
};
const COUNTY_ORDER = ["miamidade", "broward", "palmbeach", "monroe"];

/** Great-circle distance in km. */
function km(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function nearestBeach(point) {
  return BEACHES.reduce((best, b) => (km(point, b.land) < km(point, best.land) ? b : best), BEACHES[0]);
}

/**
 * Picker view. onChoose(id), onToggleFavorite(id), onNearest() are callbacks; favorites = array of ids.
 * saved = the currently saved beach id (adds Cancel and the empty-favorites hint).
 */
export function PickerView({ favorites, saved, onChoose, onToggleFavorite, onNearest }) {
  const row = (b) => {
    const fav = favorites.includes(b.id);
    return h("li", { class: "beach-item" },
      h("button", { class: "beach-row", type: "button", "data-beach": b.id, "aria-current": saved === b.id ? "true" : null, onclick: () => onChoose(b.id) },
        h("span", {}, h("span", { class: "beach-row__name" }, b.name), h("span", { class: "beach-row__meta" }, b.area)),
        icon("chevron-right")),
      h("button", {
        class: "btn btn--icon", type: "button", "data-star": b.id, "aria-pressed": fav ? "true" : "false",
        "aria-label": t(fav ? "ui.favorite.remove" : "ui.favorite.add", { beach: b.name }),
        onclick: () => onToggleFavorite(b.id),
      }, icon("star")));
  };
  const group = (title, beaches, extra = {}) =>
    h("li", { class: "beach-group", ...extra }, h("h2", { class: "beach-group__title" }, title), h("ul", { class: "beach-group__items" }, beaches.map(row)));

  const favBeaches = BEACHES.filter((b) => favorites.includes(b.id));
  const lists = [];
  const favTitle = STRINGS["ui.favorites"] ?? "Favorites"; // copy id pending (Wren)
  if (favBeaches.length) lists.push(group(favTitle, favBeaches, { "data-testid": "favorites" }));
  for (const c of COUNTY_ORDER) lists.push(group(t(`ui.county.${c}`), BEACHES.filter((b) => COUNTY[b.id] === c)));

  const hint = saved && !favBeaches.length
    ? h("div", { class: "empty-state", "data-testid": "empty-favorites" }, h("p", { class: "empty-state__title" }, t("empty.favorites")))
    : null;

  return h("div", { class: "picker", "data-testid": "picker" },
    saved ? h("a", { class: "back-link", href: "#/", "data-testid": "picker-cancel" }, icon("chevron-left"), t("btn.cancel")) : null,
    h("p", { class: "muted" }, t("ui.choose.sub")),
    h("button", { class: "btn btn--secondary btn--block", type: "button", "data-testid": "nearest", onclick: onNearest }, icon("location"), t("btn.nearest")),
    hint,
    h("ul", { class: "beach-list" }, lists));
}
