# Sign in with Google and the redirect allow-list
Sources: https://supabase.com/docs/guides/auth/social-login/auth-google (the repo path is `auth/social-sign-in/auth-google.mdx`) · https://supabase.com/docs/guides/auth/redirect-urls · https://supabase.com/docs/reference/javascript/auth-signinwithoauth · https://supabase.com/docs/guides/auth/auth-identity-linking · https://supabase.com/docs/guides/auth/sessions/pkce-flow
Retrieved: 2026-11-23. supabase.com blocked here; read from the `supabase/supabase` docs source and auth-js 2.119.2 JSDoc.

## Code (web)
```js
supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
```
- "It works by redirecting your application to the provider's authorization screen, before bringing back the user to your app." It "does not redirect the user immediately"; with `skipBrowserRedirect` it just returns `data.url` (example 03).
- `redirectTo` defaults to the **Site URL**. With the implicit flow the tokens come back to your page; with **PKCE** you exchange a code (`exchangeCodeForSession`). We use PKCE (example 03 checks `code_challenge`).
- `signInWithPassword`, `signUp`, `resetPasswordForEmail`, `signOut` need no extra setup beyond the email provider.
- **Every call is a JS call. Never sign in through a `<form action="…">`.** The CSP has `form-action 'self'`, and the Google redirect is a top-level navigation started by `signInWithOAuth` (docs/04 §10).
- **PKCE limits:** "the code exchange must be initiated on the same browser and device where the flow was started"; the code is valid for 5 minutes and can be exchanged once. Starting two flows in one browser before either finishes overwrites the first verifier (pkce-flow.mdx). Observed: with no stored verifier, `exchangeCodeForSession` fails locally with `pkce_code_verifier_not_found` (example 03).
- **Errors come back on the redirect URL** as `error`, `error_code` and `error_description` parameters (redirect-urls.mdx). Show Wren's copy, never the raw `error_description`, and strip the parameters with `history.replaceState`.

## Setup Dr. Lee does by hand
1. Google Cloud Console, **Google Auth Platform > Clients**: create an OAuth client, type **Web application**.
2. **Authorized JavaScript origins**: the app URL, origin only, for example `https://example.com`. Add `http://localhost:<port>` only while developing and remove it for production.
3. **Authorized redirect URIs**: the Supabase callback shown on the Google provider page of the Dashboard (`https://<project-ref>.supabase.co/auth/v1/callback`; the exact string comes from the Dashboard, not from us).
4. Paste the Client ID and Client Secret into the Supabase Dashboard, Google provider. **The Google client secret lives in Supabase only, never in this repo or Netlify.**
5. Dashboard, **URL Configuration**: set **Site URL** to the production URL, and add the Console URL to the **Redirect URLs** allow-list.

## Redirect allow-list rules
- Wildcards: `*` one path segment, `**` any sequence, `?` one character; separators are `.` and `/`. "We recommend setting the exact redirect URL path for your site URL in production." The Netlify preview pattern in the docs (`https://**--my_org.netlify.app/**`) is for previews; **do not add it** unless previews can sign in on purpose (Vera).
- Any redirect not on the list falls back to the Site URL. An over-broad pattern is an open-redirect risk for the auth code or tokens.
- **One allow-list entry, `<origin>/console`, and every call passes exactly that** (sign-up, resend, reset, Google; example 03 test 5). The reset email doesn't need its own entry: the custom template links to `{{ .SiteURL }}?token_hash=…&type=recovery`, and `type=recovery` routes to the new-password screen (doc 06). This avoids depending on how query strings match in the allow-list, which is **UNVERIFIED**.
- **No `#` route in `redirectTo`.** Supabase appends `?code=` (PKCE) or error parameters to the redirect URL, and a hash route such as `#/console/p_…` there is untested (**UNVERIFIED**). Store the route to return to (for example the open proposal) in `sessionStorage` before the redirect, and restore it after the exchange.
- **After the Google redirect nothing is approved automatically.** The page finishes the exchange, removes `code` from the URL, shows the same proposal and its hash, and the person clicks Approve again (docs/04 §4.2). No query string, hash or redirect ever triggers a state change.

## Account linking (Google and email/password with the same address)
**Automatic linking is on and has no switch in the pages read.** From auth-identity-linking.mdx: "Supabase Auth automatically links identities with the same email address to a single user ... When a new user signs in with OAuth, Supabase Auth will attempt to look for an existing user that uses the same email address. If a match is found, the new identity is linked to the user." Linking to an unverified address is avoided: "when a new identity can be linked to an existing user, Supabase Auth will remove any other unconfirmed identities linked to an existing user."

What that means for Dr. Lee (the docs cover row 1; the other rows were read in the `supabase/auth` server source, `internal/models/linking.go` and `internal/api/signup.go`; test them on the real project):
| He has | Then he… | Result | Source |
|---|---|---|---|
| A confirmed email/password account | Signs in with Google (same verified Gmail address) | Google is **linked to the same user id**; one `profiles` row | Docs |
| A Google account | Calls `signUp` with the same address | No new user and no password. With **Confirm email and Confirm phone both on**, the answer is a fake ("obfuscated") user, the same as for a new address. Use "Forgot password" to add a password to the existing user | Server source + auth-js `signUp` JSDoc; **UNVERIFIED** on hosted |
| An *unconfirmed* email account (possibly created by someone else) | Signs in with Google | Linked to that user id; the unconfirmed email identity is removed | Docs (removal), source (link) |
| A Google identity whose email the provider does not mark verified | Signs in | A new, separate user | Server source |

- `linkIdentity()` (manual linking) is beta, off by default, and **not used** here.
- Consequence: promote only after `promote-super-admin.sql` step 1 shows one user id with the identities Dr. Lee expects (examples/02).
