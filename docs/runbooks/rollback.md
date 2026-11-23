# Rollback runbook

Owner: netlify-engineer (Nell). Run by Dr. Lee or any human with Netlify access. Sources: docs/03 §8.3 and §9.3, docs/04 §4. Written to be followed at 2 am. Agents never run these steps.

Status: no Netlify site is linked yet (Dr. Lee, 2026-11-23). Until one is, there is nothing to roll back; use `git revert` (step 5) only. The Netlify steps are UNVERIFIED against a real site until the first deploy.

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
1. A human commits a replacement `public/sw.js` that, on `activate`, deletes every cache, calls `self.registration.unregister()` and reloads open clients. Keep the file in this runbook's owner's notes, not in `public/`. `sw.js` is denied to agents, so only a human can ship it.
2. The commit touches `public/`, so it deploys (15 credits). Check `/sw.js` is 200 with `Cache-Control: no-cache`.
3. After clients have recovered, ship the normal `sw.js` again (needs pwa-mobile-engineer and qa-engineer review).

## 3. A secret leaked or may have leaked
Rotate first, then investigate. Dr. Lee runs these; nobody pastes values into chat or the repo.
1. `GITHUB_TOKEN`: revoke the fine-grained PAT on GitHub, create a new one (this repo only, Contents read/write, no Workflows, 90-day expiry), then `netlify env:set GITHUB_TOKEN <value> --context production --secret`.
2. `ANTHROPIC_API_KEY`: revoke in the Anthropic console, create a new key in the dedicated workspace, then `netlify env:set ANTHROPIC_API_KEY <value> --context production --secret`.
3. **Trigger a new deploy.** Functions keep the old value until one runs. Use a build hook or an empty-diff change that touches `public/`.
4. Confirm: `netlify env:list --context production` shows the names, and `--context deploy-preview` shows neither secret.
5. Supabase: the publishable key is public by design. If an `sb_secret_` or `service_role` key was ever exposed, rotate it in Supabase now; nothing in Beach Day uses it.
6. Review the audit log (Blobs store `audit`) and GitHub commits on `main` since the suspected time; roll back (step 1) if any commit is not one you approved.

## 4. Credits and budget
- 15 credits per production deploy, 300 per month on Free, a hard cap. Tell the orchestrator at about 70% (210) and 90% (270). Rollback costs 0.
- If the site is paused at 0 credits, do not upgrade. Dr. Lee decides; Nell drafts an ADR.

## 5. Checklist after any rollback
- Smoke test passes and `/version.json.commit` is the intended commit.
- Auto publishing is locked (or unlocked on purpose after the fix).
- Tell the orchestrator what was rolled back and why, so QA can re-run the gate.
