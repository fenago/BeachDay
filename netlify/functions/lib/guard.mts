// The first line of every /api/* function: verify the Bearer token, then the role. Fails closed.
//   401 unauthorized = identity not proven; 403 forbidden = proven but not super_admin (or no row);
//   503 unavailable  = the check could not run (network, timeout, 5xx, bad config, any exception).
// docs/04 §4.1. Reference: knowledge/supabase-auth-engineer/examples/01-token-and-role-check/.
// Uses only SUPABASE_URL and the publishable key. The secret key and the legacy service_role key are used nowhere.
// The role comes from public.profiles, read WITH the caller's token (RLS: own row only). Never from the JWT,
// user_metadata or the request. Not cached. The request body is never read here.
import { AuthClient, isAuthRetryableFetchError, isAuthApiError, isAuthError } from "@supabase/auth-js";
import { SETTINGS } from "./settings.mts";
import { error } from "./http.mts";

export type DenyCode = "unauthorized" | "forbidden" | "unavailable";

export interface GuardAllow {
  ok: true;
  userId: string;
  claims: Record<string, unknown>;
  token: string; // for the Approve step-up (getUser) and for /api/jobs forwarding to /api/jobs-run. Never log it.
}
export interface GuardDeny {
  ok: false;
  status: 401 | 403 | 503;
  code: DenyCode;
  reason: string; // for logs only; never sent to the client
}
export type GuardResult = GuardAllow | GuardDeny;

export interface GuardLogEntry {
  msg: "auth";
  route?: string;
  requestId?: string;
  status: number;
  outcome: string;
  sub?: string;
}

// The two auth-js calls the guard and the step-up need. Tests may inject a fake with this shape.
export interface AuthCalls {
  getClaims(token: string): Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
  getUser(token: string): Promise<{ data: { user: Record<string, unknown> | null }; error: unknown }>;
}

export interface GuardOptions {
  url?: string;
  publishableKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  headerPrecheck?: boolean;
  log?: (entry: GuardLogEntry) => void;
  authClient?: AuthCalls;
}

export interface Guard {
  check(req: Request, meta?: { route?: string; requestId?: string }): Promise<GuardResult>;
  getUser: AuthCalls["getUser"];
}

const MAX_TOKEN_LENGTH = 4096;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const ALLOWED_ALGS = new Set(["ES256", "RS256"]);

// Always on, whatever SETTINGS.jwtHeaderPrecheck says: the header and payload must each decode (base64url) to a
// JSON object. auth-js THROWS on a non-JSON header, and the guard maps a throw to 503; a malformed token is the
// caller's fault, so it gets 401 here, before any network call. Verifies nothing else (getClaims does).
function decodesToObject(part: string): boolean {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return !!v && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}
export function wellFormedJwt(token: string): boolean {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)) && decodesToObject(parts[0]) && decodesToObject(parts[1]);
}

// docs/04 §4.1 step 1 header pre-check. Verifies nothing (getClaims does). It stops cheap forgeries (HS*, none,
// no kid) before getClaims falls back to GET /auth/v1/user for them. On only after pre-launch test (f).
export function precheckJwtHeader(token: string): boolean {
  if (typeof token !== "string") return false;
  const head = token.split(".")[0] ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(head)) return false;
  let h: unknown;
  try {
    h = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!h || typeof h !== "object" || Array.isArray(h)) return false;
  const { alg, kid } = h as { alg?: unknown; kid?: unknown };
  return typeof alg === "string" && ALLOWED_ALGS.has(alg) && typeof kid === "string" && kid.length > 0 && kid.length <= 200;
}

// 401 only when Supabase (or auth-js's local JWT check) actually rejected the token. Everything else returned
// (429, other 4xx/5xx, AuthUnknownError such as an HTML WAF page, look-alike objects) is an outage: 503.
// R1 (Vera): docs/04 §4.1 step 5, §4.2 rule 1.
const REJECT_STATUSES = new Set([400, 401, 403, 404, 422]);
export function tokenRejected(err: unknown): boolean {
  if (isAuthRetryableFetchError(err)) return false;
  if (isAuthApiError(err)) return REJECT_STATUSES.has((err as { status?: number }).status ?? 0);
  if (isAuthError(err)) {
    const name = (err as { name?: unknown }).name;
    return name === "AuthInvalidJwtError" || name === "AuthSessionMissingError";
  }
  return false;
}

function validConfig(url: unknown, key: unknown): URL | null {
  if (typeof url !== "string" || typeof key !== "string" || !key.startsWith("sb_publishable_")) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

function defaultLog(entry: GuardLogEntry): void {
  console.log(JSON.stringify(entry));
}

function withTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const t = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, t]) : t;
    return fetchImpl(input, { ...init, signal });
  }) as typeof fetch;
}

