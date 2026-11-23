// Console sign-in: the only module that talks to Supabase Auth from the browser (ADR-0006, docs/04 §4.3).
// Loaded by the Console only; the beach app never loads auth code.
// Rules (supabase-auth and google-oauth-signin skills):
// - flowType 'pkce', autoRefreshToken on, detectSessionInUrl off: this module handles ?code= and ?token_hash=
//   itself and strips them from the URL with history.replaceState.
// - Every redirect is exactly <origin>/console: no '#', no query, no wildcard. The route to return to after
//   Google is kept in sessionStorage and only navigates; it never acts.
// - Email links (?token_hash=&type=) do nothing on load. confirmFromEmailLink() runs only when the person taps.
// - Errors leave this module as { code, status, retryable } only. Never the Supabase message text.
// - Only the publishable key. Never the secret key or service_role.
import { AuthClient, isAuthRetryableFetchError } from "../../vendor/supabase-auth-js-2.119.2.mjs";

export const AUTH_JS_VERSION = "2.119.2"; // tests/unit/vendor-version.test.mjs keeps this equal to package.json
export const RETURN_ROUTE_KEY = "bd.console.returnRoute";
const ROUTE_RE = /^#\/console(?:\/[A-Za-z0-9_-]{1,64}){0,4}$/;
const EMAIL_LINK_TYPES = new Set(["email", "recovery"]);
const TOTP_RE = /^[0-9]{6}$/;
const OAUTH_PARAMS = ["code", "state", "error", "error_code", "error_description"];
const EMAIL_PARAMS = ["token_hash", "type"];

/** Thrown by getAccessToken when a refresh could not run (network/5xx). api.js treats it like a 503. */
export class AuthUnavailableError extends Error {
  constructor() {
    super("auth_unavailable");
    this.name = "AuthUnavailableError";
    this.code = "unavailable";
  }
}

/** Only the code, status and retryable flag leave this module. Never the upstream message. */
export function safeError(e) {
  const retryable = isAuthRetryableFetchError(e);
  const code = typeof e?.code === "string" && /^[a-z0-9_]{1,64}$/.test(e.code) ? e.code : retryable ? "network" : "unknown";
  return { code, status: Number.isInteger(e?.status) ? e.status : 0, retryable };
}
const fail = (code, extra = {}) => ({ ok: false, error: { code, status: 0, retryable: false, ...extra } });
const failFrom = (e) => ({ ok: false, error: safeError(e) });

function checkConfig(config) {
  const url = config?.SUPABASE_URL;
  const key = config?.SUPABASE_PUBLISHABLE_KEY;
  let u;
  try { u = new URL(url); } catch { u = null; }
  if (!u || u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || typeof key !== "string" || !key.startsWith("sb_publishable_")) {
    throw new Error("Console auth config is missing or invalid");
  }
  return { origin: u.origin, ref: u.hostname.split(".")[0], key };
}

function account(user) {
  if (!user) return null;
  const providers = new Set([
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(Array.isArray(user.identities) ? user.identities.map((i) => i?.provider) : []),
  ]);
  const factors = Array.isArray(user.factors) ? user.factors : [];
  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : "",
    methods: { password: providers.has("email"), google: providers.has("google") },
    hasVerifiedFactor: factors.some((f) => f?.status === "verified" && f?.factor_type === "totp"),
  };
}

/**
 * @param {{config: {SUPABASE_URL: string, SUPABASE_PUBLISHABLE_KEY: string}, storage?: Storage, location?: Location,
 *          history?: History, sessionStore?: Storage, fetchImpl?: typeof fetch, now?: () => number,
 *          autoRefreshToken?: boolean, refreshTimeoutMs?: number}} deps
 */
