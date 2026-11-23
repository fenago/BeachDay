// Agents page sign-in screens (Wren's example 04 flow spec): S1 sign in, S2 create account, S3 check your email,
// S3b the one-button email-link screen, S4 reset, S5 new password, S7 session ended (S1 + notice), S12 via security.js.
// Rules:
// - Every Supabase call goes through auth.js. This file never sees a token.
// - Text goes in with textContent / Text nodes only. No innerHTML anywhere.
// - No email link acts on load: S3b runs confirmFromEmailLink() only on the tap.
// - Sign-up, reset and resend never reveal whether an address has an account.
// - Inputs have no `name`, so a form that somehow submitted without JS would send nothing (no password in a URL).
// - Errors are mapped from codes to Wren's copy ids. Supabase's own text never reaches the page.
import { STRINGS, t as deckT } from "../copy/copy-deck.js";
import { mountSecurity } from "./security.js";

export const MIN_PASSWORD_LENGTH = 12; // docs/04 §4.5, the Supabase Dashboard setting
export const RESEND_COOLDOWN_S = 60;   // Supabase per-user email cooldown default (knowledge doc 06)
export const AUTH_ROUTES = Object.freeze({
  signIn: "#/console", signUp: "#/console/signup", checkEmail: "#/console/check-email",
  forgot: "#/console/forgot", security: "#/console/security",
});
const OWN_ROUTES = new Set([AUTH_ROUTES.signUp, AUTH_ROUTES.checkEmail, AUTH_ROUTES.forgot]);
/** True for the hash routes this module renders on its own while signed out (main.js can leave them to us). */
export const isAuthRoute = (route) => OWN_ROUTES.has(route);

// Notices main.js can ask S1 to show (S7 and the sign-out results).
const NOTICES = Object.freeze({
  sessionExpired: "console.session.expired",
  signedOut: "auth.signout.done",
  signedOutAll: "auth.signout.all.done",
  emailConfirmed: "auth.confirm.done",
});
// Strings not in Wren's deck yet. The deck wins once it has the id (requested in the W2 HANDOFF).
const LOCAL_COPY = Object.freeze({
  "agents.account": "Signed in as {email}",
  "auth.totp.qr.alt": "QR code for your authenticator app",
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SVG_NS = "http://www.w3.org/2000/svg";

// ---------- small DOM helpers (textContent only) ----------
export function makeKit(copy) {
  const deck = typeof copy === "function" ? copy : typeof copy?.t === "function" ? copy.t : deckT;
  const tx = (id, vars) => {
    if (Object.prototype.hasOwnProperty.call(STRINGS, id) || !(id in LOCAL_COPY)) return deck(id, vars);
    return LOCAL_COPY[id].replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ""));
  };
  let seq = 0;
  const uid = (p) => `auth-${p}-${++seq}`;
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `/img/sprite.svg#${name}`);
    svg.append(use);
    return svg;
  }
  /** .auth-card with one h1, an optional sub line and a status region that exists before any text is written. */
  function card(screen, titleId, subText) {
    const h1 = el("h1", { class: "auth-card__title", tabindex: "-1", id: uid("title") }, tx(titleId));
    const head = el("div", { class: "auth-card__head" }, h1, subText ? el("p", { class: "auth-card__sub" }, subText) : null);
    const status = el("p", { class: "status-line", role: "status" });
    const section = el("section", { class: "auth-card", "data-screen": screen, "aria-labelledby": h1.id }, head, status);
    return { section, h1, status };
  }
  /** A form-level alert region (.form-error, role=alert), empty until there is something to say. */
  function alertBox() {
    const box = el("div", { class: "form-error", role: "alert" });
    return {
      box,
      say(id, vars, ...extra) { box.replaceChildren(icon("alert"), el("p", {}, tx(id, vars)), ...extra); },
      clear() { box.replaceChildren(); },
    };
  }
  function field({ label, type = "text", autocomplete, inputmode, hint, extra = {} }) {
    const id = uid("in");
    const input = el("input", { id, class: "input", type, autocomplete, inputmode, ...extra });
    const hintEl = hint ? el("p", { class: "field__hint", id: uid("hint") }, hint) : null;
    const err = el("p", { class: "field__error", id: uid("err") });
    const describe = () => {
      const ids = [hintEl?.id, err.childNodes.length ? err.id : null].filter(Boolean);
      if (ids.length) input.setAttribute("aria-describedby", ids.join(" ")); else input.removeAttribute("aria-describedby");
    };
    describe();
    const wrap = el("div", { class: "field" }, el("label", { class: "field__label", for: id }, label), input, hintEl, err);
    return {
      wrap, input,
      setError(id, vars) {
        if (id) { err.replaceChildren(icon("alert"), document.createTextNode(tx(id, vars))); input.setAttribute("aria-invalid", "true"); }
        else { err.replaceChildren(); input.removeAttribute("aria-invalid"); }
        describe();
      },
    };
  }
  /** Password with a Show Password toggle (aria-pressed). Paste and password managers are never blocked. */
  function passwordField({ label, autocomplete, hint }) {
    const f = field({ label, type: "password", autocomplete, hint, extra: { autocapitalize: "none", spellcheck: "false" } });
    const show = el("button", { type: "button", class: "btn btn--text", "aria-pressed": "false", "aria-controls": f.input.id }, tx("btn.showPassword"));
    show.addEventListener("click", () => {
      const on = show.getAttribute("aria-pressed") !== "true";
      show.setAttribute("aria-pressed", String(on));
      f.input.type = on ? "text" : "password";
    });
    f.input.replaceWith(el("div", { class: "password-row" }, f.input, show));
    return { ...f, show };
  }
  function emailField({ autocomplete = "username", value = "" } = {}) {
    const f = field({ label: tx("auth.field.email"), type: "email", autocomplete, inputmode: "email", extra: { autocapitalize: "none", spellcheck: "false" } });
    f.input.value = value;
    return f;
  }
  function button(textId, cls, onClick, attrs = {}) {
    const b = el("button", { type: "button", class: `btn ${cls}`, ...attrs }, tx(textId));
    if (onClick) b.addEventListener("click", (e) => { if (b.getAttribute("aria-disabled") === "true") { e.preventDefault(); return; } onClick(e); });
    return b;
  }
  /** Busy: aria-disabled + aria-busy, optional busy label; taps are ignored until done. */
  function busy(btn, on, labelId) {
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.setAttribute("aria-disabled", "true"); btn.setAttribute("aria-busy", "true");
      if (labelId) btn.textContent = tx(labelId);
    } else {
      btn.removeAttribute("aria-disabled"); btn.removeAttribute("aria-busy");
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }
  return { tx, el, icon, card, alertBox, field, passwordField, emailField, button, busy, uid };
}

