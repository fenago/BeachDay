// localStorage wrapper: every read/write is guarded (private mode, iOS eviction). Values are disposable.
export const KEYS = Object.freeze({ beach: "beachday:beach", favorites: "beachday:favorites", visits: "beachday:visits" });

export function read(key, win = window) { try { return win.localStorage.getItem(key); } catch { return null; } }
export function write(key, value, win = window) { try { win.localStorage.setItem(key, String(value)); return true; } catch { return false; } }

export function readFavorites(win = window) {
  try {
    const v = JSON.parse(read(KEYS.favorites, win) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
export function writeFavorites(list, win = window) { write(KEYS.favorites, JSON.stringify(list), win); }

/** Count this page load as a visit; returns the new total. */
export function countVisit(win = window) {
  const n = (Number(read(KEYS.visits, win)) || 0) + 1;
  write(KEYS.visits, Math.min(n, 99), win);
  return n;
}
