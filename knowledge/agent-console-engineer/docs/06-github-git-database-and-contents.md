# GitHub Git Database API (refs, commits, trees) and the Contents API
Source: https://docs.github.com/en/rest/git/refs · https://docs.github.com/en/rest/git/commits · https://docs.github.com/en/rest/git/trees · https://docs.github.com/en/rest/git/blobs · https://docs.github.com/en/rest/repos/contents
Retrieved: 2026-11-23 (read through Firecrawl in direct-quote mode)

## Refs ([refs](https://docs.github.com/en/rest/git/refs))
**Get a reference:** `GET /repos/{owner}/{repo}/git/ref/{ref}`
- "The :ref in the URL must be formatted as `heads/<branch name>` for branches and `tags/<tag name>` for tags."
- A ref that doesn't exist returns 404.
- Status codes: 200, 404, 409.
- Permission: Contents read.
- The response's `object.sha` is the head commit.

**Update a reference:** `PATCH /repos/{owner}/{repo}/git/refs/{ref}`
- Body:
  - `sha` (required): "The SHA1 value to set this reference to"
  - `force` (boolean, **default `false`**): "Indicates whether to force the update or to make sure the update is a fast-forward update. Leaving this out or setting it to false will make sure you're not overwriting work."
- Status codes: **200**, **409** Conflict, **422** "Validation failed, or the endpoint has been spammed."
- The docs' own curl example sends `"force":true`. **Do not copy it.**

## Commits ([commits](https://docs.github.com/en/rest/git/commits))
**Get a commit object:** `GET /repos/{owner}/{repo}/git/commits/{commit_sha}`
- Returns `tree.sha`, `parents[]` and `message`.
- Status codes: 200, 404, 409. Permission: Contents read.

**Create a commit:** `POST /repos/{owner}/{repo}/git/commits`

Body:
- `message` (required)
- `tree` (required)
- `parents`: "If omitted or empty, the commit will be written as a root commit. For a single parent, an array of one SHA should be provided." Always send `[headSha]`.
- `author` `{name, email (required), date}`: "By default, the author will be the authenticated user and the current date."
- `committer`: defaults to `author`.
- `signature`: an optional ASCII-armored detached PGP signature. Unsigned API commits show `verification.verified: false, reason: "unsigned"`.

Status codes: 201, 404, 409, 422. Permission: Contents write.

## Trees ([trees](https://docs.github.com/en/rest/git/trees))
**Create a tree:** `POST /repos/{owner}/{repo}/git/trees`

`tree[]` items:
- `path`
- `mode`: one of `100644` file, `100755` executable, `040000` subdirectory, `160000` submodule, `120000` symlink
- `type`: `blob`, `tree` or `commit`
- either `sha` or `content`:
  - `sha: null` deletes the file.
  - `content` makes GitHub write the blob for you.
  - "Using both tree.sha and content will return an error."

`base_tree` (verbatim, because this is the rule that matters):
> "If not provided, GitHub will create a new Git tree object from only the entries defined in the tree parameter. If you create a new commit pointing to such a tree, then all files which were a part of the parent commit's tree and were not defined in the tree parameter will be listed as deleted by the new commit."

Entries in `tree` "overwrite items from base_tree with the same path".

Status codes: 201, 404, 409, 422. Permission: Contents write.

**Get a tree:** `GET …/git/trees/{tree_sha}?recursive=1`
- Any value of `recursive` enables recursion, including `"false"`.
- Limit: 100,000 entries and 7 MB with `recursive`. Beyond that the response is truncated.

## Blobs ([blobs](https://docs.github.com/en/rest/git/blobs))
- `POST …/git/blobs` takes `{content, encoding: "utf-8"|"base64"}` and needs Contents write.
- Beach Day doesn't need separate blob calls, because tree entries with `content` create the blobs.
- Request and response details of this page were not re-read in this pass: **[UNVERIFIED]** beyond the permission row.

## Contents API ([contents](https://docs.github.com/en/rest/repos/contents))
**Get repository content:** `GET /repos/{owner}/{repo}/contents/{path}?ref=`
- `ref` defaults to the default branch.
- Custom media types:
  - `application/vnd.github.raw+json`: raw bytes
  - `application/vnd.github.html+json`
  - `application/vnd.github.object+json`: a consistent object for files and directories
- Size rules:
  - ≤ 1 MB: all features.
  - 1–100 MB: only `raw` or `object`. With `object`, "the content field will be an empty string and the encoding field will be `"none"`".
  - Over 100 MB: not supported.
- Directory listings are capped at **1,000 files**.
- A symlink to a normal file returns the target file's content. A submodule returns `submodule_git_url`.
- Status codes: 200, 302, 304, 403, 404.
- Permission: Contents read.
- File response fields: `type`, `encoding` (`base64`), `size`, `name`, `path`, `content`, `sha` (the blob SHA), `url`, `git_url`, `html_url`, `download_url`.

**Create or update file contents:** `PUT /repos/{owner}/{repo}/contents/{path}`
- Body: `message` (required), `content` (required, Base64), `sha` ("Required if you are updating a file. The blob SHA of the file being replaced."), `branch`, `committer`, `author`.
- Status codes: 200, 201, 404, 409, 422.
- Using it in parallel with Delete "will conflict … You must use these endpoints serially instead."
- Each PUT is **its own commit**.

## Why the Git Database API for Approve
| | Contents PUT per file | Git Database (ref → commit → tree → commit → ref) |
|---|---|---|
| Commits for N files | N | **1** |
| Netlify production deploys | N × 15 credits | **15 credits** |
| Atomic | no (partial failure leaves half a change) | **yes** (the ref moves once) |
| Concurrency | must be serial; per-file `sha` | fast-forward check on the ref (`force:false`) |

## The sequence (as implemented in `examples/03-atomic-commit/github.mjs`)
```
GET   /git/ref/heads/main                 → headSha
(if headSha ≠ proposal.baseSha: GET /contents/{path}?ref=headSha for each touched file;
 any blob sha ≠ sha the agent read → "stale", stop)
GET   /git/commits/{headSha}              → tree.sha
POST  /git/trees   {base_tree, tree:[{path, mode:"100644", type:"blob", content}]} → treeSha
POST  /git/commits {message, tree:treeSha, parents:[headSha], author:{name:"Beach Day Agent (<agent>)", email}}
PATCH /git/refs/heads/main {sha:commitSha, force:false}
      409/422 → main moved: retry once from the top, then "stale"
```

## Beach Day notes
- ADR-0003 requires one atomic commit per proposal, **always with `base_tree`**, and **`force:false`**. A missing `base_tree` would delete the whole site in one approved commit, so the security review blocks it.
- Only mode `100644` blobs. Reject `120000` (symlink), `160000` (submodule) and `100755` in the allow-list layer.
- Deletions (`sha: null`) are out of scope for v1 proposals. If they are added later, they must pass the same allow-list.
- Push protection can reject REST API commits that contain secrets (security-engineer doc 06). Surface that error to the user instead of retrying.
- The author `name` carries the agent's name. The commit is still made by the PAT owner (ADR-0005).