/** Wren's copy for an auth error code. `where` picks the right words for the screen. */
export function errorCopy(error, where) {
  const code = error?.code ?? "unknown";
  const status = error?.status ?? 0;
  if (error?.retryable || code === "network" || status === 0 || status >= 500) return "auth.error.network";
  if (status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return "auth.error.throttle";
  if (code === "password_leaked") return "auth.error.password.leaked";
  if (code === "weak_password") return "auth.error.password.short";
  if (where === "signin") return code === "email_not_confirmed" ? "auth.error.unconfirmed" : "auth.error.credentials";
  if (where === "signup" && (code === "validation_failed" || code === "email_address_invalid")) return "auth.error.email.format";
  return "auth.error.network";
}

/**
 * Mount the signed-out screens.
 * @param {HTMLElement} root
 * @param {{ auth: ReturnType<import("./auth.js").createAuth>,
 *           route?: string,              // the current hash route; '#/console/signup' etc. ('#/console/security' → S12)
 *           onSignedIn: (r: {returnRoute: string|null, noticeId?: string}) => void,
 *           copy?: Function | {t: Function},
 *           notice?: "sessionExpired"|"signedOut"|"signedOutAll"|"emailConfirmed",
 *           returnRoute?: string|null,   // where to go back to after sign-in (S7); kept for Google too
 *           redirectResult?: {kind: string, ok?: boolean, error?: {code: string}}, // auth.completeRedirect()
 *           draftKept?: boolean,         // S7: an unsent chat draft is still in memory
 *           onDone?: () => void, onSessionEnded?: () => void,   // S12 only
 *           history?: History, location?: Location, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} opts
 * @returns {{ unmount(): void, show(route: string): void }}
 */
export function mountAuthScreens(root, opts) {
  const {
    auth, onSignedIn = () => {}, copy, notice, returnRoute = null, redirectResult, draftKept = false,
    onDone, onSessionEnded,
    history = globalThis.history, location = globalThis.location,
    setTimer = globalThis.setTimeout.bind(globalThis), clearTimer = globalThis.clearTimeout.bind(globalThis),
  } = opts ?? {};
  if (!root || !auth) throw new Error("mountAuthScreens needs a root and auth");
  const k = makeKit(copy);
  const { tx, el, card, alertBox, emailField, passwordField, field, button, busy } = k;
  const timers = new Set();
  let child = null;          // S12 sub-mount
  let alive = true;
  let email = "";            // kept between S1, S2, S3 and S4 (memory only)
  let cooldownUntil = 0;

  const later = (fn, ms) => { const id = setTimer(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); return id; };
  const announce = (region, id, vars) => { region.textContent = ""; later(() => { region.textContent = tx(id, vars); }, 60); };
  const validEmail = (v) => EMAIL_RE.test(v);

  function place(section, focusEl) {
    if (child) { child.unmount(); child = null; }
    root.replaceChildren(section);
    (focusEl ?? section.querySelector("h1"))?.focus();
  }
  let first = true;
  function go(route) {
    try {
      if (location && location.hash !== route) history?.[first ? "replaceState" : "pushState"](history.state, "", route);
    } catch { /* ignore */ }
    first = false;
  }
  const signedIn = (extra = {}) => { if (alive) onSignedIn({ returnRoute: returnRoute ?? null, ...extra }); };

  // Google button + the "Or" divider (S1, S2). A real <button>; auth.js does a top-level redirect, never a popup.
  function googleBlock(errBox) {
    const g = button("btn.google", "btn--secondary btn--block provider-btn", async () => {
      errBox.clear();
      busy(g, true, "auth.redirecting");
      const r = await auth.signInWithGoogle(returnRoute ?? AUTH_ROUTES.signIn);
      if (!alive) return;
      if (!r?.ok) { busy(g, false); errBox.say("auth.error.google"); g.focus(); }
    });
    const parts = [g];
    if (draftKept) parts.push(el("p", { class: "field__hint" }, tx("console.stepup.google.draft")));
    parts.push(el("p", { class: "or-divider", "aria-hidden": "true" }, tx("auth.or")));
    return { g, parts };
  }

  // ---------- S1 Sign in (also S7 with notice sessionExpired) ----------
  function showSignIn({ noticeId, google } = {}) {
    go(AUTH_ROUTES.signIn);
    const c = card("S1", "auth.signin.title", tx("auth.signin.sub"));
    const err = alertBox();
    const gb = googleBlock(err);
    const em = emailField({ value: email });
    const pw = passwordField({ label: tx("auth.field.password"), autocomplete: "current-password" });
    const submit = el("button", { type: "submit", class: "btn btn--primary btn--block" }, tx("btn.signIn"));
    const form = el("form", { novalidate: true, "data-form": "signin" }, em.wrap, pw.wrap, err.box, el("div", { class: "form-actions" }, submit));
    const forgot = button("btn.forgot", "btn--text", () => { email = em.input.value.trim(); showForgot(); });
    const create = button("btn.signUp", "btn--text", () => { email = em.input.value.trim(); showSignUp(); });
    const links = el("div", { class: "auth-links" }, forgot, create);
    const back = el("a", { class: "btn btn--text", href: "/" }, tx("btn.backToBeach"));
    c.section.append(...gb.parts, form, links, el("p", { class: "auth-switch" }, back));
    let tried = false;

    const check = () => {
      const e = em.input.value.trim(), p = pw.input.value;
      em.setError(!e ? "auth.error.email.empty" : !validEmail(e) ? "auth.error.email.format" : null);
      pw.setError(!p ? "auth.error.password.empty" : null);
      return !e ? em.input : !validEmail(e) ? em.input : !p ? pw.input : null;
    };
    em.input.addEventListener("blur", () => { if (tried) check(); });
    pw.input.addEventListener("blur", () => { if (tried) check(); });

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (submit.getAttribute("aria-disabled") === "true") return;
      tried = true; err.clear();
      const bad = check();
      if (bad) { bad.focus(); return; }
      email = em.input.value.trim();
      busy(submit, true, "auth.signing");
      const r = await auth.signInWithPassword(email, pw.input.value);
      if (!alive) return;
      busy(submit, false);
      if (r?.ok) return signedIn();
      const id = errorCopy(r?.error, "signin");
      if (id === "auth.error.unconfirmed") {
        const resend = button("btn.resend", "btn--secondary", async () => {
          busy(resend, true);
          const rr = await auth.resendConfirmation(email);
          if (!alive) return;
          busy(resend, false);
          if (rr?.ok) showCheckEmail({ resent: true }); else err.say(errorCopy(rr?.error, "resend"));
        });
        forgot.replaceWith(resend);
        err.say(id);
        resend.focus();
      } else if (id === "auth.error.network") {
        const again = button("btn.tryAgain", "btn--secondary", () => form.requestSubmit());
        err.say(id, undefined, again);
        again.focus();
      } else {
        // Wrong credentials: we don't know which field was wrong, so neither is marked invalid (Wren S1).
        err.say(id);
        pw.input.focus(); pw.input.select();
      }
    });

    place(c.section, null);
    if (google) { err.say(google === "oauth_cancelled" ? "auth.error.google.cancel" : "auth.error.google"); gb.g.focus(); }
    if (noticeId) {
      announce(c.status, noticeId);
      if (noticeId === "console.session.expired" && draftKept) later(() => { c.status.textContent += ` ${tx("console.session.kept")}`; }, 70);
    }
  }

  // ---------- S2 Create account ----------
  function showSignUp() {
    go(AUTH_ROUTES.signUp);
    const c = card("S2", "auth.signup.title", tx("auth.signup.sub"));
    const back = button("btn.backToSignIn", "btn--text", () => showSignIn());
    back.prepend(k.icon("chevron-left"));
    c.section.prepend(back);
    const err = alertBox();
    const gb = googleBlock(err);
    const em = emailField({ autocomplete: "email", value: email });
    const pw = passwordField({ label: tx("auth.field.password"), autocomplete: "new-password", hint: tx("auth.hint.newpassword", { min: MIN_PASSWORD_LENGTH }) });
    const submit = el("button", { type: "submit", class: "btn btn--primary btn--block" }, tx("btn.signUp"));
    const form = el("form", { novalidate: true, "data-form": "signup" }, em.wrap, pw.wrap, err.box, el("div", { class: "form-actions" }, submit));
    c.section.append(...gb.parts, form);
    let tried = false;
    const check = () => {
      const e = em.input.value.trim(), p = pw.input.value;
      em.setError(!e ? "auth.error.email.empty" : !validEmail(e) ? "auth.error.email.format" : null);
      pw.setError(!p ? "auth.error.password.empty" : p.length < MIN_PASSWORD_LENGTH ? "auth.error.password.short" : null, { min: MIN_PASSWORD_LENGTH });
      return !e || !validEmail(e) ? em.input : !p || p.length < MIN_PASSWORD_LENGTH ? pw.input : null;
    };
    em.input.addEventListener("blur", () => { if (tried) check(); });
    pw.input.addEventListener("blur", () => { if (tried) check(); });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (submit.getAttribute("aria-disabled") === "true") return;
      tried = true; err.clear();
      const bad = check();
      if (bad) { bad.focus(); return; }
      email = em.input.value.trim();
      busy(submit, true);
      const r = await auth.signUp(email, pw.input.value);
      if (!alive) return;
      busy(submit, false);
      if (r?.ok) return r.needsConfirmation === false ? signedIn() : showCheckEmail();
      const id = errorCopy(r?.error, "signup");
      if (id === "auth.error.password.short" || id === "auth.error.password.leaked") { pw.setError(id, { min: MIN_PASSWORD_LENGTH }); pw.input.focus(); }
      else if (id === "auth.error.email.format") { em.setError(id); em.input.focus(); }
      else { err.say(id); submit.focus(); }
    });
    place(c.section);
  }

  // ---------- S3 Check your email (also the expired-link variant) ----------
  function showCheckEmail({ resent = false, expired = false } = {}) {
    if (!email && !expired) return showSignUp();
    go(AUTH_ROUTES.checkEmail);
    const c = card("S3", "auth.confirm.title");
    const err = alertBox();
    const body = el("div", { class: "stack" });
    const em = !email ? emailField() : null;
    if (email) body.append(el("p", {}, tx("auth.confirm.body", { email })));
    body.append(el("p", { class: "muted" }, tx("auth.confirm.help")));
    const wait = el("p", { class: "cooldown-note", id: k.uid("wait") });
    const resend = button("btn.resend", "btn--primary btn--block", async () => {
      err.clear();
      if (em) {
        const v = em.input.value.trim();
        em.setError(!v ? "auth.error.email.empty" : !validEmail(v) ? "auth.error.email.format" : null);
        if (!v || !validEmail(v)) { em.input.focus(); return; }
        email = v;
      }
      busy(resend, true);
      const r = await auth.resendConfirmation(email);
      if (!alive) return;
      busy(resend, false);
      if (!r?.ok) { err.say(errorCopy(r?.error, "resend")); return; }
      if (em) return showCheckEmail({ resent: true }); // now we know the address: the normal S3
      announce(c.status, "auth.confirm.resent", { email });
      startCooldown();
    });
    function startCooldown() {
      cooldownUntil = Date.now() + RESEND_COOLDOWN_S * 1000;
      resend.setAttribute("aria-disabled", "true");
      resend.setAttribute("aria-describedby", wait.id);
      wait.textContent = tx("auth.confirm.wait", { seconds: RESEND_COOLDOWN_S }); // static text: set at the start, cleared at the end
      later(() => { resend.removeAttribute("aria-disabled"); resend.removeAttribute("aria-describedby"); wait.textContent = ""; }, RESEND_COOLDOWN_S * 1000);
    }
    const other = button("btn.useOtherEmail", "btn--text", () => showSignUp());
    const existing = button("auth.confirm.existing", "btn--text", () => showSignIn());
    c.section.append(body, em?.wrap ?? null, err.box, el("div", { class: "form-actions" }, resend, wait), el("div", { class: "auth-links" }, other, existing));
    place(c.section);
    if (expired) err.say("auth.confirm.expired");
    if (resent) { announce(c.status, "auth.confirm.resent", { email }); startCooldown(); }
    else if (cooldownUntil > Date.now()) startCooldown();
  }

  // ---------- S4 Reset your password (also the expired-link variant) ----------
  function showForgot({ expired = false } = {}) {
    go(AUTH_ROUTES.forgot);
    const c = card("S4", "auth.forgot.title", tx("auth.forgot.sub"));
    const back = button("btn.backToSignIn", "btn--text", () => showSignIn());
    back.prepend(k.icon("chevron-left"));
    c.section.prepend(back);
    const err = alertBox();
    const em = emailField({ value: email });
    const submit = el("button", { type: "submit", class: "btn btn--primary btn--block" }, tx("btn.sendReset"));
    const form = el("form", { novalidate: true, "data-form": "forgot" }, em.wrap, err.box, el("div", { class: "form-actions" }, submit));
    c.section.append(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (submit.getAttribute("aria-disabled") === "true") return;
      err.clear();
      const v = em.input.value.trim();
      em.setError(!v ? "auth.error.email.empty" : !validEmail(v) ? "auth.error.email.format" : null);
      if (!v || !validEmail(v)) { em.input.focus(); return; }
      email = v;
      busy(submit, true);
      const r = await auth.sendReset(email);
      if (!alive) return;
      busy(submit, false);
      // The same words whether or not the address has an account (auth.js also maps the per-user cooldown to ok).
      if (r?.ok) announce(c.status, "auth.forgot.sent", { email });
      else err.say(errorCopy(r?.error, "reset"));
    });
    place(c.section);
    if (expired) err.say("auth.reset.expired");
  }

  // ---------- S3b the email link: nothing happens until the tap ----------
  function showLink(type) {
    const reset = type === "recovery";
    const c = card("S3b", reset ? "auth.forgot.title" : "auth.link.title", tx(reset ? "auth.link.reset.body" : "auth.link.body"));
    const err = alertBox();
    const tap = button(reset ? "btn.chooseNew" : "btn.confirmEmail", "btn--primary btn--block", async () => {
      err.clear();
      busy(tap, true);
      const r = await auth.confirmFromEmailLink();
      if (!alive) return;
      busy(tap, false);
      if (r?.ok) return r.type === "recovery" ? showNewPassword() : showSignIn({ noticeId: "auth.confirm.done" });
      if (r?.error?.retryable) {
        err.say("auth.error.network"); tap.focus(); return; // auth.js holds the link in memory, so the tap can be repeated
      }
      return reset ? showForgot({ expired: true }) : showCheckEmail({ expired: true });
    });
    c.section.append(err.box, el("div", { class: "form-actions" }, tap));
    place(c.section);
  }

  // ---------- S5 Choose a new password (after the recovery tap) ----------
  async function showNewPassword() {
    const acct = await auth.getAccount();
    if (!alive) return;
    if (!acct) return showForgot({ expired: true });
    const c = card("S5", "auth.reset.title");
    // Vera R1 suggestion 4: show which account is being reset. Text only.
    c.section.querySelector(".auth-card__head").append(el("p", { class: "auth-card__email" }, tx("agents.account", { email: acct.email })));
    const err = alertBox();
    const pw = passwordField({ label: tx("auth.field.password"), autocomplete: "new-password", hint: tx("auth.hint.newpassword", { min: MIN_PASSWORD_LENGTH }) });
    const submit = el("button", { type: "submit", class: "btn btn--primary btn--block" }, tx("btn.setPassword"));
    const form = el("form", { novalidate: true, "data-form": "newpassword" }, pw.wrap, err.box, el("div", { class: "form-actions" }, submit));
    c.section.append(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (submit.getAttribute("aria-disabled") === "true") return;
      err.clear();
      const p = pw.input.value;
      pw.setError(!p ? "auth.error.password.empty" : p.length < MIN_PASSWORD_LENGTH ? "auth.error.password.short" : null, { min: MIN_PASSWORD_LENGTH });
      if (!p || p.length < MIN_PASSWORD_LENGTH) { pw.input.focus(); return; }
      busy(submit, true);
      const r = await auth.setNewPassword(p);
      if (!alive) return;
      busy(submit, false);
      if (r?.ok) return onSignedIn({ returnRoute: AUTH_ROUTES.signIn, noticeId: "auth.reset.done" });
      const id = errorCopy(r?.error, "newpassword");
      if (id === "auth.error.password.short" || id === "auth.error.password.leaked") { pw.setError(id, { min: MIN_PASSWORD_LENGTH }); pw.input.focus(); return; }
      if ([401, 403].includes(r?.error?.status) || r?.error?.code === "session_not_found") return showForgot({ expired: true });
      err.say(id); submit.focus();
    });
    place(c.section);
  }

  // ---------- S12 (security.js) ----------
  function showSecurity() {
    if (child) child.unmount();
    root.replaceChildren();
    child = mountSecurity(root, { auth, copy, onDone, onSessionEnded: onSessionEnded ?? (() => showSignIn({ noticeId: NOTICES.sessionExpired })), setTimer: later });
  }

  function show(route) {
    const link = auth.pendingEmailLink();
    if (link) return showLink(link.type);
    if (route === AUTH_ROUTES.security) return showSecurity();
    if (route === AUTH_ROUTES.signUp) return showSignUp();
    if (route === AUTH_ROUTES.checkEmail) return showCheckEmail();
    if (route === AUTH_ROUTES.forgot) return showForgot();
    const google = redirectResult?.kind === "oauth" && redirectResult.ok === false ? (redirectResult.error?.code ?? "oauth_failed") : null;
    return showSignIn({ noticeId: NOTICES[notice], google });
  }

  const onPop = () => { if (alive && (isAuthRoute(location.hash) || location.hash === AUTH_ROUTES.signIn || location.hash === "")) show(location.hash || AUTH_ROUTES.signIn); };
  globalThis.addEventListener?.("popstate", onPop);
  show(opts.route ?? location?.hash ?? AUTH_ROUTES.signIn);

  return {
    show,
    unmount() {
      alive = false;
      globalThis.removeEventListener?.("popstate", onPop);
      for (const id of timers) clearTimer(id);
      timers.clear();
      if (child) { child.unmount(); child = null; }
      root.replaceChildren();
    },
  };
}

/**
 * Sign Out (this device, scope 'local') and Sign Out Everywhere (scope 'global') for the account menu and S6.
 * onSignedOut({notice}) gets 'signedOut' or 'signedOutAll'; pass it to mountAuthScreens. If "everywhere" failed
 * (offline), this device is still signed out and the notice says only that.
 */
export function createSignOutControls({ auth, copy, onSignedOut = () => {}, prominent = false }) {
  const k = makeKit(copy);
  const help = k.el("p", { class: "field__hint", id: k.uid("all") }, k.tx("auth.signout.all.help"));
  const run = (everywhere, btn) => async () => {
    k.busy(btn, true);
    const r = await auth.signOut({ everywhere });
    k.busy(btn, false);
    onSignedOut({ notice: everywhere && r?.ok ? "signedOutAll" : "signedOut", everywhere, ok: !!r?.ok });
  };
  const one = k.button("btn.signOut", prominent ? "btn--primary" : "btn--secondary");
  const all = k.button("btn.signOutAll", "btn--text", null, { "aria-describedby": help.id });
  one.addEventListener("click", run(false, one));
  all.addEventListener("click", run(true, all));
  return k.el("div", { class: "stack", "data-signout": "" }, one, k.el("div", {}, all, help));
}
