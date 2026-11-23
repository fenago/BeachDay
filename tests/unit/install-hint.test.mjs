import { describe, it, expect } from "vitest";
import { detectPlatform, isStandalone, iosHint, dismissIosHint, isSnoozed, createInstallController, HINT_SNOOZE_MS } from "../../public/js/pwa/install-hint.js";

const UA = {
  iphoneSafari26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneChromeOld: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/109.0.5414.83 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  pixelChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};
const mm = (matches) => () => ({ matches });
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const makeUi = () => ({ visible: false, show() { this.visible = true; }, hide() { this.visible = false; } });
const bip = (outcomeFn) => { const e = new Event("beforeinstallprompt", { cancelable: true }); Object.assign(e, outcomeFn); return e; };

describe("platform and standalone detection", () => {
  it("classifies iOS, iPadOS desktop UA, Android", () => {
    expect(detectPlatform({ userAgent: UA.iphoneSafari26 })).toEqual({ isIOS: true, isAndroid: false, iosBrowser: "safari", iosVersion: 18.06 });
    expect(detectPlatform({ userAgent: UA.iphoneChrome }).iosBrowser).toBe("chrome");
    expect(detectPlatform({ userAgent: UA.iphoneInstagram }).iosBrowser).toBe("in-app");
    expect(detectPlatform({ userAgent: UA.ipadDesktop, platform: "MacIntel", maxTouchPoints: 5 }).isIOS).toBe(true);
    expect(detectPlatform({ userAgent: UA.ipadDesktop, platform: "MacIntel", maxTouchPoints: 0 }).isIOS).toBe(false);
    expect(detectPlatform({ userAgent: UA.pixelChrome })).toEqual({ isIOS: false, isAndroid: true, iosBrowser: null, iosVersion: null });
  });
  it("standalone = display-mode or navigator.standalone", () => {
    expect(isStandalone({ matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }) })).toBe(true);
    expect(isStandalone({ matchMedia: mm(false), navigatorStandalone: true })).toBe(true);
    expect(isStandalone({ matchMedia: mm(false) })).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
});

describe("iOS hint", () => {
  it("shows in a Safari tab, hides when installed, never on Android", () => {
    const s = memStorage();
    expect(iosHint({ userAgent: UA.iphoneSafari26, matchMedia: mm(false) }, { storage: s }).variant).toBe("share-sheet");
    expect(iosHint({ userAgent: UA.iphoneSafari26, matchMedia: mm(true) }, { storage: s })).toBeNull();
    expect(iosHint({ userAgent: UA.iphoneSafari26, matchMedia: mm(false), navigatorStandalone: true }, { storage: s })).toBeNull();
    expect(iosHint({ userAgent: UA.pixelChrome, matchMedia: mm(false) }, { storage: s })).toBeNull();
  });
  it("variants: Chrome 16.4+ ok, Chrome 16.3 -> Safari, in-app -> open in browser", () => {
    expect(iosHint({ userAgent: UA.iphoneChrome, matchMedia: mm(false) }).variant).toBe("share-sheet");
    expect(iosHint({ userAgent: UA.iphoneChromeOld, matchMedia: mm(false) }).variant).toBe("open-in-safari");
    expect(iosHint({ userAgent: UA.iphoneInstagram, matchMedia: mm(false) }).variant).toBe("open-in-browser");
  });
  it("snoozes for exactly 14 days; blocked storage still works", () => {
    expect(HINT_SNOOZE_MS).toBe(14 * 864e5);
    const s = memStorage();
    const t0 = Date.parse("2026-11-23T15:00:00Z");
    dismissIosHint(s, t0);
    const env = { userAgent: UA.iphoneSafari26, matchMedia: mm(false) };
    expect(iosHint(env, { storage: s, now: t0 + 14 * 864e5 - 1 })).toBeNull();
    expect(iosHint(env, { storage: s, now: t0 + 14 * 864e5 }).variant).toBe("share-sheet");
    const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
    expect(iosHint(env, { storage: throwing }).variant).toBe("share-sheet");
    expect(() => dismissIosHint(throwing)).not.toThrow();
  });
});

describe("beforeinstallprompt controller", () => {
  it("hidden -> shown -> prompt once -> hidden", async () => {
    const win = new EventTarget(); const ui = makeUi();
    const ctl = createInstallController(win, ui);
    expect(await ctl.install()).toBe("unavailable");
    let prompted = 0;
    const evt = bip({ prompt: async () => { prompted++; return { outcome: "accepted" }; } });
    win.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(ui.visible).toBe(true);
    expect(await ctl.install()).toBe("accepted");
    expect(await ctl.install()).toBe("unavailable");
    expect(prompted).toBe(1);
    expect(ui.visible).toBe(false);
  });
  it("older Chromium reads userChoice; appinstalled hides the button", async () => {
    const win = new EventTarget(); const ui = makeUi();
    const ctl = createInstallController(win, ui);
    win.dispatchEvent(bip({ prompt: async () => undefined, userChoice: Promise.resolve({ outcome: "dismissed" }) }));
    expect(await ctl.install()).toBe("dismissed");
    win.dispatchEvent(bip({ prompt: async () => ({ outcome: "accepted" }) }));
    win.dispatchEvent(new Event("appinstalled"));
    expect(ui.visible).toBe(false);
    expect(ctl.available).toBe(false);
  });
  it("a dismissed prompt is not offered again this session", async () => {
    const win = new EventTarget(); const ui = makeUi();
    const ctl = createInstallController(win, ui);
    win.dispatchEvent(bip({ prompt: async () => ({ outcome: "dismissed" }) }));
    await ctl.install();
    win.dispatchEvent(bip({ prompt: async () => ({ outcome: "accepted" }) }));
    expect(ui.visible).toBe(false);
  });
});

describe("isSnoozed (shared by the iOS sheet and the Chromium button)", () => {
  it("is true for exactly 14 days after a dismissal and false with blocked storage", () => {
    const s = memStorage();
    const t0 = Date.parse("2026-11-23T15:00:00Z");
    expect(isSnoozed(s, t0)).toBe(false);
    dismissIosHint(s, t0);
    expect(isSnoozed(s, t0 + 14 * 864e5 - 1)).toBe(true);
    expect(isSnoozed(s, t0 + 14 * 864e5)).toBe(false);
    expect(isSnoozed({ getItem() { throw new Error("x"); } }, t0)).toBe(false);
  });
});
