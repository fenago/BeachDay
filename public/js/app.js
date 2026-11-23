// Beach Day boot: hash router, state, views, install hints and service-worker registration.
// Routes: #/ (Today, or the picker when no beach is saved), #/beaches (picker), #/day/YYYY-MM-DD (day detail).
// No auth code here. All user-visible text comes from copy/copy-deck.js and is set with textContent.
import { t } from "./copy/copy-deck.js";
import { getBeach } from "./data/beaches.js";
import { instantToWallClock } from "./data/beach-window.js";
import { getCached, loadForecast } from "./forecast.js";
import { registerAfterLoad, requestPersistentStorage } from "./pwa/sw-register.js";
import { isStandalone, readEnv } from "./pwa/install-hint.js";
import { h, icon } from "./ui/dom.js";
import { isYmd } from "./ui/format.js";
import { createInstallUi } from "./ui/install.js";
import { PickerView, nearestBeach } from "./ui/picker.js";
import { KEYS, countVisit, read, readFavorites, write, writeFavorites } from "./ui/storage.js";
import { dayView } from "./ui/day.js";
import { todayView, tryAgainButton } from "./ui/today.js";
import { showUpdateToast } from "./ui/toast.js";

const $ = (id) => document.getElementById(id);
const els = { title: $("page-title"), status: $("status"), actions: $("head-actions"), view: $("view"), install: $("install-slot"), toasts: $("toast-region"), announce: $("announce") };

const state = {
  beachId: null, forecast: null, error: null, route: { name: "today" },
  loadId: 0, prevKey: null, expandHourly: false, scroll: new Map(), lastRouteKey: null, firstPaint: true,
};
const online = () => (typeof navigator.onLine === "boolean" ? navigator.onLine : true);
const say = (text) => { els.status.textContent = text; };

const savedBeach = () => { const id = read(KEYS.beach); return id && getBeach(id) ? id : null; };
state.beachId = savedBeach();

export function parseRoute(hash) {
  const m = /^#\/day\/(\d{4}-\d{2}-\d{2})$/.exec(hash ?? "");
  if (m && isYmd(m[1])) return { name: "day", date: m[1] };
  if (hash === "#/beaches") return { name: "beaches" };
  return { name: "today" };
}

// ---- refresh button (persistent element; added to / removed from the header) ----
const refreshBtn = h("button", { class: "btn btn--icon", type: "button", id: "refresh", "data-testid": "refresh", "aria-label": t("btn.refresh"), onclick: onRefresh }, icon("refresh"));
const chooseLink = h("a", { class: "btn btn--text", href: "#/beaches", id: "choose-beach", "data-testid": "choose-beach" }, t("btn.chooseBeach"));
function syncRefresh(show) {
  if (show && !chooseLink.isConnected) els.actions.append(chooseLink);
  if (!show && chooseLink.isConnected) chooseLink.remove();
  if (show && !refreshBtn.isConnected) els.actions.append(refreshBtn);
  if (!show && refreshBtn.isConnected) refreshBtn.remove();
  refreshBtn.setAttribute("aria-disabled", online() ? "false" : "true");
}
function onRefresh() {
  if (!online()) { say(t("ui.offline.refresh")); return; }
  load({ userForced: true });
}

// ---- install + toast ----
let storage = null;
try { storage = window.localStorage; } catch { /* blocked */ }
const install = createInstallUi({ slot: els.install, say, storage, visits: countVisit(), onFocusLost: () => els.title.focus() });

// ---- rendering ----
function setCondition(c) { document.body.dataset.condition = c || "sunny"; }
const nowHHMM = () => instantToWallClock(Date.now()).slice(11, 16);

function apply(vm, { focus }) {
  const active = document.activeElement;
  const hadFocus = Boolean(active && active !== document.body && (els.view.contains(active) || els.install.contains(active)));
  els.title.textContent = vm.title;
  document.title = vm.title === "Beach Day" ? vm.title : `${vm.title} · Beach Day`;
  say(vm.status ?? "");
  // Offline wins: "{beach} selected" must not talk over the Offline status.
  if (state.announce && online()) els.announce.textContent = state.announce;
  state.announce = null;
  syncRefresh(vm.refresh);
  els.view.replaceChildren(...vm.nodes.filter(Boolean));
  setCondition(vm.condition);
  if (vm.hasVerdict) install.verdictShown(); else install.pause();
  if (vm.focusTryAgain) els.view.querySelector("[data-testid=try-again]")?.focus();
  else if (focus) els.title.focus();
  else if (hadFocus && !active.isConnected) els.title.focus(); // the focused element was replaced: don't drop to BODY
}

function paint({ focus = false } = {}) {
  const r = state.route;
  const wantsPicker = r.name === "beaches" || !state.beachId;
  if (wantsPicker) return paintPicker({ focus });
  const beach = getBeach(state.beachId);
  const base = { beach, forecast: state.forecast, error: state.error, online: online(), nowHHMM: nowHHMM(), onRetry: () => load({ userForced: true }), cameFromToday: state.prevKey === "today" };
  if (r.name === "day") {
    const vm = dayView({ ...base, date: r.date, expandHourly: state.expandHourly });
    if (vm.notFound) { location.replace("#/"); return; } // unknown or past day: back to Today
    state.expandHourly = false;
    apply(vm, { focus });
  } else {
    apply(todayView(base), { focus });
  }
}

