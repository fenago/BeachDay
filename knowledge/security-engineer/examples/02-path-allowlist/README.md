# Example 02: path allow-list / deny-list validator + attack table

## What it shows
`allowlist.mjs` is the shape of `netlify/functions/lib/allowlist.mts`. It encodes the allow-list and deny-list from the `agent-console-security` skill (docs/04 §6). It must run when a proposal is created **and** again at approve time.

It is what good looks like because the checks are layered and each layer is simple:

1. **Type and length.** The path must be a string of 1–200 characters.
2. **Character allow-list: `[A-Za-z0-9._-/]` only.** Following OWASP Input Validation ("Define what the application accepts and reject values outside those rules"), this one rule rejects, by construction:
   - backslashes and Windows drive letters or NTFS streams (`:`)
   - NUL and control characters
   - `%` (so no encoded traversal or encoded slashes)
   - spaces
   - all non-ASCII: homoglyphs such as Cyrillic `е`, fullwidth `／`, combining marks
3. **Segment rules:**
   - no leading `/`
   - no empty segments (`//`, trailing `/`)
   - no `.` or `..` segments
   - no segment ending in `.` (Windows strips trailing dots, so `netlify.toml.` would become `netlify.toml`)
4. **DENY, matched case-insensitively, and DENY wins.** It covers:
   - `netlify/**`, `netlify.toml`, `.github/**`
   - `package*.json`, `scripts/**`
   - `**/.env*`, `**/*.pem`, `**/*.key`
   - `.git/**`, `.gitmodules`, `.claude/settings*`

   Because the match is case-insensitive, `Netlify.toml` and `.GitHub/…` are denied.
5. **ALLOW, matched with exact case.** GitHub paths are case-sensitive, so `PUBLIC/index.html` is a *different*, unlisted path and is refused. A `sensitive` flag marks `public/_headers` (CSP), `.claude/**` (agent behaviour) and `public/sw.js`, so the UI can warn about them.

There are **no decode or normalise steps.** The validator checks the exact string that will go to GitHub. OWASP warns that inconsistent decoding can invalidate earlier checks (CWE-20).

`checkProposal` adds the proposal-level rules:
- 1–20 files, ≤ 200 KB each, text only (no NUL);
- mode `100644` only, so no symlink `120000` and no submodule `160000`;
- no case-insensitive duplicate paths, which would collide on macOS and Windows checkouts.

## How to run
```bash
mkdir -p /tmp/sec02 && cp *.mjs /tmp/sec02 && cd /tmp/sec02
node --test allowlist.test.mjs     # no dependencies
```

## Verified
Run on 2026-11-23 with Node v22.23.5, from a scratch copy. The table is trimmed; all 51 rows printed PASS.

```
$ node --test allowlist.test.mjs
# PASS  true  "public/index.html"                            page
# PASS  true  "public/_headers"                              allowed but sensitive (CSP) [sensitive]
# PASS  true  "docs/netlify/notes.md"                        'netlify' deeper in docs is fine
# PASS  false "public/../netlify.toml"                       traversal inside allowed dir -> dot segment
# PASS  false "/etc/passwd"                                  absolute system path -> absolute path
# PASS  false "public\\\\..\\\\netlify.toml"                     backslash traversal -> characters outside [A-Za-z0-9._-/]
# PASS  false "netlify.toml."                                trailing dot (Windows strips it) -> segment ends with '.'
# PASS  false "Netlify.toml"                                 case variant of denied file -> deny list
# PASS  false ".GitHub/workflows/deploy.yml"                 case variant of .github -> deny list
# PASS  false "PUBLIC/index.html"                            allow-list is exact case -> not on allow list
# PASS  false "public/.env"                                  .env under an allowed dir -> deny list
# PASS  false "public/index.html\\u0000.png"                  NUL byte -> characters outside [A-Za-z0-9._-/]
# PASS  false "public/%2e%2e/netlify.toml"                   percent-encoded traversal -> characters outside [A-Za-z0-9._-/]
# PASS  false "nеtlify.toml"                                 Cyrillic homoglyph -> characters outside [A-Za-z0-9._-/]
# PASS  false "public／index.html"                            fullwidth solidus -> characters outside [A-Za-z0-9._-/]
# ...
# 51 cases
ok 1 - path allow-list attack table
ok 2 - sensitive flag on CSP and agent files
ok 3 - proposal-level checks: count, size, mode, duplicates, binary
# tests 3
# pass 3
# fail 0
```

## Notes for the security review
- **`.png` conflicts with "UTF-8 text only".** The skill's allow-list includes `public/**/*.png`, but proposals are text only, so a real PNG can never pass (`NUL` check). Either drop `png` from the allow-list or add an explicit base64 binary path with its own size limit. That is a decision, not a bug to fix silently.
- **Symlinks already in the repo.** If an existing path under `public/` were a symlink to `netlify/…`, writing it as a `100644` blob would *replace* the symlink, not follow it. So the write is safe. Reading through `read_file` follows the symlink target (Contents API behaviour), and that is acceptable for reads.
- Fine-grained PATs can't be restricted by path (ADR-0005), so this file **is** the enforcement point. Changes to it are on the deny list and need human review.
