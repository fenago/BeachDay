# Example 06 — GitHub Actions template with no secrets, and its lint

## What it demonstrates
Security-engineer's decision (docs/04 §4.7): **tests run in GitHub Actions with `permissions: contents: read`, no secrets, no `pull_request_target`, actions pinned by SHA, never in the Netlify build.** Agents cannot add `.github/workflows/*` (deny-listed; the PAT has no Workflows permission), so a human does.

- `tests.yml` is the **template**: jobs `unit`, `e2e` (needs unit) and `post-deploy` (push to `main` only). The post-deploy job decides from the changed paths whether Netlify built anything (the same list as the `ignore` command in docs/03 §3.1), polls `${SITE_URL}/version.json` until it names the commit, then runs `scripts/smoke.mjs`, the read-only `@prod` e2e and axe specs, and Lighthouse CI against the **production URL** (there are no Deploy Previews). It holds no credentials; `SITE_URL` is a repository **variable**.
- A human replaces each `<PIN-SHA>` with the full 40-character commit SHA of the release in the comment. **No SHA is invented here**: the sandbox could not reach GitHub to resolve them.
- `workflow-lint.mjs` checks a workflow file against the rules (read-only token at top level and per job, no secrets, no privileged triggers, SHA pins, `persist-credentials: false` on checkout, no `${{ }}` inside `run:`, `timeout-minutes`). `workflow-lint.test.mjs` proves it with 13 planted violations, the template in template mode, the pinned copy in strict mode, and the template **failing** strict mode (so an unpinned file cannot be committed unnoticed). Once the real file exists, copy the test to `tests/unit/workflow.test.js` pointed at `.github/workflows/tests.yml` with `strict: true`.

## Run
```bash
cd knowledge/qa-engineer/examples/06-github-actions-no-secrets
npm install        # yaml 2.9.1; do not commit node_modules or a lockfile from here
npm test
```

## Verified
Run 2026-11-23, Node v22.23.5, `yaml@2.9.1`, from a scratch copy:
```
# tests 16
# pass 16
# fail 0
```
(After a first run, one assertion hard-coded "8 unpinned actions"; the template has 6 `uses:` lines, and the test now counts them.)

**Not run:** `actionlint` (not installed), and the workflow itself on GitHub (no workflow exists in the repo and the sandbox has no GitHub access). Only YAML parsing and the lint ran. The GitHub documentation for `permissions` and secure use was unreachable, so the exact semantics are UNVERIFIED; the rules come from security-engineer's decision. The `persist-credentials: false` behaviour is from memory.
