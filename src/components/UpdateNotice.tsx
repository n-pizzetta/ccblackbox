import { useEffect, useState } from "react";

interface Update {
  current: string;
  latest: string;
}

/** Re-asks the server every few hours; the server itself checks GitHub at most once a day. */
const POLL_MS = 3 * 3600_000;

/** "↑ 0.6.0" in the header while a newer Marey is published (GET /api/update, scripts/update-check.mjs). */
export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/update", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled) setUpdate(d?.update ?? null); })
        .catch(() => { /* static export: no API */ });
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  if (!update) return null;
  return (
    <span
      className="update-notice mono tabular"
      title={`Marey ${update.latest} is available (you have ${update.current}). Run /marey:update in Claude Code, or git pull if you run Marey from source.`}
    >
      ↑ {update.latest}
    </span>
  );
}
