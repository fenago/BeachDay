// Shared plumbing for the eight /api/* handlers (build-contracts §2.2, §5). Small, boring helpers so each handler
// reads as the docs/04 order of checks: method -> guard -> Origin (POST) -> production -> id/body -> limits -> work.
// Nothing here reads a secret, a body before the guard ran, or a store.
import type { Guard, GuardAllow } from "./guard.mts";
import { denyResponse } from "./guard.mts";
import { checkOrigin, originDenyResponse } from "./origin.mts";
import { error, json } from "./http.mts";
import type { SETTINGS } from "./settings.mts";
import type { ApproveVerdict } from "./limits.mts";

export type Settings = typeof SETTINGS;

/** The Netlify Context fields we use (build-contracts §5). Nothing else. */
export interface Ctx { deploy?: { context?: string }; requestId?: string; params?: Record<string, string | undefined>; ip?: string }

export const MAX_JSON_BODY = 64 * 1024;   // chat, jobs (secure-by-design: <= 64 KB before parse)
export const MAX_SMALL_BODY = 4 * 1024;   // approve {contentHash}, reject {reason?}, job-run {jobId, nonce}

/** One-line JSON log. Never bodies, tokens, the Authorization header or env. */
export function logLine(entry: Record<string, unknown>): void {
  try { console.log(JSON.stringify(entry)); } catch { /* never let logging change an outcome */ }
}

export function methodNotAllowed(allow: string): Response {
  return json(405, { error: { code: "invalid_request", message: "Method not allowed." } }, { allow });
}

/** Steps 2 and 3: the token-and-role guard, then Origin on POST. Returns the allowed identity or a ready Response. */
export async function authorize(guard: Guard, req: Request, route: string, requestId: string | undefined): Promise<GuardAllow | Response> {
  let g;
  try {
    g = await guard.check(req, { route, requestId });
  } catch {
    return error(503, "unavailable", "Couldn't check your access. Try again in a minute."); // fail closed
  }
  if (!g.ok) return denyResponse(g);
  const o = checkOrigin(req); // the request's own origin; never a header-derived siteOrigin (R1 ruling)
  if (!o.ok) return originDenyResponse(o);
  return g;
}

/** Step 4 for the secret-reading functions (chat, job-run, proposal, approve), BEFORE any secret is read. */
export const isProduction = (ctx: Ctx | undefined): boolean => ctx?.deploy?.context === "production";
export const notProduction = (): Response => error(503, "unavailable", "The Console is only available on the production site.");

export const badRequest = (message = "That request isn't valid."): Response => error(400, "invalid_request", message);

/**
 * Read the body with a byte cap BEFORE parsing (a Content-Length over the cap is refused without reading).
 * `allowEmpty` returns {} for an empty body. Requires a JSON content type when there is a body.
 */
export async function readJson(req: Request, maxBytes: number, { allowEmpty = false } = {}): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const cl = req.headers.get("content-length");
  if (cl !== null && (!/^\d+$/.test(cl) || Number(cl) > maxBytes)) return { ok: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  }
  if (total === 0) return allowEmpty ? { ok: true, value: {} } : { ok: false };
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!/^application\/json(\s*;|$)/.test(type)) return { ok: false };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

/** R11: approvals usage for the UI from a checkApproveCap() verdict. retryAt is null when a slot is free now. */
export function approvalsView(v: ApproveVerdict, caps: { per31Days: number; perDay: number }) {
  return { used31: v.used31, usedToday: v.usedToday, per31Days: caps.per31Days, perDay: caps.perDay, retryAt: v.allowed ? null : (v.retryAt ?? null) };
}

export const unavailable = (): Response => error(503, "unavailable", "Something we depend on is unavailable. Try again in a minute.");
export const internal = (): Response => error(500, "internal", "Something went wrong on our side.");

/**
 * Last line of defence (R11): a throw that escapes a handler becomes our own 500 `internal` with the security
 * headers, never the platform's default error page. `onThrow` lets job-run keep its silent 202.
 */
export function safe(route: string, h: (req: Request, ctx: Ctx) => Promise<Response>, onThrow: () => Response = internal) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await h(req, ctx);
    } catch (e) {
      logLine({ msg: "handler_threw", route, requestId: ctx?.requestId, error: (e as Error)?.name ?? "unknown" });
      return onThrow();
    }
  };
}
