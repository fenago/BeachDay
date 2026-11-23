// The browser-side calls the Console login page makes, written so they run under Node with a mocked fetch.
// In the browser the same code runs from the vendored supabase-js ESM file (no build step).
import { createClient } from '@supabase/supabase-js';

export function makeAuth({ url, publishableKey, siteOrigin, fetchImpl, storage }) {
  const sb = createClient(url, publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage },
    global: { fetch: fetchImpl },
  });
  const redirectTo = `${siteOrigin}/console`;
  return {
    sb,
    signUp: (email, password) => sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }),
    logIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
    google: () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } }),
    forgot: (email) => sb.auth.resetPasswordForEmail(email, { redirectTo: `${siteOrigin}/console?reset=1` }),
    setNewPassword: (password) => sb.auth.updateUser({ password }),
    logOut: () => sb.auth.signOut({ scope: 'local' }),   // default scope is 'global' (every device)
  };
}
