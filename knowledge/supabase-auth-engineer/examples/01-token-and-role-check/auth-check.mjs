// The first line of every /api/* function: verify the Bearer token, then the role. Fails closed.
//   401 = identity not proven, 403 = proven but not super_admin, 503 = the check could not run.
// Uses only the project URL and the publishable key. No secret / service_role key anywhere.
// Uses @supabase/auth-js directly (ADR-0006: functions depend on auth-js, pinned exact), not supabase-js.
import { AuthClient, isAuthRetryableFetchError } from '@supabase/auth-js';

export function makeRequireSuperAdmin({ url, publishableKey, fetchImpl = fetch, timeoutMs = 5000 }) {
  const issuer = `${url}/auth/v1`;
  const ref = new URL(url).hostname.split('.')[0];
  // One client per function instance: nothing stored, no timers, no URL parsing.
  // auth-js caches the JWKS module-wide, keyed by storageKey, so give each project its own key.
  const auth = new AuthClient({
    url: issuer,
    headers: { apikey: publishableKey },
    storageKey: `sb-${ref}-auth-token`,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    fetch: (input, init = {}) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });

  const deny = (status, reason) => ({ ok: false, status, reason });
  const unavailable = () => deny(503, 'unavailable');   // never echo the upstream error

  return async function requireSuperAdmin(request) {
    // 1. Bearer token present and shaped like a JWT.
    const header = request.headers.get('authorization') ?? '';
    const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
    if (!m) return deny(401, 'no_token');
    const token = m[1];

    // 2. Signature + exp via getClaims (JWKS, local WebCrypto). Pass the token explicitly. Never allowExpired.
    //    auth-js RETURNS network/5xx failures as { error: AuthRetryableFetchError }; it does not throw them.
    let claims;
    try {
      const { data, error } = await auth.getClaims(token);
      if (error) return isAuthRetryableFetchError(error) ? unavailable() : deny(401, 'invalid_token');
      if (!data?.claims) return deny(401, 'invalid_token');
      claims = data.claims;
    } catch {
      return unavailable();                                // unexpected exception: fail closed
    }

    // 3. Our own claim checks (getClaims does not pin the project or audience for us).
    if (claims.iss !== issuer) return deny(401, 'wrong_project');
    if (claims.aud !== 'authenticated') return deny(401, 'wrong_audience');
    if (claims.is_anonymous === true) return deny(401, 'anonymous');
    if (typeof claims.sub !== 'string' || claims.sub === '') return deny(401, 'no_subject');

    // 4. Role from public.profiles, read WITH the user's token so RLS applies (own row only).
    //    The role is never taken from the JWT, user_metadata or the request. Not cached.
    let rows;
    try {
      const res = await fetchImpl(
        `${url}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(claims.sub)}`,
        {
          headers: { apikey: publishableKey, authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (res.status === 401) return deny(401, 'profile_rejected_token');
      if (!res.ok) return unavailable();                   // 5xx, or a 4xx that means our config is wrong
      rows = await res.json();
    } catch {
      return unavailable();                                // network error, timeout, bad JSON
    }
    if (!Array.isArray(rows)) return unavailable();
    if (rows.length !== 1) return deny(403, 'no_profile');
    if (rows[0]?.role !== 'super_admin') return deny(403, 'not_super_admin');

    return { ok: true, userId: claims.sub, claims };
  };
}
