// Marey was called ccblackbox: carry the saved view, unit, 5h window start and progress state
// over once. Imported first in main.tsx, before any module reads its key.
const LEGACY_PREFIX = "ccblackbox:";

try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(LEGACY_PREFIX)) continue;
    const next = `marey:${key.slice(LEGACY_PREFIX.length)}`;
    const value = localStorage.getItem(key);
    if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value);
    localStorage.removeItem(key);
  }
} catch {
  /* storage unavailable (private window): nothing to carry over */
}