export function createGuard(opts: GuardOptions = {}): Guard {
  const {
    fetchImpl = fetch,
    timeoutMs = 5000,
    headerPrecheck = SETTINGS.jwtHeaderPrecheck,
    log = defaultLog,
  } = opts;
  const base = validConfig(opts.url, opts.publishableKey);
  const publishableKey = opts.publishableKey as string;
  const origin = base ? base.origin : "";
  const issuer = `${origin}/auth/v1`;
  const timedFetch = withTimeout(fetchImpl, timeoutMs);

  let auth: AuthCalls | null = opts.authClient ?? null;
  if (!auth && base) {
    // One client per function instance. auth-js caches the JWKS module-wide, keyed by storageKey,
    // so each project gets its own key (knowledge doc 01).
    const client = new AuthClient({
      url: issuer,
      headers: { apikey: publishableKey },
      storageKey: `sb-${base.hostname.split(".")[0]}-auth-token`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      fetch: timedFetch,
    });
    auth = {
      getClaims: (token) => client.getClaims(token) as ReturnType<AuthCalls["getClaims"]>,
      getUser: (token) => client.getUser(token) as unknown as ReturnType<AuthCalls["getUser"]>,
    };
  }

  async function check(req: Request, meta: { route?: string; requestId?: string } = {}): Promise<GuardResult> {
    const finish = (r: GuardResult, sub?: string): GuardResult => {
      const entry: GuardLogEntry = {
        msg: "auth", route: meta.route, requestId: meta.requestId,
        status: r.ok ? 200 : r.status, outcome: r.ok ? "allowed" : r.reason,
      };
      if (sub !== undefined) entry.sub = sub;
      try { log(entry); } catch { /* logging never changes the outcome */ }
      return r;
    };
    const deny = (status: 401 | 403 | 503, reason: string, sub?: string): GuardResult => {
      const code: DenyCode = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "unavailable";
      return finish({ ok: false, status, code, reason }, sub);
    };

    try {
      if (!base || !auth) return deny(503, "misconfigured");

      // 1. Bearer token present and shaped like a JWT.
      const header = req.headers.get("authorization") ?? "";
      const m = header.length <= MAX_TOKEN_LENGTH + 7 ? BEARER.exec(header) : null;
      if (!m) return deny(401, "no_token");
      const token = m[1];
      if (headerPrecheck && !precheckJwtHeader(token)) return deny(401, "bad_header"); // no network call
      if (!wellFormedJwt(token)) return deny(401, "malformed_token"); // no network call; a throw later stays 503

      // 2. Signature + exp via getClaims (JWKS, local WebCrypto). Token passed explicitly. Never allowExpired.
      //    auth-js RETURNS network/5xx failures as { error: AuthRetryableFetchError }; it does not throw them.
      let claims: Record<string, unknown>;
      try {
        const { data, error: err } = await auth.getClaims(token);
        if (err) return tokenRejected(err) ? deny(401, "invalid_token") : deny(503, "auth_unavailable");
        if (!data?.claims || typeof data.claims !== "object") return deny(401, "invalid_token");
        claims = data.claims;
      } catch {
        return deny(503, "auth_unavailable");
      }

      // 3. Claim checks getClaims does not do for us.
      if (claims.iss !== issuer) return deny(401, "wrong_project");
      if (claims.aud !== "authenticated") return deny(401, "wrong_audience");
      if (claims.is_anonymous === true) return deny(401, "anonymous");
      const sub = claims.sub;
      if (typeof sub !== "string" || sub === "") return deny(401, "no_subject");

      // 4. Role from public.profiles, as the caller. Exactly one row with role super_admin, else 403.
      let rows: unknown;
      try {
        const res = await timedFetch(`${origin}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(sub)}`, {
          headers: { apikey: publishableKey, authorization: `Bearer ${token}`, accept: "application/json" },
        });
        if (res.status === 401) return deny(401, "profile_rejected_token", sub);
        if (!res.ok) return deny(503, "profile_unavailable", sub); // 5xx, or a 4xx meaning our config is wrong
        rows = await res.json();
      } catch {
        return deny(503, "profile_unavailable", sub); // network error, timeout, bad JSON
      }
      if (!Array.isArray(rows)) return deny(503, "profile_unavailable", sub);
      if (rows.length !== 1) return deny(403, "no_profile", sub);
      if ((rows[0] as { role?: unknown } | null)?.role !== "super_admin") return deny(403, "not_super_admin", sub);

      return finish({ ok: true, userId: sub, claims, token }, sub);
    } catch {
      return deny(503, "guard_exception");
    }
  }

  async function getUser(token: string) {
    if (!auth) throw new Error("auth not configured"); // approveStepUp maps a throw to 503
    return auth.getUser(token);
  }

  return { check, getUser };
}

// Reads only the two non-secret Supabase variables. Missing or wrong: every check answers 503.
export function guardFromEnv(opts: Omit<GuardOptions, "url" | "publishableKey"> & { env?: Record<string, string | undefined> } = {}): Guard {
  const { env = process.env, ...rest } = opts;
  return createGuard({ ...rest, url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
}

const MESSAGES: Record<DenyCode, string> = {
  unauthorized: "Sign in to continue.",
  forbidden: "This account can't use Agents.",
  unavailable: "Couldn't check your access. Try again in a minute.",
};

// The response for a denied check. Fixed, user-safe text; the reason stays in the log.
export function denyResponse(r: GuardDeny): Response {
  return error(r.status, r.code, MESSAGES[r.code]);
}
