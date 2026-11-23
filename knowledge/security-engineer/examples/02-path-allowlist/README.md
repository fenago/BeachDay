# Example 02: path allow-list / deny-list validator + attack table

## What it shows
`allowlist.mjs` is the shape of `netlify/functions/lib/allowlist.mts`. It encodes the canonical allow-list and deny-list from docs/04 §6 (mirrored in the `change-proposal-protocol` and `agent-console-security` skills). It must run when a proposal is created **and** again at approve time.

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
4. **DENY, matched case-insensitively, and DENY wins.** It is the canonical list from docs/04 §6:
   - `public/_headers`, `public/_redirects`, `public/sw.js`, `public/sw/**` (everything `sw.js` may import)
   - `public/vendor/**` (vendored `@supabase/auth-js`), `public/generated/**` (build-written `config.js`), `public/version.json`
   - `netlify/**`, `netlify.toml`, `.github/**`
   - `package*.json`, `scripts/**`
   - `**/.env*`, `**/*.pem`, `**/*.key`
   - `.git/**`, `.gitmodules`, `.claude/settings*`

   Because the match is case-insensitive, `Netlify.toml`, `public/_Headers`, `public/SW.js` and `.GitHub/…` are denied.
5. **ALLOW, matched with exact case.** `public/**` with a text extension (`html, css, js, json, webmanifest, svg, txt, md`), `tests/**`, `docs/**`, `.claude/agents/*.md`, `.claude/skills/**/*.md`. GitHub paths are case-sensitive, so `PUBLIC/index.html` is a *different*, unlisted path and is refused. `png` was dropped: proposals are UTF-8 text only, so a PNG could never pass anyway.
6. **Warnings** (allowed, but the proposal card says why to look harder):
   - `public/**/*.js` and `public/**/*.html`: the code runs in the site origin, where the Console's Supabase tokens sit in `localStorage` (docs/04 §3);
   - `public/console.html`, `public/js/console/**`: Console code. Denied in the built app (D6, Dr. Lee 2026-11-23); this example shows the warn-only variant;
   - `.claude/**`: agent behaviour and model choice (cost);
   - `tests/**`: runs as code in CI.

There are **no decode or normalise steps.** The validator checks the exact string that will go to GitHub. OWASP warns that inconsistent decoding can invalidate earlier checks (CWE-20).

`checkProposal` adds the proposal-level rules:
- 1–20 files, ≤ 200 KB each, text only (no NUL, and no lone surrogate: `isWellFormed()`, added wave 4, because GitHub would store U+FFFD and the hash, the diff and the blob SHA would no longer match `main`);
- mode `100644` only, so no symlink `120000` and no submodule `160000`;
- no case-insensitive duplicate paths, which would collide on macOS and Windows checkouts.

### `commitmsg.mjs` (added wave 4): the commit message and the reconciler match (docs/04 §6, §7)
- **`checkSummary(s)`** runs in `propose_change` and **rejects rather than repairs** (`is_error: true`). The summary is 20–2000 code points, well-formed, with no `\p{Cc}` (this covers `\n`, `\r`, tab, NUL and NEL), no `\p{Zl}`/`\p{Zp}` (U+2028/2029), no `\p{Cf}` (bidi overrides and isolates, zero-width characters), and no `Beach-Day-Proposal` text in any case. `\p{Cf}` goes beyond Rowan's §6 text: it stops a summary that reads differently in the proposal card from its bytes.
- **`buildCommitMessage(summary, id)`** runs on the server only and sanitises again: format and line-break characters become spaces, and the trailer word is removed **until the text stops changing** (one pass over `Beach-DayBeach-Day-Proposal-Proposal` leaves the word behind). The line is cut to 200 **code points** (a UTF-16 cut can split an emoji into a lone surrogate), and the result is `<one line>\n\nBeach-Day-Proposal: <id>`. A bad id throws.
- **`gitBlobSha(content)`** is `sha1("blob " + byteLength + "\0" + bytes)` and is checked against `git hash-object`.
- **`isProposalCommit(c, proposal)`**: the final line is exactly the trailer (one trailing newline tolerated); the author name is exactly `Beach Day Agent (<agent>)`; there is one parent; and every file's blob SHA at that commit equals `gitBlobSha(content)`.
- **`reconcileVerdict(commits, proposal, perPage)`**: if a **full** page has no match, the answer is `unknown` (stay `committing`), not `not_found`. Otherwise more than 50 commits in the window could hide the real commit. The reconciler would then mark it `failed` and leave the slot uncounted, which undercounts the Approve cap.

