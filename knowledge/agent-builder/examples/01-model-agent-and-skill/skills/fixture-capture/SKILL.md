---
name: fixture-capture
description: Fixture capture rules for Beach Day — how to save real Open-Meteo Forecast and Marine responses as test fixtures, name them, record provenance and keep them small. Use when adding or refreshing anything in tests/fixtures/openmeteo/.
---
# Capturing Open-Meteo fixtures

## Rules that always apply
- One scenario per file, named `<api>-<scenario>.json`, for example `forecast-thunderstorm-pm.json` or `marine-rough-seas.json`.
- Save the **unmodified** response body. If a test needs an edge case real data doesn't show, copy the file to `<name>.edited.json` and say what changed in the README row.
- Use exactly the request parameters from the `open-meteo-apis` skill (units, `timezone=America/New_York`, explicit `forecast_days`). Fixtures must match what the app really requests.
- Never put keys, cookies or personal data in a fixture or its README. Open-Meteo is keyless, so a fixture should contain no secrets at all.

## Steps
1. Build the request URL from the beach's coordinates (marine point for Marine).
2. Fetch it from wherever network access exists. The sandbox can't reach `api.open-meteo.com`; in that case ask the orchestrator for a fetched copy.
3. Check the shape: every `hourly` array has the same length as `hourly.time`.
4. Save the file, then add a row to `tests/fixtures/openmeteo/README.md`: file, URL, capture date, beach, scenario.
5. Run the tests that use it and quote the command and counts in your HANDOFF.

## More detail
- Field-by-field shape checks and the scenario list: [reference.md](reference.md). Read it when a shape check fails or you need the full scenario list.
