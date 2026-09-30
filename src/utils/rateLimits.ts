import { useEffect, useState } from "react";
import { FIVE_HOUR_MS } from "./fleetStats";
import { loadWindowStart } from "./windowState";

/** One Claude usage-limit window, as reported by Claude Code (`/usage`). */
export type LimitWindow = { usedPct: number; resetsAt: number | null };

/** Recorded by scripts/statusline.mjs; null until the status line is installed. */
export type RateLimits = {
  capturedAt: number | null;
  fiveHour: LimitWindow | null;
  sevenDay: LimitWindow | null;
};

const POLL_MS = 5_000;

export function useRateLimits(): RateLimits | null {
  const [limits, setLimits] = useState<RateLimits | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/limits", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled) setLimits(d && typeof d === "object" ? d : null); })
        .catch(() => { /* static export: no API */ });
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return limits;
}

/** Exact 5h window start when the real reset time is known, else the locally inferred anchor. */
export function windowStartFrom(limits: RateLimits | null): number | null {
  const resetsAt = limits?.fiveHour?.resetsAt;
  return resetsAt ? resetsAt - FIVE_HOUR_MS : loadWindowStart();
}

/** `frac` is 0..1. */
export function limitColor(frac: number): string {
  if (frac >= 0.95) return "var(--c-red)";
  if (frac >= 0.8) return "var(--c-amber)";
  if (frac >= 0.5) return "var(--c-cyan)";
  return "var(--c-green)";
}
