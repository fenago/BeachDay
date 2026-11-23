// The browser-side calls the Console page makes, written so they run under Node with a mocked fetch.
// In the browser the same calls run from the vendored auth-only ESM file (ADR-0006, public/vendor/), loaded by the Console only.
// Every call is a JS call. Never sign in through a <form action="...">: form-action 'self' would block it, and a
// form post would put credentials in a navigation instead of a fetch.
import { AuthClient } from '@supabase/auth-js';

const EMAIL_LINK_TYPES = new Set(['email', 'recovery']);   // the only email links the Console accepts

export function makeAuth({ url, publishableKey, siteOrigin, fetchImpl, storage }) {
  const ref = new URL(url).hostname.split('.')[0];
  const client = new AuthClient({
    url: `${url}/auth/v1`,
    headers: { apikey: publishableKey },  // the publishable key goes on apikey, never on Authorization
    storageKey: `sb-${ref}-auth-token`,   // the key supabase-js would use, so both agree
    flowType: 'pkce',                     // library default is 'implicit'
    persistSession: true,                 // localStorage in the browser (docs/04 4.3)
    autoRefreshToken: true,               // the Console keeps its session fresh (docs/04 4.3)
    detectSessionInUrl: false,            // the Console handles ?code= and ?token_hash= itself, then strips them
    storage,
    fetch: fetchImpl,
  });
  const redirectTo = `${siteOrigin}/console`;   // exact entry in the Redirect URLs allow-list; no hash, no wildcard
  return {
    client,
    signUp: (email, password) => client.signUp({ email, password, options: { emailRedirectTo: redirectTo } }),
    resendConfirmation: (email) => client.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } }),
    logIn: (email, password) => client.signInWithPassword({ email, password }),
    google: () => client.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } }),
    // Same exact /console entry as every other call. The custom "Reset password" template links to
    // {{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery, and type=recovery is what routes to "new password".
    forgot: (email) => client.resetPasswordForEmail(email, { redirectTo }),
    setNewPassword: (password) => client.updateUser({ password }),
    logOut: () => client.signOut({ scope: 'local' }),   // default scope is 'global' (every device)

    // Email links built from {{ .TokenHash }} (custom templates) need no PKCE code verifier, so they work in
    // whichever browser opens them. Call this only after the person taps a button on the page (link scanners).
    confirmFromEmail: async (tokenHash, type) => {
      if (typeof tokenHash !== 'string' || tokenHash === '' || !EMAIL_LINK_TYPES.has(type))
        return { data: { session: null }, error: new Error('unsupported email link') };
      return client.verifyOtp({ token_hash: tokenHash, type });
    },

    // Before /api/chat or /api/jobs: refresh if the access token has less than minSeconds left.
    // The library's own ticker refreshes at about 90 s; docs/04 4.1 asks for 120 s before those calls.
    ensureFresh: async (minSeconds = 120) => {
      const { data: { session } } = await client.getSession();
      if (!session) return null;
      if (session.expires_at - Math.floor(Date.now() / 1000) >= minSeconds) return session.access_token;
      const { data, error } = await client.refreshSession();
      return error ? null : data.session?.access_token ?? null;
    },
  };
}
