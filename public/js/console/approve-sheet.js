// Approve sheet S8 (docs/04 §1 step 5, §4.2; approval-spec §3–§4). A <dialog> opened with showModal().
// - Built from the proposal view the card already holds; shows the consequence chosen by `deploys`, the usage
//   line from `approvals`, base SHA and content hash.
// - "Confirm it's you": password (auth.stepUpWithPassword, plus TOTP if the account has a factor) or Google
//   (auth.stepUpWithGoogle; leaves the page; on return the sheet reopens confirmed and the person clicks again).
// - Approve is sent ONLY from a click on "Approve and Deploy". Never from a URL, storage or a timer.
// - The password is read once, cleared from the field, and never kept.
import { h, icon, say, clear, announce, shortSha, shortHash } from "./dom.js";
import { showCap, showCommitted, showLive, showStillDeploying, showUnconfirmed } from "./proposal.js";
import { watchDeploy } from "./live.js";

export const STEP_UP_KEY = "bd.console.stepUpProposal"; // id only; it navigates and reopens, it never acts
const STEP_UP_MINUTES = 10;
const PROPOSAL_ID_RE = /^p_[0-9A-Z]{26}$/;

/** Read and delete the proposal id saved before a Google step-up. */
export function takeStepUpProposal(store = globalThis.sessionStorage) {
  let v = null;
  try { v = store.getItem(STEP_UP_KEY); store.removeItem(STEP_UP_KEY); } catch { v = null; }
  return typeof v === "string" && PROPOSAL_ID_RE.test(v) ? v : null;
}

let seq = 0;

/**
 * @param {{auth, api, card, hasDraft?: () => boolean, onChanged?: (view) => void, sessionStore?: Storage,
 *          confirmed?: boolean, watch?: typeof watchDeploy}} deps
 */
