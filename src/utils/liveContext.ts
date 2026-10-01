import { useMemo, useSyncExternalStore } from "react";
import type { ContextSnapshot } from "../../scripts/context-advice.mjs";

const POLL_MS = 5_000;
/** Snapshots only refresh with activity; older ones are not shown (the cache is long gone). */
export const SNAPSHOT_FRESH_MS = 6 * 3_600_000;

const EMPTY: ContextSnapshot[] = [];
let snaps: ContextSnapshot[] = EMPTY;
let raw = "";
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function load() {
  fetch("/api/live-context", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : []))
    .then((d: unknown) => {
      const now = Date.now();
      const fresh = Array.isArray(d) ? (d as ContextSnapshot[]).filter((s) => now - s.capturedAt < SNAPSHOT_FRESH_MS) : [];
      const text = JSON.stringify(fresh);
      if (text === raw) return;
      raw = text;
      snaps = fresh.length > 0 ? fresh : EMPTY;
      listeners.forEach((l) => l());
    })
    .catch(() => { /* static export: no API */ });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (listeners.size === 1) {
    load();
    timer = setInterval(load, POLL_MS);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) clearInterval(timer);
  };
}

/** Per-session context / prompt-cache snapshots from the status line wrapper, newest first. One shared poll. */
export function useLiveContext(): ContextSnapshot[] {
  return useSyncExternalStore(subscribe, () => snaps, () => EMPTY);
}

/** Fresh snapshots by session id. */
export function useSnapshotMap(): Map<string, ContextSnapshot> {
  const list = useLiveContext();
  return useMemo(() => new Map(list.map((s) => [s.sessionId, s])), [list]);
}
