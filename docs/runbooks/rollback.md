# Rollback runbook

Owner: netlify-engineer (Nell). Run by Dr. Lee or any human with Netlify access. Sources: docs/03 §8.3 and §9.3, docs/04 §4. Written to be followed at 2 am. Agents never run these steps.

Status: no Netlify site is linked yet (Dr. Lee, 2026-11-23). Until one is, there is nothing to roll back; use `git revert` (§1 step 6) only. The Netlify steps are UNVERIFIED against a real site until the first deploy.

## 1. Roll back a bad deploy (0 credits, no rebuild)
1. Netlify dashboard, the site, **Deploys**.
2. Open the last deploy that was good (the one before the bad Approve).
3. Click **Publish deploy**. It is instant and costs 0 credits.
4. Click **Lock to stop auto publishing** on that deploy. Without the lock, the next push to `main` overwrites the rollback.
5. Check: open the site, then `BASE_URL=https://<site> node scripts/smoke.mjs`. The version in `/version.json` should be the old commit.
6. Fix forward in git: `git revert <bad sha>` on `main` (human only). Push, wait for the new deploy (15 credits), check it, then **Unlock** (Deploys, "Start auto publishing").

Installed phones: browsers compare `sw.js` bytes, and the old deploy has different bytes, so phones update back to it on their next check.

## 2. Service worker is breaking the app shell (kill switch)
Use only if phones keep serving a broken shell after a rollback.
1. A human commits the kill-switch file in §2a as `public/sw.js`. It, on `activate`, deletes every cache, calls `self.registration.unregister()` and reloads open clients. `sw.js` is denied to agents, so only a human can ship it.
2. The commit touches `public/`, so it deploys (15 credits). Check `/sw.js` is 200 with `Cache-Control: no-cache`.
3. After clients have recovered, ship the normal `sw.js` again (needs pwa-mobile-engineer and qa-engineer review).

## 2a. Kill-switch sw.js
The tested file (`knowledge/pwa-mobile-engineer/examples/04-kill-switch/kill-sw.js`; Chromium test output is in that README). Self-contained, no imports, no fetch handler.

```js
/* Beach Day EMERGENCY kill-switch service worker. Self-contained: no imports, no fetch handler.
 * install : activate immediately (skip waiting).
 * activate: delete every cache, unregister this worker, reload every controlled tab/app window.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await self.registration.unregister();
      for (const client of clients) {
        try { await client.navigate(client.url); } catch { /* client gone: ignore */ }
      }
    })()
  );
});
```

**Deploy it (human only; `public/sw.js` is deny-listed, so the Console cannot do this):**
1. Save the normal file first: `git show HEAD:public/sw.js > ~/sw.normal.js` (the repo copy still has `__BUILD_VERSION__`; the build stamps it).
2. Overwrite `public/sw.js` with the code above. Keep the filename and URL: it must stay `/sw.js`. The stamp step (docs/03 §9.2) exits 1 if the `__BUILD_VERSION__` placeholder is missing, which would fail the build, so add one line `// kill-switch __BUILD_VERSION__` at the top of the file. The stamp replaces it, and the bytes change per deploy.
3. Commit and push to `main` (one production deploy, 15 credits). Check `curl -I https://<site>/sw.js` shows 200 and `Cache-Control: no-cache`, and the body is the kill file.
4. Phones pick it up on their next navigation or update check; the page reloads once and runs with no service worker. Open it on a real iPhone and a Pixel to confirm.

**Restore the normal worker afterwards:**
1. Wait until affected phones have recovered and the root cause is fixed on `main`.
2. Put the normal `public/sw.js` back (`cp ~/sw.normal.js public/sw.js`, or `git revert` the kill commit), commit and push. The bytes differ, so phones install the normal worker as a fresh registration and precache again.
3. Needs pwa-mobile-engineer and qa-engineer review, and the offline spec green.

## 3. A secret leaked or may have leaked
Rotate first, then investigate. Dr. Lee runs these; nobody pastes values into chat or the repo.

**Setting a value without leaking it.** `netlify env:set NAME <value>` puts the value in shell history and the process list. Use the Netlify UI (Site configuration, Environment variables, mark it secret, Production context only), or:
```
read -rs V && netlify env:set NAME "$V" --context production --secret; unset V
```

1. `GITHUB_TOKEN`: revoke the fine-grained PAT on GitHub, create a new one (this repo only, Contents read/write, no Workflows, 90-day expiry), then set it as above.
2. `ANTHROPIC_API_KEY`: revoke in the Anthropic console, create a new key in the dedicated workspace, then set it as above.
3. `GITHUB_READ_TOKEN`: **only if Dr. Lee has accepted ADR-0009** (otherwise it does not exist). Revoke and recreate it the same way.
4. **Trigger a deploy.** Functions keep the old value until a new deploy. In Netlify, Deploys, **Trigger deploy**. Then check the deploy log shows a real build (not "canceled" and not "no content change"): the `ignore` command may skip a rebuild of the same commit (UNVERIFIED). Confirm the new key works with one chat turn. If Netlify skips it, push a commit that touches `public/`; that costs 15 credits.
5. Confirm: `netlify env:list --context production` shows the names, and `--context deploy-preview` shows neither secret.
6. Supabase: the publishable key is public by design. If an `sb_secret_` or `service_role` key was ever exposed, rotate it in Supabase now; nothing in Beach Day uses it.
7. Review: the audit log (Blobs store `audit`); GitHub commits on `main` since the suspected time; the GitHub security log (Settings, Security log) for token use; and new branches or tags (`git ls-remote --heads --tags origin`). Roll back (§1) if any commit is not one you approved.
8. **No history rewrite.** Force-push to `main` is blocked. Rotate the secret and fix forward; a leaked value stays in git history, so rotation is the only remedy.

## 3a. The super_admin account is compromised
Do these in order, in the Supabase Dashboard (Auth and SQL editor). Nothing here needs a service key.
1. Change the password (Dashboard, Authentication, Users, or the Forgot password flow from a clean browser).
2. End every session: sign out with scope `global` (the Console's "Sign out everywhere", or Dashboard, Users, sign out the user). Existing access tokens still work until they expire (up to the JWT lifetime), so continue with step 3 at once.
3. Demote the account in SQL: `update public.profiles set role = 'user' where id = '<user id>';`. Every function checks the role on every request, so this closes the Console at once. Re-promote only after step 4.
4. Check `select * from auth.mfa_factors where user_id = '<user id>';` for factors Dr. Lee did not enrol. Delete any unknown factor, and re-enrol his own.
5. Rotate anything stored in Supabase that may have been exposed: the Google OAuth client secret (Google Cloud console, then Authentication, Providers, Google) and the custom SMTP password (Authentication, SMTP settings).
6. Review what the account did: the Blobs `audit` log, commits on `main` (roll back per §1 if any is not Dr. Lee's), and the Approve cap record. If an Approve may have been made, also rotate `GITHUB_TOKEN` (§3).

## 4. Credits and budget
- 15 credits per production deploy, 300 per month on Free, a hard cap. Tell the orchestrator at about 70% (210) and 90% (270). Rollback costs 0.
- If the site is paused at 0 credits, do not upgrade. Dr. Lee decides; Nell drafts an ADR.

## 5. Checklist after any rollback
- Smoke test passes and `/version.json.commit` is the intended commit.
- Auto publishing is locked (or unlocked on purpose after the fix).
- Tell the orchestrator what was rolled back and why, so QA can re-run the gate.
