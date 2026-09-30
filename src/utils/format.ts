export function formatBytes(n: number): string {
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kb`;
  return `${(n / 1024 / 1024).toFixed(1)} mb`;
}

const CLOCK_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const CLOCK_FMT_SHORT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatClockAt(
  startedAt: string | number,
  offsetMs: number,
  opts: { seconds?: boolean } = {},
): string {
  const base = typeof startedAt === "string" ? Date.parse(startedAt) : startedAt;
  const d = new Date(base + offsetMs);
  const fmt = opts.seconds === false ? CLOCK_FMT_SHORT : CLOCK_FMT;
  return fmt.format(d);
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 100_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function formatCost(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (usd >= 10) return `$${usd.toFixed(1)}`;
  return `$${usd.toFixed(2)}`;
}

/** Tooltip for costs that include models missing from the pricing table. */
export function estimateHint(models: Iterable<string>): string {
  return (
    `No pricing yet for ${[...models].join(", ")}: cost estimated from the latest model of the same family. ` +
    "Add the model to ~/.claude/ccblackbox/models.json to fix it."
  );
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function outcomeColor(outcome: string): string {
  switch (outcome) {
    case "fully_achieved":
      return "var(--c-green)";
    case "mostly_achieved":
      return "var(--c-cyan)";
    case "partially_achieved":
      return "var(--c-amber)";
    case "not_achieved":
      return "var(--c-red)";
    case "in_progress":
      return "var(--c-cyan)";
    case "unknown":
      return "var(--c-text-faint)";
    default:
      return "var(--c-text-dim)";
  }
}

export function outcomeLabel(outcome: string): string {
  if (outcome === "in_progress") return "in progress";
  if (outcome === "unknown") return "unknown";
  return outcome.replace(/_/g, " ");
}
