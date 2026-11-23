// Browser-side Open-Meteo client (ADR-0001: the browser calls Open-Meteo).
// Caches per URL and refreshes at most every 30 minutes; never polls.
export const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=25.781&longitude=-80.130" +
  "&hourly=apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,cloud_cover" +
  "&daily=sunrise,sunset&timezone=America/New_York&forecast_days=1&temperature_unit=fahrenheit&wind_speed_unit=mph";

const MAX_AGE_MS = 30 * 60 * 1000;
const cache = new Map(); // url -> { at, data }

export function clearCache() {
  cache.clear();
}

export async function getForecast(url = FORECAST_URL) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.data;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    // Open-Meteo errors: 400 {"error":true,"reason":"..."}; keep the reason, not the body
    const reason = (await res.json().catch(() => ({}))).reason ?? `HTTP ${res.status}`;
    throw new Error(`Open-Meteo: ${reason}`);
  }
  const data = await res.json();
  if (!Array.isArray(data?.hourly?.time) || !Array.isArray(data?.daily?.sunrise)) {
    throw new Error("Open-Meteo: unexpected response shape");
  }
  cache.set(url, { at: Date.now(), data });
  return data;
}
