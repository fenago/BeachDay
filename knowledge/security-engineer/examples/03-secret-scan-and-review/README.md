# Example 03: proposal secret scanner + a sample security review

## What it shows
### `secretscan.mjs`: the shape of `netlify/functions/lib/secretscan`
- **Rules.** It covers the patterns required by the `agent-console-security` skill:
  - `sk-ant-…` (20+ chars)
  - `github_pat_…`
  - `gh[pousr]_…`
  - `-----BEGIN … PRIVATE KEY-----`
  - a high-entropy token (≥ 40 chars, Shannon entropy ≥ 4.2 bits/char) on a line that mentions key, token, secret, password, bearer or auth

  It adds these rules:
  - Supabase secret keys, `sb_secret_…` (ADR-0006: never used anywhere, so any hit is an incident)
  - any full three-part JWT (`eyJ….eyJ….…`). That catches the legacy `service_role` and `anon` keys and leaked user access tokens. The bare word `service_role` is **not** a rule: our own docs explain it, and a word rule would block every docs proposal that mentions it.
  - AWS access key IDs
  - Slack tokens
  - assignments to our secret env var names (`ANTHROPIC_API_KEY=…`, `GITHUB_TOKEN=…`, `GITHUB_READ_TOKEN=…`)
- **Redacted findings.** A finding shows at most 6 characters and the length, so findings are safe to log, store in the proposal record and show in the UI. That follows the OWASP Logging cheat sheet (never log access tokens).
- **Whole-proposal scan.** `scanProposal` scans each file's **path and content**. Any finding blocks the proposal. It runs at propose time **and** at approve time.
- **Placeholders stay quiet.** The short placeholders `sk-ant-EXAMPLE` and `github_pat_EXAMPLE` do not fire, because they are below the length thresholds. That is how `secure-by-design` says the scanner should treat placeholders.
- **Repo paths stay quiet.** Long lower-case, slash-separated paths such as `knowledge/supabase-auth-engineer/examples/01-token-and-role-check` score above 4.2 bits/char and sit next to words like "token". The entropy rule skips path-shaped candidates; mixed-case base64 is still checked.
- **Hex hashes stay quiet.** Hex strings such as git SHAs and SHA-256 digests stay below the entropy threshold (max 4.0 bits/char for hex), so commit SHAs next to the word "token" don't cause false positives.

### `secretscan.test.mjs`
Every positive fixture is **built at runtime** from concatenated pieces plus a seeded PRNG. The committed file never contains a literal that GitHub push protection, or any other scanner, would flag. That matters because push protection also applies to our own repo.

### `security-review-sample.md`
A worked review in the format required by `.claude/agents/security-engineer.md`:
- the verdict **APPROVE WITH CHANGES**;
- findings ranked by severity, each with *where*, an *exploit scenario* and a *fix*;
- what was checked and is fine;
- a table of required tests;
- the closing `HANDOFF` block from the `team-protocol` skill.

The diff it reviews is hypothetical, and the document says so.

## How to run
```bash
mkdir -p /tmp/sec03 && cp *.mjs /tmp/sec03 && cd /tmp/sec03
node --test secretscan.test.mjs     # no dependencies
```

## Verified
Re-run on 2026-11-23 with Node v22.23.5, from a scratch copy outside the repo, after adding the Supabase rules (ADR-0006):

```
$ node --test secretscan.test.mjs
# fires  anthropic-key              -> sk-ant…(53 chars)
# fires  github-fine-grained-pat    -> github…(71 chars)
# fires  github-token               -> ghp_XN…(40 chars)
# fires  private-key                -> -----B…(31 chars)
# fires  supabase-secret-key        -> sb_sec…(42 chars)
# fires  jwt                        -> eyJ4yv…(141 chars)
# fires  aws-access-key-id          -> AKIAEE…(20 chars)
# fires  slack-token                -> xoxb-7…(29 chars)
# fires  netlify-env-assignment     -> ANTHRO…(42 chars)
# fires  high-entropy-near-keyword  -> nHDF/U…(48 chars)
# quiet  placeholder anthropic      -> 0 findings
# quiet  placeholder github         -> 0 findings
# quiet  env var name only          -> 0 findings
# quiet  git sha near 'token'       -> 0 findings (entropy 3.64)
# quiet  sha-256 hex near 'key'     -> 0 findings (entropy 3.84)
# quiet  long low-entropy run       -> 0 findings
# quiet  normal code                -> 0 findings
# quiet  base64 image, no keyword   -> 0 findings
# quiet  public key header          -> 0 findings
# quiet  service_role mentioned in docs -> 0 findings
# quiet  publishable placeholder    -> 0 findings
# quiet  repo path near 'token'     -> 0 findings
# quiet  truncated JWT in prose     -> 0 findings
ok 1 - every rule fires on its positive fixture, preview is redacted
ok 2 - negatives (placeholders, hashes, names) do not fire
ok 3 - findings never contain the full secret
ok 4 - scanProposal blocks on any file and reports path + line
# tests 4
# pass 4
# fail 0
```

Self-scan, re-run on 2026-11-23 with a throwaway script that calls `scanText` on every text file in `docs/`, `.claude/`, `knowledge/` and `CLAUDE.md` (327 files):
- The first re-run gave 24 findings. 16 were repo paths next to "token" or "key", which the entropy rule mistook for secrets. That would have blocked ordinary docs proposals, so the path-shaped exclusion was added. One was a label in this example's own test file; it was renamed.
- After the fixes: **6 findings, none of them real secrets.**
  - 4 are literal placeholders in netlify-engineer's `examples/04-sw-version-stamp/test/` (a fake `sb_secret_EXAMPLE…` and fake env assignments). They are correct to fire. The fix belongs in those tests: build the fixtures at runtime, as this example does. We do not add an "EXAMPLE" exemption, because an attacker could simply append the word.
  - 2 are base64 data inside software-architect's C4 SVGs. These are the realistic false-positive load. The scanner must report findings, with the path, for a human to judge; it must never silently drop files.

The sample review is prose, so there was nothing to execute. Its referenced helpers (`checkProposal`, `scanProposal`, `checkStepUp`, `checkOrigin`, the mock GitHub) all exist in the examples and were run (examples 01–03, and agent-console-engineer's mock GitHub).

## Limits
- **Regex scanning is a tripwire, not a guarantee.** A secret that is split, encoded or low-entropy will pass. The real controls are that secrets never enter prompts (the model can't leak what it never saw), human review of the diff, and GitHub push protection behind us.
- **The entropy threshold of 4.2 is a judgment call.** A random 40–60 character base64 token scores about 5–5.6 (a string of n characters can never score above log2(n)), and hex can never exceed 4.0. Tune it with real false-positive reports, not by guessing.
- **The scan runs on proposal content only.** Agent chat output shown in the browser is a separate path. It is rendered as text, and secrets are never in the model's context.
