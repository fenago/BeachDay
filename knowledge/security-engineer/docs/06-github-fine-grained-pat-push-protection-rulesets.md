# GitHub fine-grained PATs, push protection and rulesets
Source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens · https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens · https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api · https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection · https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
Retrieved: 2026-11-23 (docs.github.com is blocked from the sandbox shell, so it was read through Firecrawl in direct-quote mode)

## Fine-grained personal access tokens ([managing PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens))
**Scope:**
- "Each token is limited to access resources owned by a single user or organization."
- It "can be further limited to only access specific repositories".
- "Each token is granted specific, fine-grained permissions".
- Organization owners "can require approval". Until it is approved, a token "will only be able to read public resources".

**Limitations** listed for fine-grained PATs: contributing to repos where you are an outside or repository collaborator; accessing multiple organizations at once; Packages; the Checks API; and Projects owned by a user account. None of these affect Beach Day.

A classic PAT, by contrast, "will grant access to all repositories within the organizations that you have access to, as well as all personal repositories". That is why ADR-0005 uses fine-grained.

**Lifetime:**
- "GitHub automatically removes personal access tokens that haven't been used in a year."
- GitHub "highly recommend[s] adding an expiration".
- "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy".
- In pre-filled creation URLs, `expires_in` is 1–366 days or `none`, and defaults to 30.

**Repository access:** choose "the minimal repository access that meets your needs", that is, **Only select repositories**.

"Tokens always include read-only access to all public repositories on GitHub" (re-read on 2026-11-23 from the `github/docs` source, `content/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens.md`, because docs.github.com did not resolve from the sandbox). There is also a limit of 50 fine-grained tokens per user.

**Path scoping:** the token **cannot be limited to paths or branches**. No such option appears on the page, and docs/04 §5 says the same. That makes our allow-list the enforcement point.

## Permissions for the endpoints we use ([permissions table](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens))
**Contents: write** is required for:
- `POST /git/blobs`
- `POST /git/trees`
- `POST /git/commits`
- `PATCH /git/refs/{ref}`
- `PUT/DELETE /contents/{path}`

**Contents: read** covers `GET /contents`, `GET /git/ref` and `GET /git/commits`.

The "Update a reference" page lists **either** "Contents (write)" **or** "Contents (write) and Workflows (write)". The Workflows permission is what's needed for changes under `.github/workflows/`. The Contents PUT page says classic tokens need the `workflow` scope "to modify files in the .github/workflows directory".

Whether Metadata: read is added automatically is not stated on the pages read: **[UNVERIFIED]**. The PAT page's example token URL produces "contents:read and metadata:read".

## Authentication failures ([authenticating](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api))
- Invalid credentials → 401.
- Missing access → **404 or 403**.
- Repeated invalid attempts make GitHub "temporarily reject all authentication attempts for that user (including ones with valid credentials) with a 403". That is a self-inflicted outage if a function loops on 401.

## Push protection ([push protection](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection))
- It "blocks pushes that contain secrets before they reach your repository". It covers partner-pattern secrets, generic patterns (private keys, connection strings) when enabled, custom patterns, and AI-detected generic secrets.
- **Supported push surfaces** include "Requests to the REST API", next to command-line pushes, web UI commits and file uploads. Which pattern types apply on the REST surface is shown with table icons that didn't survive scraping: **[UNVERIFIED]** per pattern type.
- **Two types:**
  - **Push protection for repositories:** "Requires GitHub Secret Protection to be enabled". It is "disabled by default".
  - **Push protection for users:** "enabled by default". It "Stops you from pushing secrets to public repositories on GitHub".
- **Bypass:** the reasons are "It's used in tests", "It's a false positive" and "I'll fix it later". The first two create a closed alert, and the last creates an open alert. Delegated bypass can restrict who may bypass.

## Rulesets ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets))
- **Restrict deletions:** "only users with bypass permissions can delete branches or tags whose name matches the pattern". It is "selected by default".
- **Block force pushes:** "You can prevent users from force pushing to the targeted branches or tags. This rule is enabled by default."
- **Restrict file paths** (push rule): "Prevent commits that include changes in specified file paths from being pushed". The limit is 200 entries of up to 200 chars, with fnmatch syntax and allowed exceptions.
  - Plan and visibility availability was not captured: **[UNVERIFIED]** on this read. Repo doc 04 §5 says private/internal repos on GitHub Team and above.

## Beach Day notes
**Token setup** (ADR-0005), to verify during review:
- resource owner `fenago`
- Only select repositories → `BeachDay`
- Contents: Read and write
- **no Workflows**, no Pull requests
- 90-day expiry
- stored as a Netlify secret, Production context only

**Why no Workflows matters.** Without it, even a deny-list bypass can't change `.github/workflows/*`, so CI can't be turned into a secret-exfiltration channel. That GitHub rejects such a commit made with *our* token has not been observed in a live call: **[UNVERIFIED]**. Keep `.github/**` on our deny list regardless.

**Rulesets on `main`:** turn on **Block force pushes** and **Restrict deletions**. Both are defaults when you create a branch ruleset. Our approve function already uses `force:false`. The ruleset covers stolen-token scenarios.

**Push protection behind our scanner:**
- For a public repo, user push protection is on by default for the token owner.
- Surface a push-protection rejection as "GitHub blocked this commit because it looks like it contains a secret". Never offer a bypass from the Console.

**Error handling:**
- A 404 from GitHub with a valid token usually means the token isn't scoped to the repo. Fix the token; don't retry.
- Never retry 401s in a loop.

**Read token (ADR-0009, Proposed; docs/04 §4.6).** Because every fine-grained token can read public repos, a token with public-only access and no permissions can serve `read_file` and `list_files` while `fenago/BeachDay` is public. Leaking it exposes nothing an anonymous visitor can't see, except its 5,000/hr budget. Then only the approve function loads the write token. The exact label of the "public repositories" option in the UI wasn't captured, so check it when creating the token. Drafted as [ADR-0009](../../../docs/adr/0009-public-read-token-for-agent-reads.md) (option C, **Proposed**, awaiting Dr. Lee). It fails closed with no fallback to the write token, and it must be revisited if the repo goes private.

**Upgrade path** (docs/04 §5): a GitHub App with 1-hour installation tokens. Trigger it when more people use the Console or a leak is suspected.
