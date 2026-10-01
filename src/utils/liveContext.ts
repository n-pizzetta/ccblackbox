import { useEffect, useState } from "react";
import type { ContextSnapshot } from "../../scripts/context-advice.mjs";

const POLL_MS = 5_000;

/** Per-session context / prompt-cache snapshots from the status line wrapper, newest first. */
export function useLiveContext(): ContextSnapshot[] {
  const [snaps, setSnaps] = useState<ContextSnapshot[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/live-context", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => { if (!cancelled) setSnaps(Array.isArray(d) ? d : []); })
        .catch(() => { /* static export: no API */ });
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return snaps;
}
