# Input validation and the path allow-list
Source: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html · https://cwe.mitre.org/data/definitions/20.html · https://docs.github.com/en/rest/git/trees · https://docs.github.com/en/rest/repos/contents
Retrieved: 2026-11-23 (OWASP from the official CheatSheetSeries GitHub source; GitHub docs through Firecrawl)

## OWASP rules that drive our validators ([Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html))
**Allowlist over denylist.** "Define what the application accepts and reject values outside those rules. Do not try to recognize every malicious string."

**Parse safely, then validate:**
- "Apply request size limits before buffering or parsing input". A schema check after parsing can't protect a parser that has already run out of resources.
- "Decode according to the protocol before checking field rules. Validate the representation that will actually be used, and avoid decoding it again downstream" (CWE-20).

**Structured data:**
- For JSON, explicitly configure required and additional properties. "listing a property alone neither requires it nor rejects unknown fields".
- Use array length limits.
- "Reject invalid requests with a clear error; do not continue with partially validated data."
- Bind only intended fields (see mass assignment).

**Unicode:**
- Agree on an encoding and reject malformed input.
- If you normalise, use the same policy everywhere.
- "Normalization is not sanitization and does not replace output encoding."

**Regex:**
- Match the **whole value**.
- Bound the input length before matching.
- Avoid catastrophic backtracking.
- Treat a regex timeout as a validation failure.

**Pitfalls:**
- "Denylisting or 'cleaning' input"
- "Assuming regex or Unicode normalization makes data safe"

## How these apply to repo paths
The agent supplies a path string, and our function sends it to GitHub as a tree entry `path`. The relevant GitHub facts:
- **Tree entry modes** are `100644` file, `100755` executable, `040000` subdirectory, `160000` submodule and `120000` "a blob that specifies the path of a symlink" ([trees](https://docs.github.com/en/rest/git/trees)). Only `100644` is safe for us.
- **Contents API reads:** if a path is a symlink to a normal file, the API "responds with the content of the file"; submodules return a `submodule_git_url` ([contents](https://docs.github.com/en/rest/repos/contents)). Reads can therefore follow links, so read access must not be treated as a write check.
- Git paths are case-sensitive. Developer machines (macOS, Windows) are usually case-insensitive, so `Netlify.toml` would become *the* `netlify.toml` on a checkout.

### Validator design (implemented and tested in `examples/02-path-allowlist/`)
1. **Type and length:** a string of 1–200 characters.
2. **Character allow-list `^[A-Za-z0-9._\-/]+$`.** This kills, by construction:
   - `\`
   - NUL and control characters
   - `%` (encoded traversal: `%2e%2e`, `%2f`)
   - `:` (drive letters, NTFS `::$DATA`)
   - spaces and all non-ASCII (homoglyphs, fullwidth `／`, combining marks)
3. **Segments:** no leading `/`, no empty segment, no `.` or `..`, and no segment ending in `.`.
4. **DENY, case-insensitive, and deny wins:**
   - `netlify/**`, `netlify.toml`, `.github/**`
   - `package*.json`, `scripts/**`
   - `**/.env*`, `**/*.pem`, `**/*.key`
   - `.git/**`, `.gitmodules`, `.claude/settings*`
5. **ALLOW, exact case:**
   - `public/**/*.{html,css,js,json,webmanifest,svg,png,txt}`
   - `public/_headers`
   - `tests/**`, `docs/**`
   - `.claude/agents/*.md`, `.claude/skills/**/*.md`
6. **Proposal level:**
   - 1–20 files, ≤ 200 KB each
   - text only (no NUL)
   - mode `100644` only
   - no case-insensitive duplicates
7. **Never decode or normalise and then re-check.** Validate exactly the string that will be sent.

## Other inputs the functions must validate
| Input | Rule |
|---|---|
| Any body | method allow-list; `content-type: application/json`; size cap **before** `JSON.parse` (64 KB; 32 KB for chat text; ≤ 4 MB total for proposals per `secure-by-design`) |
| IDs (`p_…`, `j_…`) | `^[pj]_[0-9A-Z]{26}$`, full match |
| `messages[]` from the browser | roles only `user`/`assistant`, the last one `user`, text content only (no client-supplied `tool_result` or `thinking` blocks), count cap |
| Tool inputs from Claude | `strict` guarantees shape only. Re-validate path, size and count in code |
| `contentHash` on Approve | `^[0-9a-f]{64}$`; must equal the recomputed hash |

## File-upload cheat sheet points that carry over ([File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html))
Proposals are effectively uploads into the repo. The cheat sheet's rules that carry over, quoted:
- "List allowed extensions. Only allow safe and critical extensions for business functionality"
- "Ensure that input validation is applied before validating the extensions."
- "Set a filename length limit. Restrict the allowed characters if possible"
- "Only allow authorized users to upload files"

Extension-validation bypasses it lists:
- double extensions (`.jpg.php`)
- null bytes (`.php%00.jpg`)
- alternative extensions mapped to the same interpreter

Our tests include `public/index.html.php` and the NUL and `%` cases.

## Beach Day notes
- `lib/allowlist` is the **only** path control. Fine-grained PATs can't be scoped to paths (ADR-0005). GitHub push rulesets that restrict file paths exist, but their plan availability was not confirmed this pass (doc 06).
- Run the same `checkPath`/`checkProposal` at `propose_change` **and** at Approve. The approve function must not trust anything stored in Blobs.
- Do not let the browser send `tool_result`, `thinking` or `tool_use` blocks in `/api/chat`. Those exist only in the server-side conversation state. Otherwise a user could forge "tool output" (thought/observation injection).
- **Open decision:** `png` is on the allow-list, but proposals are text-only, so PNGs can't actually pass. Drop it or design a binary path (examples/02 README).
