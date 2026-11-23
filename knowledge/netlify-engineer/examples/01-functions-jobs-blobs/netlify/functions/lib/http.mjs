// Netlify custom headers (_headers / [[headers]]) are NOT applied to function
// responses, so every function sets its own. Keep this list in one place.
export const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", ...extra },
  });
}