export function createAuth({
  config,
  storage = globalThis.localStorage,
  location = globalThis.location,
  history = globalThis.history,
  sessionStore = globalThis.sessionStorage,
  fetchImpl,
  now = () => Date.now(),
  autoRefreshToken = true, // tests only may pass false; the Console always keeps it on (docs/04 §4.3)
  refreshTimeoutMs = 10_000, // auth-js retries a retryable refresh for up to ~30 s; we give up sooner, fail closed
} = {}) {
  const { origin: supabaseOrigin, ref, key } = checkConfig(config);
  const redirectTo = `${location.origin}/console`; // the one exact Redirect URLs entry

  const client = new AuthClient({
    url: `${supabaseOrigin}/auth/v1`,
    headers: { apikey: key }, // publishable key on apikey, never on Authorization
    storageKey: `sb-${ref}-auth-token`,
    storage,
    flowType: "pkce", // library default is 'implicit'
    persistSession: true, // localStorage (docs/04 §4.3); the CSP is the defence
    autoRefreshToken,
    detectSessionInUrl: false,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  const params = () => new URL(location.href).searchParams;
  function strip(names) {
    const u = new URL(location.href);
    let changed = false;
    for (const n of names) if (u.searchParams.has(n)) { u.searchParams.delete(n); changed = true; }
    if (changed) history.replaceState(history.state, "", `${u.pathname}${u.search}${u.hash}`);
  }

  function saveReturnRoute(route) {
    try {
      if (typeof route === "string" && ROUTE_RE.test(route)) sessionStore.setItem(RETURN_ROUTE_KEY, route);
      else sessionStore.removeItem(RETURN_ROUTE_KEY);
    } catch { /* storage off: the person lands on the Console home */ }
  }
  /** Read and delete the saved route. It only navigates; it never acts. */
  function takeReturnRoute() {
    let r = null;
    try { r = sessionStore.getItem(RETURN_ROUTE_KEY); sessionStore.removeItem(RETURN_ROUTE_KEY); } catch { r = null; }
    return typeof r === "string" && ROUTE_RE.test(r) ? r : null;
  }

  async function currentSession() {
    const { data, error } = await client.getSession();
    return error ? null : data?.session ?? null;
  }
  // For getAccessToken only: an outage is AuthUnavailableError (503 wording), not "signed out" (S7).
  async function strictSession() {
    const { data, error } = await client.getSession();
    if (error) { if (isAuthRetryableFetchError(error)) throw new AuthUnavailableError(); return null; }
    return data?.session ?? null;
  }
  async function freshToken(minValiditySeconds) {
    const session = await strictSession();
    if (!session) return null;
    const left = (session.expires_at ?? 0) - Math.floor(now() / 1000);
    if (left >= minValiditySeconds) return session.access_token;
    const res = await client.refreshSession();
    if (res.error) { if (isAuthRetryableFetchError(res.error)) throw new AuthUnavailableError(); return null; }
    return res.data?.session?.access_token ?? null;
  }

  async function goToGoogle(returnRoute) {
    saveReturnRoute(returnRoute);
    try {
      const { data, error } = await client.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (error) return failFrom(error);
      const u = new URL(data.url);
      if (u.origin !== supabaseOrigin || u.pathname !== "/auth/v1/authorize") return fail("bad_redirect");
      location.assign(u.href); // a top-level navigation, never a <form action>
      return { ok: true };
    } catch (e) {
      return failFrom(e);
    }
  }

  // Per-user 60 s email cooldown answers 429 for real addresses only (UNVERIFIED side channel, knowledge doc 06):
  // show the same neutral "sent" for it. The per-IP limit keeps its own code for the "too many tries" copy.
  const neutralEmail = (error) =>
    !error || (error.status === 429 && error.code === "over_email_send_rate_limit") ? { ok: true } : failFrom(error);

  async function verifyTotp(code, factors) {
    if (typeof code !== "string" || !TOTP_RE.test(code)) return fail("totp_invalid_format");
    const list = factors ?? (await client.mfa.listFactors()).data?.totp ?? [];
    const factor = list.find((f) => f?.status === "verified");
    if (!factor) return fail("no_factor");
    const { error } = await client.mfa.challengeAndVerify({ factorId: factor.id, code });
    return error ? failFrom(error) : { ok: true };
  }

  const api = {
    redirectTo,

    // ---- S2 / S3: sign up and resend ----
    async signUp(email, password) {
      try {
        const { data, error } = await client.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) return failFrom(error);
        // Confirm email on: no session, "check your email". The same answer for an address that already has an
        // account (needs Confirm phone on too, docs/04 §4.5), so this never reveals whether it exists.
        return { ok: true, needsConfirmation: !data?.session };
      } catch (e) { return failFrom(e); }
    },
    async resendConfirmation(email) {
      try {
        const { error } = await client.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
        return neutralEmail(error);
      } catch (e) { return failFrom(e); }
    },

    // ---- S1: sign in ----
    async signInWithPassword(email, password) {
      try {
        const { error } = await client.signInWithPassword({ email, password });
        return error ? failFrom(error) : { ok: true };
      } catch (e) { return failFrom(e); }
    },
    /** Saves returnRoute (a '#/console/...' route, validated) in sessionStorage, then leaves for Google. */
    signInWithGoogle: (returnRoute) => goToGoogle(returnRoute),

    /**
     * Call once on page load. Finishes a PKCE ?code= (Google) in this browser, or reads a ?error= back from it,
     * then strips those parameters. Never shows raw error text. Returns the saved route on success (navigate only).
     */
    async completeRedirect() {
      const p = params();
      const code = p.get("code");
      const hadError = p.has("error") || p.has("error_code") || p.has("error_description");
      if (!code && !hadError) return { kind: "none" };
      strip(OAUTH_PARAMS);
      if (hadError || !code) { takeReturnRoute(); return { kind: "oauth", ok: false, error: { code: "oauth_failed", status: 0, retryable: false } }; }
      try {
        const { data, error } = await client.exchangeCodeForSession(code);
        if (error || !data?.session) { takeReturnRoute(); return { kind: "oauth", ...failFrom(error ?? {}) }; }
        return { kind: "oauth", ok: true, returnRoute: takeReturnRoute() };
      } catch (e) { takeReturnRoute(); return { kind: "oauth", ...failFrom(e) }; }
    },

    /** S3b / S5 gate: is there an email link in the URL? Does nothing else; the token itself is never returned. */
    pendingEmailLink() {
      const p = params();
      if (!p.has("token_hash") && !p.has("type")) return null;
      const type = p.get("type");
      if (!p.get("token_hash") || !EMAIL_LINK_TYPES.has(type)) { strip(EMAIL_PARAMS); return null; }
      return { type };
    },
    /**
     * The tap on S3b. Reads token_hash/type, strips them from the URL whatever happens, then verifyOtp.
     * type 'email': the account is confirmed and this browser is signed out again, so S1 says "Sign in to continue"
     * (it also undoes a mailed link for someone else's account). type 'recovery': the session stays for S5.
     */
    async confirmFromEmailLink() {
      const p = params();
      const tokenHash = p.get("token_hash");
      const type = p.get("type");
      strip(EMAIL_PARAMS);
      if (!tokenHash || !EMAIL_LINK_TYPES.has(type)) return { ...fail("unsupported_link"), type: null };
      try {
        const { error } = await client.verifyOtp({ token_hash: tokenHash, type });
        if (error) return { ...failFrom(error), type };
        if (type === "email") await client.signOut({ scope: "local" });
        return { ok: true, type };
      } catch (e) { return { ...failFrom(e), type }; }
    },

    // ---- S4 / S5: reset ----
    async sendReset(email) {
      try {
        const { error } = await client.resetPasswordForEmail(email, { redirectTo });
        return neutralEmail(error); // never says whether the address has an account
      } catch (e) { return failFrom(e); }
    },
    async setNewPassword(password) {
      try {
        const { error } = await client.updateUser({ password });
        return error ? failFrom(error) : { ok: true };
      } catch (e) { return failFrom(e); }
    },

    // ---- sign out ----
    /** Default: this device only (scope 'local'). everywhere: scope 'global', and this device is signed out either way. */
    async signOut({ everywhere = false } = {}) {
      try { sessionStore.removeItem(RETURN_ROUTE_KEY); } catch { /* ignore */ }
      try {
        const { error } = await client.signOut({ scope: everywhere ? "global" : "local" });
        if (!error) return { ok: true };
        if (everywhere) await client.signOut({ scope: "local" });
        return failFrom(error);
      } catch (e) { return failFrom(e); }
    },

    // ---- session ----
    async getSession() {
      try { return await currentSession(); } catch { return null; }
    },
    /** { id, email, methods: {password, google}, hasVerifiedFactor } for the signed-in user, or null. Display only. */
    async getAccount() {
      try { return account((await currentSession())?.user); } catch { return null; }
    },
    /**
     * Before every /api/* call. Refreshes when less than minValiditySeconds are left (docs/04 §4.1: 120 s).
     * Resolves the access token, or null when signed out or the refresh was rejected (S7).
     * Rejects with AuthUnavailableError when the refresh could not run (network/5xx, or no answer within
     * refreshTimeoutMs): treat like a 503.
     */
    async getAccessToken({ minValiditySeconds = 120 } = {}) {
      // The whole call races the timeout: getSession() refreshes on its own inside auth-js's ~90 s margin,
      // and auth-js retries a retryable refresh for up to ~30 s (R1, Vera).
      let timer;
      try {
        return await Promise.race([
          freshToken(minValiditySeconds),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new AuthUnavailableError()), refreshTimeoutMs); }),
        ]);
      } catch (e) {
        if (e instanceof AuthUnavailableError) throw e;
        throw new AuthUnavailableError(); // any unexpected throw: fail closed as "try again", never as signed in
      } finally { clearTimeout(timer); }
    },
    /** cb(event, account|null). Returns an unsubscribe function. Never hands out tokens. */
    onChange(cb) {
      const { data } = client.onAuthStateChange((event, session) => {
        try { cb(event, account(session?.user)); } catch { /* a listener error never breaks auth */ }
      });
      return () => data.subscription.unsubscribe();
    },
    takeReturnRoute,

    // ---- S12 and the S8 code field: TOTP ----
    mfa: {
      async listFactors() {
        try {
          const { data, error } = await client.mfa.listFactors();
          if (error) return failFrom(error);
          return { ok: true, totp: (data?.all ?? []).filter((f) => f.factor_type === "totp")
            .map((f) => ({ id: f.id, status: f.status, friendlyName: f.friendly_name ?? "" })) };
        } catch (e) { return failFrom(e); }
      },
      /** Unverified until challengeAndVerify succeeds. qrCode is an SVG data: URL (CSP img-src allows data:). */
      async enroll({ friendlyName } = {}) {
        try {
          const { data, error } = await client.mfa.enroll({ factorType: "totp", ...(friendlyName ? { friendlyName } : {}) });
          if (error) return failFrom(error);
          return { ok: true, factorId: data.id, qrCode: data.totp?.qr_code ?? "", secret: data.totp?.secret ?? "" };
        } catch (e) { return failFrom(e); }
      },
      async challengeAndVerify(factorId, code) {
        if (typeof code !== "string" || !TOTP_RE.test(code)) return fail("totp_invalid_format");
        try {
          const { error } = await client.mfa.challengeAndVerify({ factorId, code });
          return error ? failFrom(error) : { ok: true };
        } catch (e) { return failFrom(e); }
      },
      /** The S8 code field after a Google step-up: verify against the account's verified TOTP factor. */
      async verifyTotp(code) {
        try { return await verifyTotp(code); } catch (e) { return failFrom(e); }
      },
    },

    // ---- S8: step-up before Approve (docs/04 §4.2). The server decides; this only produces a fresh sign-in. ----
    /** Re-sign-in with the current account's email. If it has a verified TOTP factor, totp (6 digits) is required. */
    async stepUpWithPassword(password, totp) {
      try {
        const acct = account((await currentSession())?.user);
        if (!acct?.email) return fail("no_session");
        if (acct.hasVerifiedFactor && (typeof totp !== "string" || !TOTP_RE.test(totp))) return fail("totp_required");
        const { error } = await client.signInWithPassword({ email: acct.email, password });
        if (error) return failFrom(error);
        if (!acct.hasVerifiedFactor) return { ok: true };
        return await verifyTotp(totp);
      } catch (e) { return failFrom(e); }
    },
    /** Leaves for Google. Afterwards the person must choose Approve again: nothing approves from a URL. */
    stepUpWithGoogle: (returnRoute) => goToGoogle(returnRoute),

  };
  // Tests only. Non-enumerable, so spreading or logging the auth object doesn't carry the client along.
  Object.defineProperty(api, "_client", { value: client, enumerable: false });
  return api;
}
