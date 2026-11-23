// Page side of the service-worker example: register after load, safe update toast, forecast fetch.
const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=25.781&longitude=-80.13&daily=sunrise,sunset&timezone=America%2FNew_York&forecast_days=1";

const $ = (sel) => document.querySelector(sel);
const fmt = (ms) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(ms));

export async function loadForecast() {
  const status = $("#status");
  try {
    const res = await fetch(FORECAST_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const fetchedAt = Number(res.headers.get("x-bd-fetched-at")) || Date.now();
    const fromCache = res.headers.get("x-bd-source") === "cache";
    $("#sunrise").textContent = `Sunrise ${data.daily.sunrise[0].slice(11)}`;
    status.textContent = fromCache
      ? `${navigator.onLine ? "Network slow" : "Offline"} — showing data from ${fmt(fetchedAt)}`
      : `Updated ${fmt(fetchedAt)}`;
    return { ok: true, fromCache, fetchedAt };
  } catch (e) {
    status.textContent = "Offline — no saved forecast yet";
    return { ok: false, error: String(e) };
  }
}

// --- Service worker registration and the safe update flow ---
function showUpdateToast(reg) {
  const toast = $("#update-toast");
  toast.hidden = false;
  $("#update-refresh").onclick = () => reg.waiting?.postMessage({ type: "SKIP_WAITING" });
}

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      // "installed" + an existing controller = an update is waiting (not the first install).
      if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateToast(reg);
    });
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return; // reload exactly once
    reloaded = true;
    location.reload();
  });
  return reg;
}

window.__bd = { loadForecast, registerSW };
window.addEventListener("load", async () => {
  await registerSW();
  await loadForecast();
});
