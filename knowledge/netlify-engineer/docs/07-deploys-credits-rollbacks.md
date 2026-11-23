# Deploys, rollbacks and credit-based plans
Source: https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/ , https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ , https://www.netlify.com/pricing/
Retrieved: 2026-11-23

## Credits per plan
| | Free | Personal | Pro |
|---|---|---|---|
| Credits per month | **300** | 1,000 | from 3,000 |
| When exhausted | **Hard limit** | buy more | buy more |
| Auto recharge | N/A | 500 credits for $5 | 1,500 credits for $10 |
[how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)

- "Once your credit balance is completely used up, all of your web projects ... are paused and visitors ... will find a `Site not available` page". [how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)
- The balance resets every billing cycle and doesn't roll over. The one exception is Pro with 5,000 or more credits. [how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)

## What costs credits
| Item | Credits |
|---|---|
| **Production deploy** | **15 each** (successful ones only) |
| Deploy Previews and branch deploys | **0** |
| **Failed deploys** and **rolling back** to an earlier production deploy | **0** |
| Compute: serverless, scheduled and background functions | **10 per GB-hour** (edge functions excluded) |
| Bandwidth | 20 per GB |
| Web requests (pages, assets, API and function calls) | 2 per 10,000 |
| Forms submissions | free |
| AI inference through Netlify (AI Gateway) | $1 = 180 credits |
[how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)

## Rollbacks and locking
- **Rollback:** open any earlier successful deploy and click **Publish deploy**.
  - It "doesn't trigger a new deploy but instead publishes a previous atomic deploy that is still available". Rollbacks are instantaneous.
  - [manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- **Auto publishing undoes it:** if auto publishing is on, the **next Git-triggered production deploy overwrites the rollback**. [manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- **Locking:** **Lock to stop auto publishing** pins the current published deploy. New deploys still build but aren't published. **Unlock to start auto publishing** reverses it. [manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- **Cancel deploy:** use the button on an in-progress deploy's page. [manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- **Retention** ([manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)):
  - Deploys are deleted after **30 days** (90 on paid plans).
  - Never deleted automatically:
    - the published deploy
    - the latest successful production deploy
    - the latest successful branch deploy per branch

## Plan features that matter to us (pricing table)
| Feature | Free |
|---|---|
| Secrets controller | Included |
| Smart secret detection | Not included |
| Rate limiting | Code-based rules |
| Scope env vars per deploy context / per feature | **Not included** |
| Custom function options (limits, memory, region) | Not included |
| Basic-auth headers, password-protected projects | Not included |
| Function log retention | 24 hours |
[pricing](https://www.netlify.com/pricing/)

## Beach Day notes
- **Budget (ADR-0004):**
  - 300 credits ÷ 15 = **20 production deploys a month**, if nothing else is used.
  - Each Approve is one atomic commit and one deploy (ADR-0003), unless the commit only touches paths the `ignore` rule skips.
  - **Approve cap: 14 in a rolling 31 days = 210 credits, which is exactly 70% (ADR-0008).** A rolling 31-day window means any billing cycle of 31 days or less holds at most 14 Approve deploys, whatever day the cycle resets. The 70% warning therefore fires at the cap on its own; the useful early signal is spend that is **not** Approve deploys. Planned split of 300: 210 Approves, 45 for human pushes (3 deploys), 45 for compute, bandwidth and requests. That split is netlify-engineer's proposal, not a decision.
  - Warn Dr. Lee at about **70%** (about 210 credits) and again at **90%** (270): stop non-essential pushes.
  - The site pauses at 0 with no auto-recharge on Free.
- **Save credits:**
  - One commit per proposal (Git Database API).
  - Skip commits that change nothing shipped with the `ignore` command (doc 05, example 02). Failed builds cost 0 (documented). Skipped builds are **expected** to cost 0 but this is **[UNVERIFIED]**.
  - QA runs on the main deploy with a rollback ready (ADR-0003; Dr. Lee's decision). Deploy Previews cost 0 credits but are not on the Approve path.
  - Never redeploy just to "refresh".
  - Batch human changes into one push.
- **Rough compute:**
  - A 60 s chat turn at 1 GB is about 0.017 GB-hour, or about 0.17 credits.
  - A 15-minute job is 0.25 GB-hour, or 2.5 credits.
  - So 100 chat turns a day is about 17 credits a day, over 500 a month, **more than the whole Free budget**. Real turns are usually much shorter than 60 s, but **measure it**. Per-session daily caps (docs/04 §9) are what keep this inside 300.
  - The compute arithmetic is ours, from the published rate. Actual billed duration is not verified.
- **Rollback runbook** (`docs/runbooks/rollback.md`, owned by netlify-engineer; **not written yet**, it sits outside this round's scope and is listed in the HANDOFF):
  1. Open Deploys and pick the last good deploy.
  2. Click **Publish deploy**. It is instant and costs 0 credits.
  3. Click **Lock to stop auto publishing**, so the next Approve doesn't re-publish the bad code.
  4. Fix it with a revert commit through the normal flow.
  5. Unlock.
- **Logs:** Free keeps function logs for only 24 hours. Capture failures in the Blobs `audit` store if they need to last longer.
