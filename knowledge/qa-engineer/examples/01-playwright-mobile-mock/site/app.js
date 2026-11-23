// Minimal Beach Day page: the BROWSER calls Open-Meteo directly (ADR-0001).
import { scoreDay } from "./score.js";

const URL_FORECAST =
  "https://api.open-meteo.com/v1/forecast?latitude=25.781&longitude=-80.130" +
  "&hourly=apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,cloud_cover" +
  "&daily=sunrise,sunset&timezone=America/New_York&forecast_days=1&temperature_unit=fahrenheit&wind_speed_unit=mph";

const $ = (id) => document.getElementById(id);

async function main() {
  try {
    const res = await fetch(URL_FORECAST, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const day = scoreDay(await res.json());
    $("verdict").textContent = `${day.verdict} (${day.score}/100)`;
    $("window").textContent = day.bestWindow ? `Best time: ${day.bestWindow.start}–${day.bestWindow.end}` : "";
    for (const r of day.reasons) {
      const li = document.createElement("li");
      li.textContent = r; // textContent, never innerHTML, for API data
      $("reasons").append(li);
    }
  } catch {
    $("verdict").textContent = "Forecast unavailable — try again later.";
  }
}
main();
