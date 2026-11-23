# GitHub REST API: authentication, headers, versions, rate limits
Source: https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api · https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api · https://docs.github.com/en/rest/about-the-rest-api/api-versions · https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api · https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
Retrieved: 2026-11-23 (docs.github.com is blocked from the sandbox shell, so these pages were read through Firecrawl in direct-quote mode)

## Authentication ([authenticating](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api))
- Send the token in the `Authorization` header. "In most cases, you can use `Authorization: Bearer` or `Authorization: token`" to pass a token. A JWT requires `Bearer`. We use `Bearer`.
- No token, or a token with insufficient permissions, gives "a 404 Not Found or 403 Forbidden response". A missing permission can therefore look like a 404.
- "Authenticating with invalid credentials will initially return a 401 Unauthorized response."
- After several invalid attempts in a short period, the API "will temporarily reject all authentication attempts for that user (including ones with valid credentials) with a 403 Forbidden response". Don't retry 401s in a loop.

## Required and recommended headers ([getting started](https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api))
| Header | Value | Rule |
|---|---|---|
| `Accept` | `application/vnd.github+json` | "Most … endpoints specify that you should pass" it |
| `User-Agent` | e.g. `beach-day-console` | "All API requests must include a valid User-Agent header." A missing one is rejected, and an invalid one gets 403 |
| `X-GitHub-Api-Version` | `2022-11-28` (or `2026-03-10`) | see below |
| `Authorization` | `Bearer <fine-grained PAT>` | |
| `Content-Type` | `application/json` | on POST/PATCH/PUT bodies |

## API versions ([api-versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions))
| Version | End of support |
|---|---|
| `2026-03-10` | Not yet scheduled |
| `2022-11-28` | **March 10, 2028** |

- "Requests without the X-GitHub-Api-Version header will default to use the 2022-11-28 version."
- An unsupported version returns **410 Gone**.
- After a new version is released, the previous one is "supported for at least 24 more months".
- The docs site now renders its curl examples with `X-GitHub-Api-Version: 2026-03-10`. Breaking changes between the two versions are listed in the GitHub changelog; that list was **not read** for this note. **[UNVERIFIED]** which endpoints we use differ in `2026-03-10`.

## Rate limits ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api))
**Primary:** a personal token gets 5,000 requests/hour. That is the PAT's owner's personal limit, shared with everything else that uses it.

**Secondary limits (exact list):**
- "No more than 100 concurrent requests are allowed."
- "No more than 900 points per minute are allowed for REST API endpoints."
- "No more than 90 seconds of CPU time per 60 seconds of real time is allowed."
- "In general, no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour are allowed."

**Headers:** `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-used`, `x-ratelimit-reset` (UTC epoch seconds) and `x-ratelimit-resource`. GitHub says not to build logic on an exact remaining count.

**When you exceed a limit:**
- Exceeding a secondary limit returns **403 or 429**.
- If `retry-after` is present, wait that many seconds.
- Else if `x-ratelimit-remaining` is `0`, wait until `x-ratelimit-reset`.
- Otherwise "wait for at least one minute before retrying".

## Fine-grained PAT permissions for the endpoints we call ([permissions page](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens), plus each endpoint page)
| Endpoint | Contents |
|---|---|
| `GET /repos/{o}/{r}/contents/{path}` | read |
| `GET /repos/{o}/{r}/git/ref/{ref}` | read |
| `GET /repos/{o}/{r}/git/commits/{sha}` | read |
| `POST /repos/{o}/{r}/git/blobs` | write |
| `POST /repos/{o}/{r}/git/trees` | write |
| `POST /repos/{o}/{r}/git/commits` | write |
| `PATCH /repos/{o}/{r}/git/refs/{ref}` | write, **or** write + Workflows: write |
| `PUT /repos/{o}/{r}/contents/{path}` | write ("multiple permissions … may be required") |

- The "Update a reference" page lists two permission sets: "Contents (write)" **or** "Contents (write) and Workflows (write)". The second is what lets a token change `.github/workflows/*`.
- The Contents PUT page says classic tokens need the `workflow` scope "to modify files in the .github/workflows directory".
- Whether the Metadata: read permission is added automatically was not stated on the pages read: **[UNVERIFIED]**. The PAT page's example says a pre-filled URL creates a token "with contents:read and metadata:read".

## Beach Day notes
- One helper (`lib/github`) sets all five headers, makes requests **serially**, and raises an error carrying `status` and `retry-after`. On 403/429 with `retry-after`, the approve function returns "GitHub is busy, try again in N s" instead of looping.
- An Approve is about 5 requests (examples/03), so we stay far under 80 content-creating requests a minute. The danger is retry loops, so cap retries at one.
- Keep `X-GitHub-Api-Version: 2022-11-28` for now (supported until 2028-03-10). Moving to `2026-03-10` is a reviewed change after reading its breaking-changes list.
- A 404 on `git/ref/heads/main` with a valid token most likely means the token is not scoped to `fenago/BeachDay`, not that the branch is missing. Show "GitHub token can't see the repo".
- ADR-0005: Contents read/write only, **no Workflows**. A commit that touches `.github/workflows/*` should then fail at GitHub too, as a second line behind our deny-list. That failure has not been observed in a real call: **[UNVERIFIED]**.