export async function openApproveSheet({ auth, api, card, hasDraft = () => false, onChanged = () => {},
  sessionStore = globalThis.sessionStorage, confirmed = false, watch = watchDeploy }) {
  const view = card.view;
  const p = view.proposal;
  const id = `sheet-${++seq}`;
  const account = (await auth.getAccount()) ?? { methods: { password: true, google: false }, hasVerifiedFactor: false };
  const methods = account.methods?.password || account.methods?.google ? account.methods : { password: true, google: false };
  const deploys = view.deploys !== false;
  const opener = card.actions.querySelector('[data-testid="proposal-review"]');

  const status = h("p", { class: "status-line", role: "status", dataset: { testid: "sheet-status" } });
  const alert = h("div", { role: "alert", dataset: { testid: "sheet-alert" } });

  // ---- step-up fields ----
  const pwErr = h("p", { class: "field__error", id: `${id}-pw-err` });
  const pw = h("input", { class: "input", id: `${id}-pw`, type: "password", name: "password", autocomplete: "current-password",
    autocapitalize: "none", spellcheck: "false", "aria-describedby": `${id}-pw-hint ${id}-pw-err`, dataset: { testid: "stepup-password" } });
  const showPw = h("button", { type: "button", class: "btn btn--text", "aria-pressed": "false", "aria-controls": pw.id,
    onclick: () => {
      const on = showPw.getAttribute("aria-pressed") !== "true";
      showPw.setAttribute("aria-pressed", String(on));
      pw.type = on ? "text" : "password";
      showPw.textContent = say(on ? "btn.hidePassword" : "btn.showPassword");
    } }, say("btn.showPassword"));
  const totpErr = h("p", { class: "field__error", id: `${id}-totp-err` });
  const totp = h("input", { class: "input input--code", id: `${id}-totp`, inputmode: "numeric", autocomplete: "one-time-code",
    "aria-describedby": `${id}-totp-err`, dataset: { testid: "stepup-totp" } });
  const google = h("button", { type: "button", class: "btn btn--secondary provider-btn", dataset: { testid: "stepup-google" } }, say("btn.confirmGoogle"));
  const approve = h("button", { type: "button", class: "btn btn--primary", dataset: { testid: "sheet-approve" } }, say("btn.approveDeploy"));
  const cancel = h("button", { type: "button", class: "btn btn--text", dataset: { testid: "sheet-cancel" } }, say("btn.cancel"));

  const passwordPath = methods.password ? h("div", { class: "field" },
    h("label", { class: "field__label", for: pw.id }, say("auth.field.password")),
    h("div", { class: "password-row" }, pw, showPw),
    h("p", { class: "field__hint", id: `${id}-pw-hint` }, say("console.stepup.password")),
    pwErr) : null;
  const googlePath = methods.google ? h("div", { class: "field" },
    google,
    h("p", { class: "field__hint" }, say("console.stepup.google.note")),
    hasDraft() ? h("p", { class: "field__hint" }, say("console.stepup.google.draft")) : null) : null;
  const totpField = account.hasVerifiedFactor ? h("div", { class: "field otp-row" },
    h("label", { class: "field__label", for: totp.id }, say("auth.totp.label")), totp, totpErr) : null;

  const stepup = h("fieldset", { class: "fieldset stepup", dataset: { testid: "stepup" } },
    h("legend", {}, say("console.stepup.title")),
    passwordPath,
    passwordPath && googlePath ? h("p", { class: "or-divider" }, say("console.stepup.or")) : null,
    googlePath, totpField);

  const titleId = `${id}-title`;
  const dialog = h("dialog", { class: "sheet approve-sheet", "aria-labelledby": titleId, dataset: { testid: "approve-sheet" } },
    h("div", { class: "sheet__grabber" }),
    h("div", { class: "sheet__header" }, cancel),
    h("h2", { class: "sheet__title", id: titleId }, say(deploys ? "agents.sheet.title" : "agents.sheet.title.nodeploy")),
    h("div", { class: "sheet__body" },
      h("p", { class: "deploy-note" }, say(deploys ? "console.consequence" : "console.consequence.nodeploy")),
      h("ul", { class: "sheet__note" },
        h("li", {}, say("agents.sheet.commit", { summary: p.summary })),
        deploys ? h("li", {}, say("agents.sheet.deploy.wait")) : null,
        h("li", {}, say("agents.sheet.undo"))),
      h("p", { class: "sheet__note proposal-card__meta" }, say("agents.sheet.meta", { base: shortSha(p.baseSha), hash: shortHash(p.contentHash) })),
      view.approvals ? h("p", { class: "usage-line", dataset: { testid: "usage-line" } },
        say("console.cap.usage", { used: view.approvals.used31, per31Days: view.approvals.per31Days }),
        deploys ? null : ` ${say("console.cap.nodeploy", { per31Days: view.approvals.per31Days })}`) : null,
      stepup, status, alert),
    h("div", { class: "sheet__footer" }, approve));

  let busy = false;
  let confirmedUntil = 0;
  let expiryTimer = null;

  const setBusy = (on) => {
    busy = on;
    approve.setAttribute("aria-disabled", String(on));
    approve.textContent = say(on ? "console.status.committing" : "btn.approveDeploy");
  };
  const fieldError = (input, slot, text) => {
    input.setAttribute("aria-invalid", "true");
    slot.replaceChildren(icon("alert"), text);
    input.focus();
    input.select?.();
  };
  const clearErrors = () => {
    for (const [input, slot] of [[pw, pwErr], [totp, totpErr]]) { input.removeAttribute("aria-invalid"); slot.replaceChildren(); }
    alert.replaceChildren();
  };
  const markConfirmed = () => {
    confirmedUntil = Date.now() + STEP_UP_MINUTES * 60_000;
    announce(status, say("console.stepup.done", { minutes: STEP_UP_MINUTES }));
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => { confirmedUntil = 0; announce(status, say("console.stepup.expired")); }, STEP_UP_MINUTES * 60_000);
  };
  const close = () => { clearTimeout(expiryTimer); if (dialog.open) dialog.close(); };

  dialog.addEventListener("close", () => {
    pw.value = "";
    clearTimeout(expiryTimer);
    dialog.remove();
    (card.actions.querySelector('[data-testid="proposal-review"]') ?? opener)?.focus();
  });
  cancel.addEventListener("click", close);
  dialog.addEventListener("click", (e) => { if (e.target === dialog && !busy) close(); }); // backdrop tap
  dialog.addEventListener("cancel", (e) => { if (busy) e.preventDefault(); });
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter" && pw.value) { e.preventDefault(); approve.click(); } });

  google.addEventListener("click", async () => {
    if (busy) return;
    try { sessionStore.setItem(STEP_UP_KEY, p.id); } catch { /* storage off: the person reopens the proposal by hand */ }
    announce(status, say("auth.redirecting"));
    const r = await auth.stepUpWithGoogle(`#/console/proposal/${p.id}`);
    if (!r?.ok) {
      try { sessionStore.removeItem(STEP_UP_KEY); } catch { /* ignore */ }
      announce(status, "");
      clear(alert, h("p", { class: "form-error" }, icon("alert"), say("auth.error.google")));
    }
  });

  approve.addEventListener("click", async () => {
    if (busy) return;
    clearErrors();
    // 1. Step-up in the sheet (password path), unless a Google step-up just confirmed it.
    const password = pw.value;
    pw.value = "";
    const code = totp.value.trim();
    if (password) {
      if (account.hasVerifiedFactor && !/^[0-9]{6}$/.test(code)) return fieldError(totp, totpErr, say("auth.error.totp.empty"));
      setBusy(true);
      const r = await auth.stepUpWithPassword(password, account.hasVerifiedFactor ? code : undefined);
      if (!r?.ok) {
        setBusy(false);
        const c = r?.error?.code ?? "unknown";
        if (c === "invalid_credentials") return fieldError(pw, pwErr, say("console.error.password"));
        if (/totp|mfa/.test(c)) return fieldError(totp, totpErr, say("auth.error.totp"));
        if (c === "over_request_rate_limit" || r?.error?.status === 429) return clear(alert, h("p", { class: "form-error" }, icon("alert"), say("console.error.throttle")));
        return clear(alert, h("p", { class: "form-error" }, icon("alert"), say(r?.error?.retryable ? "auth.error.network" : "console.error.password")));
      }
    } else if (confirmedUntil && account.hasVerifiedFactor) {
      if (!/^[0-9]{6}$/.test(code)) return fieldError(totp, totpErr, say("auth.error.totp.empty"));
      setBusy(true);
      const r = await auth.mfa.verifyTotp(code);
      if (!r?.ok) { setBusy(false); return fieldError(totp, totpErr, say("auth.error.totp")); }
    } else if (!confirmedUntil && methods.password) {
      return fieldError(pw, pwErr, say("auth.error.password.empty"));
    }
    // 2. Approve. The server re-checks everything (step-up, hash, allow-list, cap) and decides.
    setBusy(true);
    announce(status, say("console.status.committing"));
    let result;
    try {
      result = await api.approve(p.id, p.contentHash);
    } catch (err) {
      setBusy(false);
      return handleApproveError(err);
    }
    close();
    const sha = result?.proposal?.commitSha;
    card.view = { ...card.view, proposal: { ...card.view.proposal, ...result.proposal }, deploys: result.deploys, approvals: result.approvals };
    card.dataset.status = result?.proposal?.status ?? "committed";
    showCommitted(card, sha, result.deploys);
    card.querySelector('[data-testid="commit-link"]')?.focus();
    if (result.deploys !== false) {
      card.stopLive?.();
      card.stopLive = watch({ commitSha: sha, onLive: () => showLive(card), onGiveUp: () => showStillDeploying(card) });
    }
    onChanged(card.view);
  });

  async function reload() {
    try { const v = await api.proposal(p.id); card.update(v); onChanged(v); return v; } catch { return null; }
  }

  async function handleApproveError(err) {
    const code = err?.code;
    if (code === "step_up_required") { // sheet stays open, unconfirmed; the proposal stays pending
      confirmedUntil = 0;
      announce(status, say("console.stepup.required", { minutes: STEP_UP_MINUTES }));
      (methods.password ? pw : google).focus();
      return;
    }
    if (code === "approve_cap") { close(); showCap(card, err.approvals ?? { retryAt: err.retryAt }); return; }
    if (code === "upstream" || code === "timeout" || err?.network) {
      // The commit may have landed (docs/04 §7 reconciler): never offer Approve again; reload the proposal.
      close(); await reload(); showUnconfirmed(card); return;
    }
    if (code === "conflict" || code === "stale") {
      close(); await reload();
      if (code === "stale") announce(card.alert, say("console.error.stale"));
      return;
    }
    if (code === "unauthorized" || code === "forbidden") { close(); return; } // api.js already moved to S7 / S6
    if (code === "invalid_request") { clear(alert, h("p", { class: "form-error" }, icon("alert"), say("console.error.path"))); return; }
    if (code === "unavailable") { clear(alert, h("p", { class: "form-error" }, icon("alert"), say("console.check.failed"))); return; }
    clear(alert, h("p", { class: "form-error" }, icon("alert"), say("console.error.approve")));
  }

  document.body.append(dialog);
  dialog.showModal();
  if (confirmed) {
    markConfirmed();
    (totpField ? totp : approve).focus();
  } else {
    (methods.password ? pw : google).focus();
  }
  return { dialog, close };
}
