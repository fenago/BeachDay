import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import { scoreHour, scoreDay } from "../src/score.js";
import { getForecast, clearCache, FORECAST_URL } from "../src/forecast.js";

// Real response captured 2026-11-23 (Miami Beach) — see README.
const fixture = JSON.parse(readFileSync(new URL("../fixtures/forecast-miami-beach-2026-11-23.json", import.meta.url)));

let calls = 0;
const server = setupServer(
  // Match on origin + path; MSW ignores the query string when matching.
  http.get("https://api.open-meteo.com/v1/forecast", () => {
    calls++;
    return HttpResponse.json(fixture);
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" })); // any unmocked request fails the test
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  calls = 0;
  clearCache();
});

describe("scoreHour boundaries", () => {
  const calm = { weather_code: 0, wind_speed_10m: 5, wind_gusts_10m: 8, precipitation_probability: 0, cloud_cover: 10, apparent_temperature: 84 };
  it.each([
    [{ weather_code: 94 }, 100],
    [{ weather_code: 95 }, 0],
    [{ wind_speed_10m: 12 }, 100],
    [{ wind_speed_10m: 13 }, 90],
    [{ wind_gusts_10m: 31.9 }, 100],
    [{ wind_gusts_10m: 32 }, 0],
    [{ precipitation_probability: 20 }, 100],
    [{ precipitation_probability: 21 }, 90],
    [{ apparent_temperature: 78 }, 100],
    [{ apparent_temperature: 77.9 }, 90],
  ])("%o -> %i", (patch, score) => {
    expect(scoreHour({ ...calm, ...patch }).score).toBe(score);
  });
});

describe("forecast -> verdict (MSW)", () => {
  it("scores the real fixture (inline snapshot)", async () => {
    const day = scoreDay(await getForecast());
    expect(day).toMatchInlineSnapshot(`
      {
        "bestWindow": {
          "end": "13:00",
          "start": "10:00",
        },
        "date": "2026-11-23",
        "reasons": [
          "Partly cloudy",
          "A bit cool",
        ],
        "score": 95,
        "verdict": "Great beach day",
      }
    `);
    expect(calls).toBe(1);
  });

  it("thunderstorm all afternoon changes the verdict", async () => {
    const stormy = structuredClone(fixture);
    for (let i = 8; i <= 17; i++) stormy.hourly.weather_code[i] = 95;
    server.use(http.get("https://api.open-meteo.com/v1/forecast", () => HttpResponse.json(stormy))); // per-test override
    const day = scoreDay(await getForecast());
    expect(day.verdict).toBe("Skip it");
    expect(day.reasons).toContain("Thunderstorms");
  });

  it("surfaces Open-Meteo's 400 reason", async () => {
    server.use(
      http.get("https://api.open-meteo.com/v1/forecast", () =>
        HttpResponse.json({ error: true, reason: "Cannot initialize WeatherVariable from invalid String value" }, { status: 400 }),
      ),
    );
    await expect(getForecast()).rejects.toThrow("Open-Meteo: Cannot initialize WeatherVariable");
  });
});

describe("30-minute cache (fake timers)", () => {
  // Only Date matters for the cache; faking just Date keeps fetch, MSW and
  // AbortSignal.timeout on real timers (plain vi.useFakeTimers() also passed here).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T10:00:00-05:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("reuses data for 30 min, then refetches", async () => {
    await getForecast();
    vi.setSystemTime(new Date("2026-11-23T10:29:59-05:00"));
    await getForecast();
    expect(calls).toBe(1);
    vi.setSystemTime(new Date("2026-11-23T10:30:00-05:00"));
    await getForecast();
    expect(calls).toBe(2);
    expect(FORECAST_URL).toContain("timezone=America/New_York");
  });
});
