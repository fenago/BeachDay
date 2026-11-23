# Vitest: MSW request mocking, fake timers and snapshots
Source: https://vitest.dev/guide/mocking/requests , https://vitest.dev/guide/mocking/timers , https://vitest.dev/api/vi , https://vitest.dev/guide/snapshot
Retrieved: 2026-11-23

## Mocking HTTP with MSW
- Vitest recommends **Mock Service Worker (MSW)**. It intercepts requests without changing application code, and covers HTTP, WebSocket and GraphQL. [mocking requests](https://vitest.dev/guide/mocking/requests)
```js
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
const server = setupServer(
  http.get("https://rest-endpoint.example/path/to/posts", () => HttpResponse.json(posts)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
```
[mocking requests](https://vitest.dev/guide/mocking/requests)
- `server.use(handler)` adds a per-test override, and `resetHandlers()` removes it after the test. This was used and verified in example 03 with `msw@3.0.7`, where `msw` exports `http` and `HttpResponse` and `msw/node` exports `setupServer`.
- **Query strings:** a handler for `https://api.open-meteo.com/v1/forecast` matched requests that carried a full query string. Matching was by path in this run. Read query parameters inside the handler from `new URL(request.url).searchParams`.
- `onUnhandledRequest: "error"` makes any unmocked request an error, so a test can't hit a real API by accident.

## Fake timers
Source for every bullet: [vi API](https://vitest.dev/api/vi)
- `vi.useFakeTimers(config?)` wraps `setTimeout`, `setInterval`, the matching `clear*` functions, `setImmediate`, `clearImmediate` and `Date`, until `vi.useRealTimers()` is called.
- It does **not** mock `process.nextTick` or `queueMicrotask` unless you pass `toFake: ['nextTick', 'queueMicrotask']`.
- `toFake` and `toNotFake` choose which timers are faked. They can't be combined.
- Mocking `nextTick` is not supported with `--pool=forks`.
- **`vi.setSystemTime(date)`:**
  - With fake timers on, it changes the clock for `Date`, `hrtime` and `performance.now` "however, it will not fire any timers".
  - Without fake timers, it mocks only `Date.*` (and `Temporal.Now.*`).
- **Moving time forward:** `vi.advanceTimersByTime(ms)`, `vi.advanceTimersToNextTimer()`, `vi.runAllTimers()` and the async variants. [timers guide](https://vitest.dev/guide/mocking/timers), [vi API](https://vitest.dev/api/vi)
- `vi.useRealTimers()` discards all timers that were scheduled while faked.
- `vi.setTimerTickMode('manual' | 'nextTimerAsync' | 'interval')` is available from Vitest 4.1.0. `manual` is the default.

## Snapshots
Source for every bullet: [snapshot](https://vitest.dev/guide/snapshot)
- `toMatchSnapshot()` writes to `__snapshots__/<file>.snap`.
- `toMatchInlineSnapshot()` **rewrites the test file** to hold the snapshot string.
- `toMatchFileSnapshot(path)` compares against a file you choose, and is async. Don't point it at a path Vitest already manages.
- **Updating:** run `vitest -u` (`--update`), or press `u` in watch mode.
- **CI:** "By default, Vitest does not write snapshots in CI (`process.env.CI` is truthy) and any snapshot mismatches, missing snapshots, and obsolete snapshots fail the run."
- Vitest's `printBasicPrototype` defaults to `false`, so output reads `{...}` and `[...]` rather than `Object {...}`.
- Browser mode adds `toMatchScreenshot()` and ARIA snapshots (`toMatchAriaInlineSnapshot`, experimental from 4.1.4). They aren't used in our Node-environment unit tests.

## Beach Day notes
- **Scoring tests** (`tests/unit/score.test.js`):
  - Use `it.each` boundary rows at **every** threshold in `score-config.js`, on both sides. Example 03 does code 94/95, wind 12/13, gust 31.9/32, rain 20/21 and feels-like 77.9/78.
  - Add an **inline snapshot** of `scoreDay` for each real fixture, so a reviewer sees the verdict and reasons in the diff.
- **Fixtures:**
  - Save real Open-Meteo responses in `tests/fixtures/openmeteo/`.
  - In this sandbox the API is only reachable through the Firecrawl scrape tool. Save the JSON verbatim and note it in the README.
  - The calm-day fixture from 2026-11-23 scores 95 ("Great beach day").
- **Clock:**
  - `vi.useFakeTimers({ toFake: ["Date"] })` plus `vi.setSystemTime(new Date("2026-07-04T12:00:00-04:00"))` freezes "now" for cache and "today" logic.
  - Restore it with `vi.useRealTimers()` in `afterEach`.
  - Faking all timers also passed with MSW in example 03, but faking only `Date` keeps `AbortSignal.timeout` and fetch on real timers.
- **Function tests:**
  - Use MSW for `api.anthropic.com` and `api.github.com`, with `onUnhandledRequest: "error"`.
  - Use fake keys (`sk-ant-EXAMPLE`, `github_pat_EXAMPLE`).
  - Assert that response bodies never contain the env values.
  - Call handlers directly: `handler(new Request(...), fakeContext)`. See knowledge/netlify-engineer example 01.
- **In CI**, set `CI=true` so missing snapshots fail instead of being written silently.
