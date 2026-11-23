# Example 02: Interface contracts as JSON Schema, validated with Ajv

## What it demonstrates

Four contracts that builders can code against in parallel. All are JSON Schema 2020-12:

| Schema | Producer → consumer | Key rules encoded |
|---|---|---|
| `schemas/forecast-hour.schema.json` | `api/openmeteo.js` normalizer → `score.js` | Fixed units (°F, mph, inch, ft). WMO code 0–99. Marine fields are **present but `null`** when missing, never absent or guessed. SST already converted to °F |
| `schemas/day-verdict.schema.json` | `scoreDay()` → UI | Verdict **key** (`great/good/fair/skip`), not display text. Score bands tied to the verdict with `if/then` (80–100, 65–79, 45–64, 0–44). ≤4 reasons. `confidence: forecast \| outlook`. `marineAvailable: false` requires the reason "Wave data unavailable" |
| `schemas/sse-event.schema.json` | `/api/chat` function → Console UI | `oneOf` union of the six docs/04 §2.1 event types: `text`, `tool`, `proposal`, `handoff`, `error`, `done`. `additionalProperties: false` everywhere, so an error can't leak a `stack`. Tool names are limited to the Console's three tools. ≤20 files, ≤200 KB each. `error.code` includes `unauthorized` (401) and `forbidden` (403, not `super_admin`). IDs `p_`/`j_` + 26-char ULID |
| `schemas/proposal.schema.json` | `propose_change` → Blobs → approve | ID `^p_[0-9A-Z]{26}$`. Status enum `pending/committing/committed/failed/stale/rejected` (docs/04 §2.1). 40-hex SHAs, `sha256:` content hash, `decidedBy` = Supabase user id. Path shape mirrors the **canonical list** in docs/04 §6: ALLOW `public/**` text types, `tests/**`, `docs/**`, `.claude/agents/*.md`, `.claude/skills/**/*.md`; DENY wins: `public/_headers`, `public/_redirects`, `public/sw.js`, `public/sw/**`, `public/vendor/**`, `public/generated/**`, `public/version.json`, `..`, `.env*`, `*.pem`, `*.key`. `committed` requires `commitSha` + `decidedAt`; `failed`/`stale` require `error`; only `committed` may carry `commitSha` |

`validate.mjs` performs four checks:

1. Compiles every schema in Ajv **strict** mode.
2. Runs 25 valid and invalid samples in `samples/`, asserting each outcome.
3. Normalizes a **real Open-Meteo Forecast response** (`fixtures/forecast-miami-beach-2026-11-23.json`) into 24 `ForecastHour`s and validates them.
4. Serializes four SSE events to the wire format, parses them back with the client parser from `docs/04-sse-and-streams.md`, and validates each one.

## Why this is "what good looks like"

- **Contracts carry the decisions.** The verdict bands, "missing marine → say so", the allow-list shape and "no secrets in errors" are machine-checked, not just written in prose. Two builders can work in parallel and meet at the schema.
- **Keys, not copy.** The verdict is a key; UX owns the display text. A wording change doesn't break the data contract, while the scoring/wording review gate still applies.
- **The schemas are one defence layer, not the only one.** Schema descriptions say so: the server allow-list (`allowlist.mts`, normalise then DENY-wins) and the secret scan stay authoritative at approve time (ADR-0003/0005).
- **Real data, not invented data.** The fixture is an actual API response, which proves the normalizer's field names and units (`°F`, `mp/h`, `inch`) match Open-Meteo.
- **Dependency-light:** two dev dependencies (`ajv`, `ajv-formats`). Production code could ship the same schemas to the function (input validation) and to tests.

## How to run

```bash
# install deps OUTSIDE the repo, then point Node at them (or npm i here; never commit node_modules)
cd /tmp/scratch && npm i ajv@8 ajv-formats@3
cp -r <repo>/knowledge/software-architect/examples/02-interface-contracts /tmp/scratch/contracts
ln -s /tmp/scratch/node_modules /tmp/scratch/contracts/node_modules
cd /tmp/scratch/contracts && node validate.mjs
```

## Verified

**Re-run 2026-11-23 after ADR-0006/0007 and the canonical list** (Node v22.23.5, ajv 8.20.0, ajv-formats 3.0.1). Changes: IDs `p_`/`j_` + ULID; statuses `committing` and `failed` added; `forbidden` error code; `_headers` sample flipped to invalid; new deny samples for `sw.js`, `public/sw/**`, `public/vendor/**`, `public/generated/**`, `public/version.json`, `_redirects` and `.claude/settings.json`; old `prop_`/`job_` prefixes now rejected. 39 sample checks plus the fixture and SSE round trip:

```
PASS  proposal#7 expect=invalid got=invalid — public/_headers is deny-listed (canonical list, Dr. Lee decision 7)
PASS  proposal#9 expect=invalid got=invalid — files sw.js imports live under public/sw/** and are deny-listed [/files/0/path must NOT be valid]
PASS  proposal#11 expect=invalid got=invalid — build output is deny-listed (ADR-0006) [/files/0/path must NOT be valid]
PASS  proposal#14 expect=valid got=valid — console UI is allowed until Dr. Lee rules on the open deny recommendation
PASS  proposal#15 expect=invalid got=invalid — old prop_ prefix is no longer valid [/id must match pattern "^p_[0-9A-Z]{26}$"]
PASS  proposal#17 expect=invalid got=invalid — stale without error [/ must have required property 'error'; ...]
PASS  proposal#18 expect=invalid got=invalid — committing must not carry commitSha yet [...]
PASS  proposal#19 expect=invalid got=invalid — public/version.json is build output and deny-listed [/files/0/path must NOT be valid]
PASS  sse-event#10 expect=valid got=valid — forbidden: signed in but not super_admin (ADR-0006)
PASS  sse-event#11 expect=invalid got=invalid — old job_ prefix [...]
... (39 sample checks, all PASS)
PASS  real fixture: units ok, 24 hours normalized, 24 valid ForecastHour (marine null: no marine fixture)
PASS  SSE round trip: 438 bytes on the wire → 4 events, all valid, ends with done

ALL CONTRACT CHECKS PASSED
exit=0
```

The `public/sw/**` and `public/generated/**` samples match the ALLOW pattern and are rejected only by the `not` (deny) clauses, which proves deny-wins in the schema.

**Original run** (before ADR-0006):

Run on 2026-11-23, Node v22.23.5, ajv 8.20.0, ajv-formats 3.0.1 (installed in a scratch directory outside the repo):

```
compiled  day-verdict.schema.json
compiled  forecast-hour.schema.json
compiled  proposal.schema.json
compiled  sse-event.schema.json
PASS  day-verdict#0 expect=valid got=valid — great day, marine present
PASS  day-verdict#2 expect=invalid got=invalid — verdict great but score 70 (band is 80-100) [/score must be >= 80; / must match "then" schema]
PASS  day-verdict#3 expect=invalid got=invalid — marine missing but no 'Wave data unavailable' reason (must say so, never guess) [...]
PASS  forecast-hour#1 expect=invalid got=invalid — SST kept in °C under an extra key waterTempC (must be converted to °F as waterTempF) [/ must NOT have additional properties]
PASS  proposal#2 expect=invalid got=invalid — denied path netlify/functions/approve.mts [/files/0/path must match pattern ...]
PASS  proposal#3 expect=invalid got=invalid — path traversal public/../netlify.toml [/files/0/path must NOT be valid]
PASS  proposal#4 expect=invalid got=invalid — committed without commitSha [/ must have required property 'commitSha'; ...]
PASS  sse-event#7 expect=invalid got=invalid — error leaks extra field (stack) - additionalProperties false [...]
PASS  proposal#6 expect=invalid got=invalid — binary image under public/ (png was removed from the docs/04 allow-list; text files only) [...]
... (25 sample checks, all PASS)
PASS  real fixture: units ok, 24 hours normalized, 24 valid ForecastHour (marine null: no marine fixture)
PASS  SSE round trip: 425 bytes on the wire → 4 events, all valid, ends with done

ALL CONTRACT CHECKS PASSED
exit=0
```

Two strict-mode errors were found and fixed on the way: missing `type` next to `minimum` in `if/then` branches, and `required` without a sibling `properties`. Ajv's strict mode is worth keeping on.

**Fixture provenance:** `api.open-meteo.com` isn't reachable from the sandbox shell, so the response was fetched with the Firecrawl scrape tool on 2026-11-23. The URL was `https://api.open-meteo.com/v1/forecast?latitude=25.781&longitude=-80.130&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,cape,is_day&timezone=America/New_York&forecast_days=1&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`, with `maxAge: 0` for a live fetch. The body was saved unmodified. No Marine fixture was captured, so marine fields normalize to `null`.

**Contract choices:** the ID prefixes, status set, SSE `error.code` list and `done.stopReason` list are now adopted in docs/04 §2.1. The `confidence` value `forecast` is still this example's own; confirm it with open-meteo-integrator.