## How to run
```bash
mkdir -p /tmp/sec02 && cp *.mjs /tmp/sec02 && cd /tmp/sec02
node --test allowlist.test.mjs commitmsg.test.mjs     # no dependencies (git on PATH for the blob-SHA test)
```

## Verified
Re-run on 2026-11-23 with Node v22.23.5, from a scratch copy, after the canonical-list update (ADR-0006). The table is trimmed; all 63 rows printed PASS.

```
$ node --test allowlist.test.mjs
# PASS  true  "public/index.html"                            page [sensitive]
# PASS  true  "public/console.html"                          Console page (deny recommended; open for Dr. Lee) [sensitive]
# PASS  true  "docs/netlify/notes.md"                        'netlify' deeper in docs is fine
# PASS  false "public/../netlify.toml"                       traversal inside allowed dir -> dot segment
# PASS  false "/etc/passwd"                                  absolute system path -> absolute path
# PASS  false "public\\\\..\\\\netlify.toml"                     backslash traversal -> characters outside [A-Za-z0-9._-/]
# PASS  false "netlify.toml."                                trailing dot (Windows strips it) -> segment ends with '.'
# PASS  false "Netlify.toml"                                 case variant of denied file -> deny list
# PASS  false "PUBLIC/index.html"                            allow-list is exact case -> not on allow list
# PASS  false "public/_headers"                              CSP and security headers -> deny list
# PASS  false "public/_Headers"                              case variant of _headers -> deny list
# PASS  false "public/SW.js"                                 case variant of sw.js -> deny list
# PASS  false "public/sw/cache.js"                           file sw.js imports -> deny list
# PASS  false "public/vendor/supabase-auth-js-2.119.2.mjs"   vendored auth client -> deny list
# PASS  false "public/generated/config.js"                   build output config -> deny list
# PASS  false "public/version.json"                          build output version -> deny list
# PASS  false ".claude/settings.local.json"                  local Claude Code settings -> deny list
# PASS  false "public/icons/icon-512.png"                    binary type (png) not proposable -> not on allow list
# PASS  false "public/%2e%2e/netlify.toml"                   percent-encoded traversal -> characters outside [A-Za-z0-9._-/]
# PASS  false "nеtlify.toml"                                 Cyrillic homoglyph -> characters outside [A-Za-z0-9._-/]
# ...
# 63 cases
ok 1 - path allow-list attack table
ok 2 - warnings on allowed but sensitive paths
ok 3 - proposal-level checks: count, size, mode, duplicates, binary
# tests 3
# pass 3
# fail 0
```

Wave 4 (2026-11-23, Node v22.23.5, scratch copy): `node --test` → **9/9 pass** (the 3 tests above plus 6 in `commitmsg.test.mjs`; test 3 gained the lone-surrogate row). Mutation checks, each caught by exactly one test: one-pass trailer removal (test 5), UTF-16 cut (test 6), trailer matched anywhere instead of the last line (test 8), no full-page rule (test 9), `\p{Cf}` allowed (test 4).

## Notes for the security review
- **`.png` resolved.** It is no longer on the allow-list (docs/04 §6 `TEXT_EXT`). Icons and screenshots are human commits.
- **Symlinks already in the repo.** If an existing path under `public/` were a symlink to `netlify/…`, writing it as a `100644` blob would *replace* the symlink, not follow it. So the write is safe. Reading through `read_file` follows the symlink target (Contents API behaviour), and that is acceptable for reads.
- Fine-grained PATs can't be restricted by path (ADR-0005), so this file **is** the enforcement point. Changes to it are on the deny list and need human review.
