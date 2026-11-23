# Sign in with Google and the redirect allow-list
Sources: https://supabase.com/docs/guides/auth/social-login/auth-google (the repo path is `auth/social-sign-in/auth-google.mdx`) · https://supabase.com/docs/guides/auth/redirect-urls · https://supabase.com/docs/reference/javascript/auth-signinwithoauth
Retrieved: 2026-11-23. supabase.com blocked here; read from the `supabase/supabase` docs source and auth-js 2.119.2 JSDoc.

## Code (web)
```js
supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
```
- "It works by redirecting your application to the provider's authorization screen, before bringing back the user to your app." It "does not redirect the user immediately"; with `skipBrowserRedirect` it just returns `data.url` (example 03).
- `redirectTo` defaults to the **Site URL**. With the implicit flow the tokens come back to your page; with **PKCE** you exchange a code (`exchangeCodeForSession`). We use PKCE (example 03 checks `code_challenge`).
- `signInWithPassword`, `signUp`, `resetPasswordForEmail`, `signOut` need no extra setup beyond the email provider.

## Setup Dr. Lee does by hand
1. Google Cloud Console, **Google Auth Platform > Clients**: create an OAuth client, type **Web application**.
2. **Authorized JavaScript origins**: the app URL, origin only, for example `https://example.com`. Add `http://localhost:<port>` only while developing and remove it for production.
3. **Authorized redirect URIs**: the Supabase callback shown on the Google provider page of the Dashboard (`https://<project-ref>.supabase.co/auth/v1/callback`; the exact string comes from the Dashboard, not from us).
4. Paste the Client ID and Client Secret into the Supabase Dashboard, Google provider. **The Google client secret lives in Supabase only, never in this repo or Netlify.**
5. Dashboard, **URL Configuration**: set **Site URL** to the production URL, and add the Console URL to the **Redirect URLs** allow-list.

## Redirect allow-list rules
- Wildcards: `*` one path segment, `**` any sequence, `?` one character; separators are `.` and `/`. "We recommend setting the exact redirect URL path for your site URL in production." The Netlify preview pattern in the docs (`https://**--my_org.netlify.app/**`) is for previews; **do not add it** unless previews can sign in on purpose (Vera).
- Any redirect not on the list falls back to the Site URL. An over-broad pattern is an open-redirect risk for the auth code or tokens.
- The `redirectTo` we pass must match an allow-list entry exactly: `<origin>/console` and `<origin>/console?reset=1` (check how query strings match; **UNVERIFIED**, test on the real project).

## Account linking
Same verified email from Google and from email/password: whether Supabase links them to one user or creates two depends on project settings. **UNVERIFIED** here. It matters because `profiles.role` is per user id: confirm Dr. Lee ends up as one id, and only promote after signing in the way he will use.
