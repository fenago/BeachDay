// Netlify custom headers (_headers) are NOT applied to function responses, so every function sets its own
// (docs/04 §10). Never send Access-Control-Allow-* or Set-Cookie.

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
});

// docs/04 §2.1: one code list for JSON and SSE. Value = default HTTP status (null: SSE and job events only).
export const ERROR_CODES: Readonly<Record<string, number | null>> = Object.freeze({
  invalid_request: 400,
  unauthorized: 401,
  step_up_required: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  stale: 409,
  rate_limited: 429,
  budget_exhausted: 429,
  approve_cap: 429,
  refusal: null,
  upstream: 502,
  timeout: 504,
  unavailable: 503,
  internal: 500,
});

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorOptions {
  retryAt?: string;
  extra?: Record<string, unknown>;
}

const JSON_TYPE = "application/json; charset=utf-8";

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const h: Record<string, string> = { ...SECURITY_HEADERS, ...headers, "content-type": JSON_TYPE };
  if (status === 401) h["www-authenticate"] = "Bearer";
  return new Response(JSON.stringify(body), { status, headers: h });
}

// Body is { error: { code, message, retryAt?, ...extra } }. `message` must be user-safe (at most 500 chars):
// never a stack trace, env value, token or upstream error body.
export function error(status: number, code: string, message: string, opts: ErrorOptions = {}): Response {
  const err: Record<string, unknown> = { ...(opts.extra ?? {}), code, message: String(message).slice(0, 500) };
  if (opts.retryAt) err.retryAt = opts.retryAt;
  return json(status, { error: err });
}

export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}
