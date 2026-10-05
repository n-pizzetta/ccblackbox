import { useState } from "react";

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Heaviest first, without reshuffling on every poll. Starting from the order
 * shown last time (`shown`, as keys), a row only moves above the one before it
 * when it outweighs it by more than `margin`; rows not shown yet join by
 * weight, then key, so equal weights always come out in the same order.
 * Ranking again with its own result as `shown` returns the same order.
 */
export function stickyRank<T>(
  rows: readonly T[],
  key: (r: T) => string,
  weight: (r: T) => number,
  shown: readonly string[] = [],
  margin = 0,
): T[] {
  const left = new Map(rows.map((r) => [key(r), r]));
  const out: T[] = [];
  for (const k of shown) {
    const r = left.get(k);
    if (r === undefined) continue;
    out.push(r);
    left.delete(k);
  }
  out.push(...[...left.values()].sort((a, b) => weight(b) - weight(a) || byKey(key(a), key(b))));
  // Bubble the clearly heavier rows up; each swap lowers sum(position * weight), so it ends.
  for (let swapped = true; swapped; ) {
    swapped = false;
    for (let i = 1; i < out.length; i++) {
      if (weight(out[i]) - weight(out[i - 1]) > margin) {
        [out[i - 1], out[i]] = [out[i], out[i - 1]];
        swapped = true;
      }
    }
  }
  return out;
}

/** `stickyRank` against the order this component rendered last time. */
export function useStickyRank<T>(rows: readonly T[], key: (r: T) => string, weight: (r: T) => number, margin = 0): T[] {
  const [shown, setShown] = useState<readonly string[]>([]);
  const ranked = stickyRank(rows, key, weight, shown, margin);
  const keys = ranked.map(key);
  // Render-time update (React re-renders before committing); stable because ranking is idempotent.
  if (keys.length !== shown.length || keys.some((k, i) => k !== shown[i])) setShown(keys);
  return ranked;
}
