// Run: node --test install-prompt.test.mjs   (Node 22, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, isStandalone, iosHint, dismissIosHint, createInstallController } from './install-prompt.mjs';

const UA = {
  // From WebKit's "WebKit Features in Safari 26.0" post (OS token frozen at 18_6, Version/26.0):
  iphoneSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneChromeOld: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/109.0.5414.83 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  pixelChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};
const mm = (matches) => () => ({ matches });
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('platform detection', () => {
  assert.deepEqual(detectPlatform({ userAgent: UA.iphoneSafari26 }), { isIOS: true, isAndroid: false, iosBrowser: 'safari', iosVersion: 18.06 });
  assert.equal(detectPlatform({ userAgent: UA.iphoneChrome }).iosBrowser, 'chrome');
  assert.equal(detectPlatform({ userAgent: UA.iphoneInstagram }).iosBrowser, 'in-app');
  const ipad = detectPlatform({ userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 });
  assert.equal(ipad.isIOS, true);
  assert.equal(detectPlatform({ userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 0 }).isIOS, false); // real Mac
  assert.deepEqual(detectPlatform({ userAgent: UA.pixelChrome }), { isIOS: false, isAndroid: true, iosBrowser: null, iosVersion: null });
});

test('standalone detection: display-mode or navigator.standalone', () => {
  assert.equal(isStandalone({ matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) }), true);
  assert.equal(isStandalone({ matchMedia: mm(false), navigatorStandalone: true }), true);
  assert.equal(isStandalone({ matchMedia: mm(false) }), false);
});

test('iOS hint: shown in Safari tab, hidden when installed, Android never', () => {
  const s = memStorage();
  assert.equal(iosHint({ userAgent: UA.iphoneSafari26, matchMedia: mm(false) }, { storage: s }).variant, 'share-sheet');
  assert.equal(iosHint({ userAgent: UA.iphoneSafari26, matchMedia: mm(true) }, { storage: s }), null);
  assert.equal(iosHint({ userAgent: UA.iphoneSafari26, matchMedia: mm(false), navigatorStandalone: true }, { storage: s }), null);
  assert.equal(iosHint({ userAgent: UA.pixelChrome, matchMedia: mm(false) }, { storage: s }), null);
});

test('iOS hint variants: Chrome 16.4+ ok, Chrome <=16.3 -> Safari, in-app -> open in browser', () => {
  assert.equal(iosHint({ userAgent: UA.iphoneChrome, matchMedia: mm(false) }).variant, 'share-sheet');
  assert.equal(iosHint({ userAgent: UA.iphoneChromeOld, matchMedia: mm(false) }).variant, 'open-in-safari');
  assert.equal(iosHint({ userAgent: UA.iphoneInstagram, matchMedia: mm(false) }).variant, 'open-in-browser');
});

test('dismissal snoozes the hint for 14 days; blocked storage still works', () => {
  const s = memStorage();
  const t0 = Date.parse('2026-11-23T15:00:00Z');
  dismissIosHint(s, t0);
  const env = { userAgent: UA.iphoneSafari26, matchMedia: mm(false) };
  assert.equal(iosHint(env, { storage: s, now: t0 + 13 * 864e5 }), null);
  assert.equal(iosHint(env, { storage: s, now: t0 + 14 * 864e5 }).variant, 'share-sheet');
  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(iosHint(env, { storage: throwing }).variant, 'share-sheet');
  dismissIosHint(throwing); // must not throw
});

test('beforeinstallprompt controller: hidden -> shown -> prompt once -> hidden', async () => {
  const win = new EventTarget();
  const ui = { visible: false, show() { this.visible = true; }, hide() { this.visible = false; } };
  const ctl = createInstallController(win, ui);
  assert.equal(await ctl.install(), 'unavailable');
  assert.equal(ui.visible, false);

  let prompted = 0;
  const evt = new Event('beforeinstallprompt', { cancelable: true });
  evt.prompt = async () => { prompted++; return { outcome: 'accepted', platform: 'web' }; };
  win.dispatchEvent(evt);
  assert.equal(evt.defaultPrevented, true, 'must preventDefault to show our own UI');
  assert.equal(ui.visible, true);
  assert.equal(await ctl.install(), 'accepted');
  assert.equal(await ctl.install(), 'unavailable', 'a deferred prompt can only be used once');
  assert.equal(prompted, 1);
  assert.equal(ui.visible, false);
});

test('older Chromium: prompt() resolves undefined, outcome comes from userChoice; appinstalled hides button', async () => {
  const win = new EventTarget();
  const ui = { visible: false, show() { this.visible = true; }, hide() { this.visible = false; } };
  const ctl = createInstallController(win, ui);
  const evt = new Event('beforeinstallprompt', { cancelable: true });
  evt.prompt = async () => undefined;
  evt.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
  win.dispatchEvent(evt);
  assert.equal(await ctl.install(), 'dismissed');
  const evt2 = new Event('beforeinstallprompt', { cancelable: true });
  evt2.prompt = async () => ({ outcome: 'accepted' });
  win.dispatchEvent(evt2);
  win.dispatchEvent(new Event('appinstalled'));
  assert.equal(ui.visible, false);
  assert.equal(ctl.available, false);
});
