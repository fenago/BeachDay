# Example 03: proposal secret scanner + a sample security review

## What it shows
### `secretscan.mjs`: the shape of `netlify/functions/lib/secretscan`
- **Rules.** It covers the patterns required by the `agent-console-security` skill:
  - `sk-ant-…` (20+ chars)
  - `github_pat_…`
  - `gh[pousr]_…`
  - `-----BEGIN … PRIVATE KEY-----`
  - a high-entropy token (≥ 40 chars, Shannon entropy ≥ 4.2 bits/char) on a line that mentions key, token, secret, password, bearer or auth

  It adds three extra rules:
  - AWS access key IDs
  - Slack tokens
  - assignments to our four secret env var names (`ANTHROPIC_API_KEY=…` and the others)
- **Redacted findings.** A finding shows at most 6 characters and the length, so findings are safe to log, store in the proposal record and show in the UI. That follows the OWASP Logging cheat sheet (never log access tokens).
- **Whole-proposal scan.** `scanProposal` scans each file's **path and content**. Any finding blocks the proposal. It runs at propose time **and** at approve time.
- **Placeholders stay quiet.** The short placeholders `sk-ant-EXAMPLE` and `github_pat_EXAMPLE` do not fire, because they are below the length thresholds. That is how `secure-by-design` says the scanner should treat placeholders.
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
Run on 2026-11-23 with Node v22.23.5, from a scratch copy outside the repo:

```
$ node --test secretscan.test.mjs
# fires  anthropic-key              -> sk-ant…(53 chars)
# fires  github-fine-grained-pat    -> github…(71 chars)
# fires  github-token               -> ghp_XN…(40 chars)
# fires  private-key                -> -----B…(31 chars)
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
ok 1 - every rule fires on its positive fixture, preview is redacted
ok 2 - negatives (placeholders, hashes, names) do not fire
ok 3 - findings never contain the full secret
ok 4 - scanProposal blocks on any file and reports path + line
# tests 4
# pass 4
# fail 0
```

Self-scan of the whole `knowledge/` tree, run on 2026-11-23 with a throwaway script that calls `scanText` on every file:
- The first run flagged two of **our own** lines, both false positives, and both were fixed:
  - a doc table cell written as `CONSOLE_PASSWORD_HASH = scrypt$…`, caught by `netlify-env-assignment`;
  - a 41-character test secret next to the word "secret", caught by the entropy rule.
- After the fixes, `knowledge/security-engineer` and `knowledge/agent-console-engineer` scan clean: 17 and 22 files, 0 findings.
- It also flagged an env-var assignment in another agent's test fixture and long base64 data in two SVGs. Those belong to other agents and were left untouched. They show the realistic false-positive load: the scanner must report findings, with the path, for a human to judge. It must not silently drop files.

The sample review is prose, so there was nothing to execute. Its referenced helpers (`checkProposal`, `scanProposal`, `verifyCsrf`, `recentlyAuthenticated`, the mock GitHub) all exist in the examples and were run above.

## Limits
- **Regex scanning is a tripwire, not a guarantee.** A secret that is split, encoded or low-entropy will pass. The real controls are that secrets never enter prompts (the model can't leak what it never saw), human review of the diff, and GitHub push protection behind us.
- **The entropy threshold of 4.2 is a judgment call.** A random 40–60 character base64 token scores about 5–5.6 (a string of n characters can never score above log2(n)), and hex can never exceed 4.0. Tune it with real false-positive reports, not by guessing.
- **The scan runs on proposal content only.** Agent chat output shown in the browser is a separate path. It is rendered as text, and secrets are never in the model's context.
