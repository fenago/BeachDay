---
name: google-oauth-signin
description: Continue-with-Google sign-in for the Beach Day Console through Supabase Auth — the signInWithOAuth call, Google Cloud and Supabase Dashboard setup, the redirect allow-list and the checks that follow. Use when building, documenting or reviewing Google sign-in.
---
# Continue with Google (details: knowledge/supabase-auth-engineer/docs/04-google-oauth-and-redirect-urls.md)

## Standing rules
- The browser calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })` with the PKCE client. No Google client ID or secret in the repo, Netlify or the page: the Google client secret lives only in the Supabase Dashboard.
- **A Google sign-in earns no extra rights.** The user lands as `role = 'user'` like anyone else and sees "no access" until Dr. Lee promotes them. Every function runs the same token and role check.
- `redirectTo` is `<site origin>/console`. It must match a Redirect URLs entry exactly; production entries are exact paths, no `**`. Do not add the Netlify preview wildcard from Supabase's example unless Dr. Lee wants previews to sign in.
- The sign-in button is a normal `<button>` with a text label ("Continue with Google"), reachable by keyboard.

## Setup Dr. Lee does by hand
1. Google Cloud Console, Google Auth Platform, Clients: new OAuth client, type **Web application**.
2. Authorized JavaScript origins: the site origin only (add `http://localhost:<port>` only while developing).
3. Authorized redirect URIs: the callback URL shown on the Supabase Dashboard Google provider page.
4. Paste the Client ID and Secret into that Dashboard page.
5. Dashboard, URL Configuration: Site URL = production URL; add the Console redirect URLs.

## After the redirect
- The page finishes the PKCE exchange (`exchangeCodeForSession`) and then calls the normal functions with the new access token.
- Unverified: whether the same verified email from Google and from email/password becomes one user or two (project setting), and whether `prompt=login` forces a fresh Google login for step-up. Check both before promoting Dr. Lee's account.
