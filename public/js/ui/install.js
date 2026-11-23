// Install UX wiring: Android/Chromium button (beforeinstallprompt) and the iOS Add to Home Screen sheet.
// Never on first launch, never over the picker/loading/error, 14-day snooze, nothing when standalone.
import { t } from "../copy/copy-deck.js";
import { createInstallController, dismissIosHint, iosHint, isSnoozed, isStandalone, readEnv } from "../pwa/install-hint.js";
import { h, icon } from "./dom.js";

export const FIRST_VISIT_DELAY_MS = 30_000;
export const RETURN_VISIT_DELAY_MS = 2_000;

export function createInstallUi({ slot, say, storage, visits, win = window, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  let timer = null, gateOpen = false, androidReady = false, sheet = null, androidShown = false;
  const env = () => readEnv(win);
  const standalone = () => isStandalone(env());

  function hideAndroid() { androidShown = false; slot.hidden = true; slot.replaceChildren(); }
  function showAndroid() {
    if (androidShown || standalone() || isSnoozed(storage)) return;
    androidShown = true;
    slot.replaceChildren(h("div", { class: "button-row" },
      h("button", { class: "btn btn--secondary install-action", type: "button", "data-testid": "install", onclick: () => controller.install() }, icon("plus-square"), t("install.android.label")),
      h("button", { class: "btn btn--text", type: "button", "data-testid": "install-not-now", onclick: () => { dismissIosHint(storage); hideAndroid(); say(t("install.dismissed")); } }, t("btn.notNow"))));
    slot.hidden = false;
  }
  const controller = createInstallController(win, {
    show() { androidReady = true; if (gateOpen) showAndroid(); },
    hide() { hideAndroid(); },
    installed() { androidReady = false; say(t("install.android.done")); },
  });

  function openIosSheet(hint) {
    if (sheet) return;
    const title = h("h2", { class: "sheet__title", id: "install-sheet-title" }, t("install.ios.title"));
    const body = hint.variant === "share-sheet"
      ? [h("p", {}, t("install.ios.why")),
         h("ol", { class: "install-steps" },
           h("li", {}, h("span", {}, t("install.ios.step1"), " ", icon("share"))),
           h("li", {}, h("span", {}, t("install.ios.step2"), " ", icon("plus-square"))),
           h("li", {}, h("span", {}, t("install.ios.step3"))))]
      : [h("p", {}, hint.text)]; // other variants: fallback wording from install-hint.js (copy ids pending, Wren)
    const done = h("button", { class: "btn btn--primary", type: "button", "data-testid": "install-done", onclick: () => sheet.close() }, t("btn.done"));
    sheet = h("dialog", { class: "sheet", "aria-labelledby": "install-sheet-title", "data-testid": "install-sheet" },
      h("div", { class: "sheet__grabber" }), title, h("div", { class: "sheet__body" }, body), h("div", { class: "sheet__footer" }, done));
    sheet.addEventListener("close", () => { dismissIosHint(storage); sheet.remove(); sheet = null; say(t("install.dismissed")); });
    win.document.body.append(sheet);
    sheet.showModal();
  }

  function openGate() {
    gateOpen = true; timer = null;
    if (androidReady) showAndroid();
    const hint = iosHint(env(), { storage });
    if (hint) openIosSheet(hint);
  }

  return {
    controller,
    /** A verdict is on screen. Starts the delay once; a later pause() cancels it. */
    verdictShown() {
      if (gateOpen || timer || standalone() || isSnoozed(storage)) return;
      timer = setTimeoutFn(openGate, visits >= 2 ? RETURN_VISIT_DELAY_MS : FIRST_VISIT_DELAY_MS);
    },
    /** Picker, loading or error: cancel a pending timer and never interrupt. */
    pause() { if (timer) { clearTimeoutFn(timer); timer = null; } },
    get sheetOpen() { return Boolean(sheet); },
  };
}
