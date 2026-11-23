// The one fetch wrapper for /api/* (docs/04 §1 response table; build-contracts §4).
// - Before EVERY call: await auth.getAccessToken() (refreshes when < 120 s are left, docs/04 §4.1).
// - 401 unauthorized: refresh once, resend once (only before a chat stream opens). Then onSessionEnded().
// - 401 step_up_required: no refresh, no retry; thrown to the Approve sheet.
// - 403: onNoAccess(), and every later call is refused locally (S6 makes no more /api calls).
// - 429: our JSON code, or rate_limited when the body isn't ours (Netlify's own rule). Never retried.
// - 502 on approve: thrown; the caller re-loads the proposal and never re-sends Approve.
// - Network error or timeout: ApiError {status: 0, code: "unavailable", network: true}, shown like a 503.
// Tokens never leave this module except in the Authorization header. Nothing is logged.

const ID_RE = /^[pj]_[0-9A-Z]{26}$/;
const AGENT_RE = /^[a-z][a-z0-9-]{1,63}$/;
const CODES = new Set(["invalid_request", "unauthorized", "step_up_required", "forbidden", "not_found", "conflict", "stale",
  "rate_limited", "budget_exhausted", "approve_cap", "refusal", "upstream", "timeout", "unavailable", "internal"]);
const SSE_TYPES = new Set(["text", "tool", "proposal", "handoff", "error", "done"]);
export const MAX_CHAT_BODY_BYTES = 64 * 1024;      // chat-request schema: whole body <= 64 KB
export const MAX_USER_MESSAGE_BYTES = 32 * 1024;   // SETTINGS.perTurn.maxUserMessageBytes
const FORCE_REFRESH = Number.MAX_SAFE_INTEGER;     // minValiditySeconds that always refreshes

export class ApiError extends Error {
  constructor({ status = 0, code = "internal", retryAt = null, approvals, network = false, offline = false } = {}) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAt = retryAt;
    if (approvals !== undefined) this.approvals = approvals;
    this.network = network;
    this.offline = offline;
  }
}

const statusCode = (status) => ({ 400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
  429: "rate_limited", 502: "upstream", 503: "unavailable", 504: "timeout" })[status] ?? "internal";

async function errorFrom(res) {
  let body = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try { body = await res.json(); } catch { body = null; }
  }
  const e = body?.error;
  // Netlify's own 429 (and any foreign body) has no code of ours: use the status mapping.
  const code = e && CODES.has(e.code) ? e.code : statusCode(res.status);
  const retryAt = typeof e?.retryAt === "string" ? e.retryAt : null;
  const approvals = body && "approvals" in body ? body.approvals : undefined;
  return new ApiError({ status: res.status, code, retryAt, approvals });
}

/** Incremental SSE parser: feed() text chunks, get complete events. Ignores comments and unknown types. */
export function createSseParser() {
  let buf = "";
  return {
    feed(chunk) {
      buf += chunk;
      const out = [];
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        let event = "message";
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith(":")) continue;
          const i = line.indexOf(":");
          const field = i < 0 ? line : line.slice(0, i);
          const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
          if (field === "event") event = value;
          else if (field === "data") data.push(value);
        }
        if (!data.length) continue;
        let obj;
        try { obj = JSON.parse(data.join("\n")); } catch { continue; }
        if (!obj || typeof obj !== "object") continue;
        const type = typeof obj.type === "string" ? obj.type : event;
        if (!SSE_TYPES.has(type)) continue;
        out.push({ ...obj, type });
      }
      return out;
    },
  };
}

/** Drop the oldest user/assistant pairs until the body fits (chat-request: <= 64 KB). Keeps the last user turn. */
export function fitMessages(agent, messages, maxBytes = MAX_CHAT_BODY_BYTES) {
  let list = messages.slice();
  const size = (l) => new TextEncoder().encode(JSON.stringify({ agent, messages: l })).length;
  while (list.length > 1 && size(list) > maxBytes) list = list.slice(2);
  return list;
}

/**
 * @param {{auth: {getAccessToken: Function}, fetchImpl?: typeof fetch, onSessionEnded?: () => void,
 *          onNoAccess?: () => void, timeoutMs?: number, chatTimeoutMs?: number, isOnline?: () => boolean}} deps
 */