function paintPicker({ focus }) {
  const saved = state.route.name === "beaches" ? state.beachId : null;
  const view = PickerView({
    favorites: readFavorites(), saved,
    onChoose: choose,
    onToggleFavorite: toggleFavorite,
    onNearest: nearest,
  });
  apply({ title: t("ui.choose.title"), status: "", nodes: [view], condition: "sunny", refresh: false }, { focus });
}

function choose(id) {
  if (!getBeach(id)) return;
  const changed = id !== state.beachId;
  write(KEYS.beach, id);
  state.beachId = id;
  if (changed) { state.forecast = null; state.error = null; }
  const b = getBeach(id);
  state.announce = t("status.beach.selected", { beach: b.name }); // set first: the next paint consumes it
  if (location.hash === "#/" || location.hash === "") route({ focus: true }); else location.hash = "#/";
}

function toggleFavorite(id) {
  const list = readFavorites();
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  writeFavorites(next);
  const active = document.activeElement?.getAttribute?.("data-star");
  paintPicker({ focus: false });
  if (active) els.view.querySelector(`[data-star="${active}"]`)?.focus(); // keep focus on the star after re-render
}

function nearest() {
  if (!navigator.geolocation) { say(t("status.location.off")); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => choose(nearestBeach({ lat: pos.coords.latitude, lon: pos.coords.longitude }).id),
    () => say(t("status.location.off")),
    { timeout: 8000, maximumAge: 600_000 },
  );
}

// ---- data ----
async function load({ userForced = false } = {}) {
  const id = state.beachId;
  if (!id) return;
  const mine = ++state.loadId;
  // No saved forecast: allow 15 s (the default 5 s would end the wait before "slow" could show).
  const first = !state.forecast;
  const slow = setTimeout(() => {
    if (mine !== state.loadId || state.forecast || state.route.name === "beaches") return;
    say(t("status.slow"));
    if (!els.view.querySelector("[data-testid=try-again]")) {
      const b = tryAgainButton(() => { b.remove(); els.title.focus(); load({ userForced: true }); }, false);
      els.view.append(b);
    }
  }, 10_000);
  // A forced refresh inside the 60 s window answers from cache at once: show "Refreshing…" long enough to be seen.
  let hold = null;
  if (userForced && state.forecast) { refreshBtn.setAttribute("aria-busy", "true"); say(t("ui.refreshing")); hold = new Promise((r) => setTimeout(r, 700)); }
  try {
    const f = await loadForecast(id, first ? { userForced, timeoutMs: 15_000 } : { userForced });
    if (hold) await hold;
    if (mine !== state.loadId || id !== state.beachId) return;
    state.forecast = f; state.error = null;
  } catch (err) {
    if (mine !== state.loadId || id !== state.beachId) return;
    state.error = err;
  } finally {
    clearTimeout(slow);
    if (mine === state.loadId) refreshBtn.removeAttribute("aria-busy");
  }
  if (state.route.name !== "beaches") paint();
}

// ---- router ----
function route({ focus = false } = {}) {
  const prev = state.lastRouteKey;
  if (prev) state.scroll.set(prev, window.scrollY);
  state.route = parseRoute(location.hash);
  state.prevKey = prev;
  const key = state.route.name === "day" ? "day" : state.route.name;
  state.lastRouteKey = key;
  state.beachId = savedBeach();
  const showsBeach = state.beachId && state.route.name !== "beaches";
  if (!showsBeach) { paint({ focus }); }
  else {
    if (!state.forecast || state.forecast.beach.id !== state.beachId) {
      state.forecast = getCached(state.beachId); state.error = null;
      paint({ focus });
      load();
    } else {
      paint({ focus });
    }
  }
  const y = key === "today" && prev === "day" ? state.scroll.get("today") ?? 0 : 0;
  window.scrollTo(0, y);
}

window.addEventListener("hashchange", () => {
  state.expandHourly = Boolean(state.nextExpand);
  state.nextExpand = false;
  route({ focus: true });
});
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("[data-testid=see-hourly]");
  if (a) state.nextExpand = true; else if (e.target.closest?.("a.day-row")) state.nextExpand = false;
}, true);
window.addEventListener("online", () => { if (state.beachId) { paint(); load(); } });
window.addEventListener("offline", () => { if (state.beachId && state.route.name !== "beaches") paint(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.beachId && state.route.name !== "beaches" && online()) load();
});

route();

// ---- service worker, updates, storage ----
registerAfterLoad({ onUpdateReady: (applyUpdate) => showUpdateToast(els.toasts, applyUpdate) });
if (isStandalone(readEnv(window))) requestPersistentStorage(window);
