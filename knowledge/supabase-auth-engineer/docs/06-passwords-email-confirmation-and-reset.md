# Email/password: confirmation, reset and password rules
Sources: https://supabase.com/docs/guides/auth/passwords · https://supabase.com/docs/guides/auth/password-security · https://supabase.com/docs/guides/auth/rate-limits · https://supabase.com/docs/guides/auth/auth-smtp · https://supabase.com/docs/guides/auth/auth-email-templates · https://supabase.com/docs/reference/javascript/auth-signup · https://supabase.com/docs/reference/javascript/auth-resend
Retrieved: 2026-11-23. supabase.com blocked here; read from the `supabase/supabase` docs source (guides, the `auth_rate_limits.mdx` partial and the default numbers in `packages/shared-data/config.ts`) and the auth-js 2.119.2 JSDoc.

- **Email confirmation** is a setting on the Dashboard Auth Providers page (`enable_confirmations` in config). It is on by default on hosted projects. With it on, `signUp` returns "a `user` ... but `session` is null" (auth-js JSDoc), so the UI shows "check your email".
- **No enumeration at sign-up needs TWO settings.** From the `signUp` JSDoc: for an existing confirmed user, "When both **Confirm email** and **Confirm phone** (even when phone provider is disabled) are enabled ... an obfuscated/fake user object is returned. When either ... is disabled, the error message, `User already registered` is returned." So Dr. Lee must turn on **Confirm phone** as well, even though phone sign-in stays off. The Auth server source (`signup.go`) matches this.
- **Reset:** `resetPasswordForEmail(email, { redirectTo })`. "To prevent user enumeration" it does not reveal whether the account exists and returns no error either way. The UI must say "If that address has an account, we sent a link", never "no such user". After the link, the user has a session; collect the new password and call `updateUser({ password })`.
- **Password rules** (Dashboard): minimum length (docs: "Anything less than 8 characters is not recommended"), required character classes, and **leaked-password protection** using HaveIBeenPwned. **"Leaked password protection is available on the Pro Plan and above."** If the project is on Free, the setting is not available: tell Dr. Lee and Vera; compensate with a long minimum length and Google sign-in. (Plan of the project: UNVERIFIED.)
- Optional **Secure password change** / "Require current password": see doc 03; neither is a step-up for Approve.
- **Email links that work in any browser (needed for an installed iPhone app).**
  - With PKCE, a default confirmation or reset link returns `?code=`. Only the browser that started the flow holds the code verifier (pkce-flow.mdx). A link opened in another browser fails with `pkce_code_verifier_not_found` (example 03). On iPhone, mail links usually open in Safari, not in the home-screen app. That the two keep separate storage is Apple behaviour, **UNVERIFIED** here (pwa-mobile-engineer owns it). If they do, a `?code=` link opened in Safari fails in the same way.
  - The documented fix: custom email templates that link to our own page with `{{ .TokenHash }}`. The page calls `verifyOtp({ token_hash, type })`, which needs no verifier. For example:
    - **Confirm signup:** `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email`
    - **Reset password:** `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery`

    The Site URL is the `/console` URL (docs/04 §4.5). This is the pattern passwords.mdx shows for PKCE.
  - The session then lives in the browser that opened the link. For a reset, that browser is where the new password is set, and the person then signs in in the app.
  - Exact template strings are **UNVERIFIED** until tried on the real project.
- **Link scanners.** Some mail providers open links to scan them, and that "uses up" a `{{ .ConfirmationURL }}` link (auth-email-templates.mdx, "Email prefetching"). With the `token_hash` page, opening the page does nothing. `verifyOtp` runs only when the person taps a button on the page.
- **Rate limits and cooldowns** (rate-limits.mdx, defaults from `packages/shared-data/config.ts`; adjustable under Authentication > Rate Limits unless noted). Over a limit the answer is **429**.
  | Limit | Default |
  |---|---|
  | Sign-up confirmation email, per user | One request per **60 s** |
  | Password reset email, per user | One request per **60 s** |
  | `signup`, `recover`, `resend`, `otp`, `user` endpoints, per IP | 30 per 5 minutes, burst 30 |
  | `/token` (password, refresh and PKCE grants), per IP | 150 per 5 minutes, burst 30 |
  | `/verify`, per IP | 30 per 5 minutes, burst 30 |
  | MFA challenge/verify, per IP | 15 per minute, burst 30; not adjustable |
  | **Emails sent with the built-in sender, per project** | **2 per hour**, and only to members of the project's organisation team ("Email address not authorized" otherwise). "Not meant for production use" (auth-smtp.mdx) |
  | Emails after custom SMTP is set up | 30 per hour to start, then adjustable |
  Notes:
  - The `resend()` JSDoc says reset emails are resent by calling `resetPasswordForEmail()` again.
  - Calls from a Netlify function would share the function's IP. IP forwarding needs a **secret key**, which we never use, so the browser-direct design is required here too.
  - Whether `GET /user` (our Approve `getUser`) counts against the per-IP bucket of the function's egress address is **UNVERIFIED**.
- **Possible side channel (UNVERIFIED).** The per-user 60 s cooldowns apply to an address that has an account. A second reset or resend within 60 s may therefore answer 429 for a real address and 200 for an unknown one. Recommendation: on reset and resend, show the same neutral "sent" status for 200 and for a per-user 429. Keep the "too many tries" copy for the per-IP limit. Test both error codes on the real project before relying on them.
- **Custom SMTP is needed before anyone but Dr. Lee's team can sign up or reset.** With the built-in sender, a stranger's sign-up gets "Email address not authorized", and two emails an hour is too few even for him. Decision for Dr. Lee: set up custom SMTP (a provider account and DNS for a sending domain), or accept that only team members can receive Console emails.
- Accessible authentication (WCAG 3.3.8): inputs must allow paste and password managers (`autocomplete="current-password"`, `new-password`, `username`). Wren owns the copy and the flows.