export function createApi({ auth, fetchImpl = (...a) => globalThis.fetch(...a), onSessionEnded = () => {}, onNoAccess = () => {},
  timeoutMs = 10_000, chatTimeoutMs = 75_000, isOnline = () => globalThis.navigator?.onLine !== false } = {}) {
  let stopped = false; // after a 403, the Console makes no more /api calls (docs/04 §1)

  async function token(force) {
    let tk;
    try { tk = await auth.getAccessToken(force ? { minValiditySeconds: FORCE_REFRESH } : undefined); }
    catch { throw new ApiError({ status: 503, code: "unavailable" }); } // AuthUnavailableError: Supabase down
    if (!tk) { onSessionEnded(); throw new ApiError({ status: 401, code: "unauthorized" }); }
    return tk;
  }

  async function send(method, path, body, { signal, timeout = timeoutMs, accept = "application/json", force = false } = {}) {
    const tk = await token(force);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    const onAbort = () => ac.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const headers = { authorization: `Bearer ${tk}`, accept };
    if (body !== undefined) headers["content-type"] = "application/json";
    try {
      return await fetchImpl(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store", credentials: "same-origin", redirect: "error", signal: ac.signal });
    } catch {
      if (signal?.aborted) throw new ApiError({ status: 0, code: "aborted" });
      throw new ApiError({ status: 0, code: "unavailable", network: true, offline: !isOnline() });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** One request with the docs/04 §1 rules. Returns the Response when ok. */
  async function request(method, path, body, opts = {}) {
    if (stopped) throw new ApiError({ status: 403, code: "forbidden" });
    let res = await send(method, path, body, opts);
    if (res.status === 401) {
      const err = await errorFrom(res);
      if (err.code === "step_up_required") throw err;
      res = await send(method, path, body, { ...opts, force: true }); // one refresh, one resend
      if (res.status === 401) {
        const again = await errorFrom(res);
        if (again.code === "step_up_required") throw again;
        onSessionEnded();
        throw again;
      }
    }
    if (res.ok) return res;
    const err = await errorFrom(res);
    if (res.status === 403) { stopped = true; onNoAccess(); }
    throw err;
  }

  const getJson = async (path, opts) => (await request("GET", path, undefined, opts)).json();
  const postJson = async (path, body, opts) => {
    const res = await request("POST", path, body, opts);
    return res.status === 204 ? null : res.json();
  };
  const checkId = (id, prefix) => {
    if (typeof id !== "string" || !ID_RE.test(id) || id[0] !== prefix) throw new ApiError({ status: 400, code: "invalid_request" });
    return id;
  };

  return {
    /** GET /api/agents: the access check (10 s timeout; a timeout counts as 503). */
    async agents({ signal } = {}) {
      const body = await getJson("/api/agents", { signal });
      if (!Array.isArray(body?.agents)) throw new ApiError({ status: 502, code: "upstream" });
      return body.agents;
    },

    /**
     * POST /api/chat. Calls onEvent for each docs/04 §2.1 event and resolves with the terminal one:
     * done, error, or handoff {jobId} (seen before its done). A stream that just stops resolves
     * {type: "error", code: "upstream", interrupted: true}. Once the stream is open nothing is resent.
     */
    async chat({ agent, messages }, { signal, onEvent = () => {} } = {}) {
      if (!AGENT_RE.test(agent ?? "")) throw new ApiError({ status: 400, code: "invalid_request" });
      const res = await request("POST", "/api/chat", { agent, messages: fitMessages(agent, messages) },
        { signal, timeout: chatTimeoutMs, accept: "text/event-stream" });
      if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) {
        throw new ApiError({ status: 502, code: "upstream" });
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const parser = createSseParser();
      let handoff = null;
      try {
        for (;;) {
          let chunk;
          try { chunk = await reader.read(); }
          catch { return signal?.aborted ? { type: "error", code: "aborted", interrupted: true } : { type: "error", code: "upstream", interrupted: true }; }
          if (chunk.done) break;
          for (const ev of parser.feed(chunk.value)) {
            onEvent(ev);
            if (ev.type === "handoff") handoff = ev;
            if (ev.type === "error") return ev;
            if (ev.type === "done") return handoff ?? ev;
          }
        }
      } finally { reader.cancel().catch(() => {}); }
      return handoff ?? { type: "error", code: "upstream", interrupted: true };
    },

    /** POST /api/jobs with a transcript, or {continueFrom: jobId}. Returns {jobId}. */
    startJob: (body) => postJson("/api/jobs", body),
    job: (id) => getJson(`/api/jobs/${checkId(id, "j")}`),
    proposal: (id) => getJson(`/api/proposals/${checkId(id, "p")}`),
    approve: (id, contentHash) => postJson(`/api/proposals/${checkId(id, "p")}/approve`, { contentHash }, { timeout: 30_000 }),
    reject: (id) => postJson(`/api/proposals/${checkId(id, "p")}/reject`, {}),
    get stopped() { return stopped; },
  };
}
