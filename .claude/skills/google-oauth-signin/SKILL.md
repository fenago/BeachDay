---
name: google-oauth-signin
description: Continue-with-Google sign-in for the Beach Day Console through Supabase Auth — the signInWithOAuth call, Google Cloud and Supabase Dashboard setup, the redirect allow-list and the checks that follow. Use when building, documenting or reviewing Google sign-in.
---
# Continue with Google (details: knowledge/supabase-auth-engineer/docs/04-google-oauth-and-redirect-urls.md)

## Standing rules
- **The call:** the browser calls `signInWithOAuth({ provider: 'google', options: { redirectTo } })` on the PKCE auth client (example 03).
- **Never sign in through a `<form action="…">`.** Every auth call is a JS call. The CSP has `form-action 'self'`, and the Google redirect is a top-level navigation the library starts.
- **No Google client ID or secret** in the repo, Netlify or the page. The Google client secret lives only in the Supabase Dashboard.
- **A Google sign-in earns no extra rights.** The user lands as `role = 'user'` like anyone else and sees "no access" until Dr. Lee promotes them. Every function runs the same token and role check.
- **`redirectTo` is exactly `<site origin>/console`:**
  - it has no `#` route;
  - it must match a Redirect URLs entry exactly, and production entries are exact paths with no `**`;
  - before redirecting, save the route to return to (such as the open proposal) in `sessionStorage`;
  - do not add the Netlify preview wildcard from Supabase's example (previews are off, docs/04 §4.6).
- **The button** is a normal `<button>` with a text label ("Continue with Google"), reachable by keyboard.

## Setup Dr. Lee does by hand
1. Google Cloud Console, Google Auth Platform, Clients: new OAuth client, type **Web application**.
2. Authorized JavaScript origins: the production origin only. For development, use a separate Supabase project and Google client, never `localhost` on the production client (docs/04 §4.5).
3. Authorized redirect URIs: the callback URL shown on the Supabase Dashboard Google provider page.
4. Paste the Client ID and Secret into that Dashboard page.
5. Dashboard, URL Configuration: set the Site URL and the exact Redirect URLs from docs/04 §4.5.

## After the redirect
- The page finishes the PKCE exchange (`exchangeCodeForSession`) in the same browser that started it. The code is valid for 5 minutes, single use.
- Then it removes `code` (or `error`, `error_code`, `error_description`) from the URL with `history.replaceState`, and shows Wren's copy, never the raw error text.
- Then it calls the normal functions with the new access token.
- **Step-up before Approve (docs/04 §4.2):**
  - a Google user re-confirms with a new `signInWithOAuth` redirect;
  - afterwards the Console shows the same proposal and its hash, and the person **clicks Approve again**;
  - **nothing is ever approved automatically** from a redirect, query string or hash.
- **Account linking:** Supabase links a Google sign-in to an existing user with the same verified email automatically (identity-linking guide). Before promoting, Dr. Lee checks the user id and identities with step 1 of the example 02 promotion file.
- **UNVERIFIED:**
  - whether Google honours `prompt=login` (or `max_age`) to force a fresh Google login. Until checked, a Google step-up proves a live Google session, not a typed password (docs/04 §3 residual risk; TOTP closes it);
  - linking when the Google account came first (knowledge doc 04).
