# Example 03: atomic multi-file commit to `main` (Git Database API) + GET contents

## What it shows
`github.mjs` is the shape of `netlify/functions/lib/github`, used by the approve function (ADR-0003, ADR-0005). It uses plain `fetch` and has no dependencies.

**Headers on every call:**
- `Authorization: Bearer <token>`
- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`
- a `User-Agent`, which GitHub requires ("Requests with no User-Agent header will be rejected").

**`getFile(path, ref)`** calls `GET /repos/{owner}/{repo}/contents/{path}?ref=`:
- It decodes the base64 `content` and returns the blob `sha`. The agent's `read_file` keeps that sha so the stale check can use it later.
- It returns `null` on 404, which means a new file.
- It refuses directories and files whose `encoding` is not `base64` (over 1 MB).

**`commitFiles(...)`** writes **one atomic commit** for N files, with every request made serially:
1. `GET /git/ref/heads/main` gets the head SHA.
2. **Stale check.** If `main` moved since the proposal's `baseSha`, it compares the current blob SHA of each *touched* file with the SHA the agent read. If any differ, it returns `stale` and writes nothing.
3. `GET /git/commits/{headSha}` gets `tree.sha`.
4. `POST /git/trees` sends **`base_tree`** plus `{path, mode: "100644", type: "blob", content}` entries. GitHub's docs: without `base_tree`, every file you don't list "will be listed as deleted by the new commit".
5. `POST /git/commits` sends `parents: [headSha]` and an author name that carries the agent name.
6. `PATCH /git/refs/heads/main` sends **`force: false`**, so the update must be a fast-forward. On 422/409 (main moved during steps 3–5) it retries **once** from step 1, then gives up as `stale`.

`mock-github.mjs` is a local `node:http` GitHub with a tiny in-memory git (blobs, trees, commits, `main`). For each request it:
- **asserts the headers.** It returns 401 on the wrong token and 400 if Accept or the API version is missing.
- **refuses** `POST /git/trees` without `base_tree`, any mode other than `100644` blob, and `PATCH` without `force:false`.
- **rejects** non-fast-forward ref updates with 422.
- **records the call sequence.** The tests assert the exact order.

**No real GitHub call or token is used.** The token is the placeholder `github_pat_EXAMPLE`.

## How to run
```bash
mkdir -p /tmp/ex03 && cp *.mjs /tmp/ex03 && cd /tmp/ex03
node --test github.test.mjs      # no npm install needed
```

## Verified
Run on 2026-11-23 with Node v22.23.5, from a scratch copy outside the repo:

```
$ node --test github.test.mjs
ok 1 - GET contents returns text + blob sha
# GET /git/ref/heads/main
# GET /git/commits/0df6f303ea573bbf1946c40607039f75e97d170b
# POST /git/trees
# POST /git/commits
# PATCH /git/refs/heads/main
ok 2 - atomic 2-file commit: exact sequence, base_tree kept, force:false
ok 3 - main moved but touched files unchanged: commit on new head
ok 4 - touched file changed on main: stale, nothing written
ok 5 - race at PATCH (not a fast forward): one retry from step 1
ok 6 - bad token -> 401 surfaces as an error
# tests 6
# pass 6
# fail 0
```

## Limits of the mock
- The mock's 422 message "Update is not a fast forward" matches common GitHub behaviour, but the docs page lists only the status codes (200/409/422) for "Update a reference". The exact message is **[UNVERIFIED]**, so branch on the status code, never on the message.
- Push protection (a 4xx when the content contains a known secret pattern) and secondary rate limits (403/429 with `retry-after`) are not simulated. `err.retryAfter` is captured so the caller can honour it.
- In production, the approve function must re-run the allow-list, size limits, secret scan, content hash and the compare-and-swap (CAS) status update **before** `commitFiles`. See docs/04 §7 and the security-engineer examples.
