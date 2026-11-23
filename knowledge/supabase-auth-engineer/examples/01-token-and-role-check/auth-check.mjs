// The first line of every /api/* function: verify the Bearer token, then the role. Fails closed.
// Uses only the project URL and the publishable key. No secret / service_role key anywhere.
import { createClient } from '@supabase/supabase-js';

export function makeRequireSuperAdmin({ url, publishableKey, fetchImpl = fetch }) {
  const issuer = `${url}/auth/v1`;
  // One client per function instance: persistSession off, nothing stored, no timers.
  const sb = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });

  const deny = (status, reason) => ({ ok: false, status, reason });

  return async function requireSuperAdmin(request) {
    // 1. Bearer token present and shaped like a JWT.
    const header = request.headers.get('authorization') ?? '';
    const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
    if (!m) return deny(401, 'no_token');
    const token = m[1];

    // 2. Signature + exp via getClaims (JWKS, local WebCrypto). Any error or throw => 401.
    let claims;
    try {
      const { data, error } = await sb.auth.getClaims(token);
      if (error || !data?.claims) return deny(401, 'invalid_token');
      claims = data.claims;
    } catch {
      return deny(401, 'invalid_token');
    }

    // 3. Our own claim checks (getClaims does not pin the project or audience for us).
    if (claims.iss !== issuer) return deny(401, 'wrong_project');
    if (claims.aud !== 'authenticated') return deny(401, 'wrong_audience');
    if (claims.is_anonymous === true) return deny(401, 'anonymous');
    if (typeof claims.sub !== 'string') return deny(401, 'no_subject');

    // 4. Role from public.profiles, read WITH the user's token so RLS applies (own row only).
    //    The role is never taken from the JWT or from user_metadata.
    let rows;
    try {
      const res = await fetchImpl(
        `${url}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(claims.sub)}`,
        { headers: { apikey: publishableKey, authorization: `Bearer ${token}`, accept: 'application/json' } },
      );
      if (!res.ok) return deny(403, 'profile_lookup_failed');
      rows = await res.json();
    } catch {
      return deny(403, 'profile_lookup_failed');
    }
    if (!Array.isArray(rows) || rows.length !== 1) return deny(403, 'no_profile');
    if (rows[0].role !== 'super_admin') return deny(403, 'not_super_admin');

    return { ok: true, userId: claims.sub, claims };
  };
}
