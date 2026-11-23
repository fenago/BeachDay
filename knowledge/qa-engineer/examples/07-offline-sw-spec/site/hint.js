// Stand-in for the iPhone install hint with the 14-day snooze (docs/02 §3). The product's logic is the thing under test in the real repo.
const SNOOZE_MS = 14 * 24 * 3600_000;
const ios = /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone && !matchMedia("(display-mode: standalone)").matches;
const until = Number(localStorage.getItem("hintSnoozedAt") ?? 0);
if (ios && Date.now() - until >= SNOOZE_MS) document.getElementById("hint").hidden = false;
document.getElementById("dismiss").addEventListener("click", () => { localStorage.setItem("hintSnoozedAt", String(Date.now())); document.getElementById("hint").hidden = true; });
