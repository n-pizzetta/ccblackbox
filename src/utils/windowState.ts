const KEY = "marey:window-start";

export function loadWindowStart(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveWindowStart(ms: number | null): void {
  try {
    if (ms === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(ms));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("marey:window-changed"));
}
