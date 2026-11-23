// S12 Set up two-step sign in (TOTP), route #/console/security (Wren's example 04 flow spec).
// - The factor stays unverified until the first code is accepted; leaving the screen leaves nothing active.
// - The QR is used only as an <img src> that starts with data:image/svg+xml (an SVG in <img> runs no script).
// - The key is shown with textContent, grouped by 4, never in a URL, never logged, and removed once verified.
// - Turning two-step off and a lost phone are out of scope (Dr. Lee removes a factor by hand, supabase/manual).
import { makeKit, errorCopy } from "./auth-screens.js";

const QR_PREFIX = "data:image/svg+xml";
const CODE_RE = /^[0-9]{6}$/;

export const groupKey = (secret) => String(secret ?? "").replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

/**
 * @param {HTMLElement} root
 * @param {{ auth, copy?, onDone?: () => void, onSessionEnded?: () => void,
 *           clipboard?: {writeText(s: string): Promise<void>}, setTimer?: (fn: Function, ms: number) => unknown }} opts
 * @returns {{ unmount(): void }}
 */
export function mountSecurity(root, { auth, copy, onDone = () => {}, onSessionEnded = () => {}, clipboard = globalThis.navigator?.clipboard, setTimer = globalThis.setTimeout.bind(globalThis) } = {}) {
  const k = makeKit(copy);
  const { tx, el, card, alertBox, field, button, busy } = k;
  let alive = true;
  let secret = "";

  const c = card("S12", "auth.totp.setup.title");
  const back = button("agents.back", "btn--text", () => onDone());
  back.prepend(k.icon("chevron-left"));
  c.section.prepend(back);
  const who = el("p", { class: "auth-card__email" });
  c.section.querySelector(".auth-card__head").append(who);
  const body = el("div", { class: "stack" });
  c.section.append(body);
  root.replaceChildren(c.section);
  c.h1.focus();
  const announce = (id) => { c.status.textContent = ""; setTimer(() => { if (alive) c.status.textContent = tx(id); }, 60); };

  function done() {
    secret = "";
    const finish = button("btn.done", "btn--primary btn--block", () => onDone());
    body.replaceChildren(el("div", { class: "form-actions" }, finish));
    announce("auth.totp.on");
    c.h1.focus();
  }

  function failed(id) {
    const err = alertBox();
    const again = button("btn.tryAgain", "btn--secondary", () => start());
    body.replaceChildren(err.box);
    err.say(id, undefined, again);
    again.focus();
  }

  async function start() {
    body.replaceChildren();
    const acct = await auth.getAccount();
    if (!alive) return;
    if (!acct) return onSessionEnded();
    who.textContent = tx("agents.account", { email: acct.email });
    if (acct.hasVerifiedFactor) return done();
    const r = await auth.mfa.enroll();
    if (!alive) return;
    if (!r?.ok) {
      if ([401, 403].includes(r?.error?.status) && r?.error?.code !== "insufficient_aal") return onSessionEnded();
      return failed(r?.error?.retryable ? "auth.error.network" : "auth.totp.setup.expired");
    }
    secret = r.secret;
    const parts = [el("p", {}, tx("auth.totp.setup.scan"))];
    if (typeof r.qrCode === "string" && r.qrCode.startsWith(QR_PREFIX)) {
      const img = el("img", { alt: tx("auth.totp.qr.alt"), width: "192", height: "192" });
      img.src = r.qrCode;
      parts.push(el("div", { class: "qr-tile" }, img));
    }
    const key = el("code", { class: "key-line", "data-totp-key": "" });
    key.textContent = groupKey(secret);
    const copyBtn = button("btn.copyKey", "btn--secondary", async () => {
      try { await clipboard.writeText(secret); announce("auth.totp.copied"); } catch { key.focus?.(); /* the key stays selectable */ }
    });
    parts.push(el("p", {}, tx("auth.totp.setup.key")), el("div", { class: "copy-row" }, key, copyBtn), el("p", {}, tx("auth.totp.setup.verify")));

    const code = field({ label: tx("auth.totp.label"), type: "text", autocomplete: "one-time-code", inputmode: "numeric", hint: tx("auth.totp.help"),
      extra: { maxlength: "6", pattern: "[0-9]*", class: "input input--code", spellcheck: "false" } });
    code.wrap.classList.add("otp-row");
    const err = alertBox();
    const submit = el("button", { type: "submit", class: "btn btn--primary btn--block" }, tx("btn.totpOn"));
    const form = el("form", { novalidate: true, "data-form": "totp" }, code.wrap, err.box, el("div", { class: "form-actions" }, submit));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (submit.getAttribute("aria-disabled") === "true") return;
      err.clear();
      const v = code.input.value.replace(/\s+/g, "");
      if (!v) { code.setError("auth.error.totp.empty"); code.input.focus(); return; }
      if (!CODE_RE.test(v)) { code.setError("auth.error.totp"); code.input.focus(); code.input.select(); return; }
      code.setError(null);
      busy(submit, true);
      const res = await auth.mfa.challengeAndVerify(r.factorId, v);
      if (!alive) return;
      busy(submit, false);
      if (res?.ok) return done();
      const e = res?.error;
      if (e?.code === "mfa_verification_failed" || e?.code === "totp_invalid_format" || (e?.status === 400 && e?.code !== "mfa_challenge_not_found")) {
        code.setError("auth.error.totp"); code.input.focus(); code.input.select(); return;
      }
      if (e?.status === 404 || e?.status === 422 || e?.code === "mfa_challenge_not_found" || e?.code === "mfa_factor_not_found") return failed("auth.totp.setup.expired");
      err.say(errorCopy(e, "totp")); submit.focus();
    });
    body.replaceChildren(...parts, form);
  }

  start();
  return {
    unmount() { alive = false; secret = ""; root.replaceChildren(); },
  };
}
