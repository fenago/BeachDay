// Stand-in for the beach app: fetches Open-Meteo, shows the value, and says so when the service worker served it from cache.
const URL_ = "https://api.open-meteo.com/v1/forecast?latitude=25.781&longitude=-80.13&hourly=apparent_temperature&timezone=America%2FNew_York";
const out = document.getElementById("out"), banner = document.getElementById("banner");
try {
  const res = await fetch(URL_);
  const data = await res.json();
  out.textContent = `Feels like ${data.hourly.apparent_temperature[0]} °F`;
  if (res.headers.get("x-from-cache") === "1") { banner.hidden = false; banner.textContent = `Offline — showing data from ${res.headers.get("x-fetched-at")}`; }
} catch { out.textContent = "No data yet"; }
if ("serviceWorker" in navigator) {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  window.__reg = reg;
}
