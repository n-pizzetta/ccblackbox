import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "../types";
import { formatCost, formatDuration, formatRelative, formatTokens, outcomeColor } from "../utils/format";
import { projectColor } from "../utils/fleetStats";
import { freshTokens, formatUsage, formatUsageAlt, useUnit } from "../utils/units";

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  compareMode: boolean;
  onToggleCompareMode: () => void;
  compareIds: Set<string>;
  onToggleCompare: (id: string) => void;
  onBulkDelete?: (ids: string[]) => Promise<void>;
  ghostsFocused?: boolean;
  /** Filter controls, rendered under the header. */
  filters?: ReactNode;
  /** Clicking a row's project pill filters on that project. */
  onProjectClick?: (project: string) => void;
}

const ROW_HEIGHT = 62;
const HEAD_HEIGHT = 34;
const OVERSCAN_PX = 8 * ROW_HEIGHT;

type Item =
  | { kind: "head"; key: string; label: string; count: number; cost: number; fresh: number; top: number }
  | { kind: "row"; s: Session; top: number };

const itemHeight = (it: Item) => (it.kind === "head" ? HEAD_HEIGHT : ROW_HEIGHT);

function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Flat, virtualizable list: a day header whenever the day changes, then that day's rows. */
function buildItems(sessions: Session[]): { items: Item[]; total: number } {
  const now = new Date();
  const groups: Array<{ label: string; rows: Session[] }> = [];
  for (const s of sessions) {
    const label = dayLabel(s.startedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(s);
    else groups.push({ label, rows: [s] });
  }
  const items: Item[] = [];
  let top = 0;
  for (const g of groups) {
    items.push({ kind: "head", key: `h-${g.label}-${top}`, label: g.label, count: g.rows.length, cost: g.rows.reduce((a, s) => a + s.costUsd, 0), fresh: g.rows.reduce((a, s) => a + freshTokens(s.tokens), 0), top });
    top += HEAD_HEIGHT;
    for (const s of g.rows) {
      items.push({ kind: "row", s, top });
      top += ROW_HEIGHT;
    }
  }
  return { items, total: top };
}

/** Index of the first item whose bottom edge is below `y`. */
function firstItemAt(items: Item[], y: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].top + itemHeight(items[mid]) <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  compareMode,
  onToggleCompareMode,
  compareIds,
  onToggleCompare,
  onBulkDelete,
  ghostsFocused,
  filters,
  onProjectClick,
}: Props) {
  const unit = useUnit();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const updateViewport = () => setViewport(el.clientHeight || 600);
    updateViewport();
    el.addEventListener("scroll", onScroll);
    const ro = new ResizeObserver(updateViewport);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  const { items, total } = useMemo(() => buildItems(sessions), [sessions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const item = items.find((it) => it.kind === "row" && it.s.id === selectedId);
    if (!item) return;
    const rowTop = item.top;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop || rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: rowTop - el.clientHeight / 3, behavior: "smooth" });
    }
  }, [selectedId, items]);

  const startIdx = firstItemAt(items, Math.max(0, scrollTop - OVERSCAN_PX));
  const endIdx = Math.min(items.length, firstItemAt(items, scrollTop + viewport + OVERSCAN_PX) + 1);
  const offsetTop = items[startIdx]?.top ?? 0;
  const visible = items.slice(startIdx, endIdx);

  return (
    <div className="list">
      <div className="list-header">
        <h2>Sessions</h2>
        <div className="list-header-right">
          <button
            className={`compare-toggle ${compareMode ? "active" : ""}`}
            onClick={onToggleCompareMode}
            title={compareMode ? "Exit compare mode" : "Compare / select multiple sessions"}
          >
            {compareMode ? `select (${compareIds.size})` : "select"}
          </button>
          <input
            className="list-search mono"
            type="text"
            placeholder="search…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>
      {filters}
      {compareMode && ghostsFocused && (
        <BulkGhostBar
          sessions={sessions}
          compareIds={compareIds}
          onToggleCompare={onToggleCompare}
          onBulkDelete={onBulkDelete}
        />
      )}
      <div className="list-scroll scrollbar" ref={scrollRef}>
        {sessions.length === 0 ? (
          <div className="list-empty mono dim">
            {search ? `No sessions matching "${search}"` : "No sessions in this view"}
          </div>
        ) : (
          <div className="list-inner" style={{ height: total }}>
            <div style={{ transform: `translateY(${offsetTop}px)` }}>
              {visible.map((it, i) => {
                if (it.kind === "head") {
                  return (
                    <div key={it.key} className="day-head" style={{ height: HEAD_HEIGHT }}>
                      <span className="day-head-label">{it.label}</span>
                      <span className="day-head-meta mono tabular">
                        {it.count} · {unit === "tokens" ? formatTokens(it.fresh) : formatCost(it.cost)}
                      </span>
                    </div>
                  );
                }
                const s = it.s;
                const absoluteIdx = startIdx + i;
                const c = s.live ? "var(--c-green)" : s.ghost ? "var(--c-text-ghost)" : outcomeColor(s.outcome);
                const checked = compareIds.has(s.id);
                return (
                  <div
                    key={s.id}
                    className={`session-row ${s.live ? "is-live" : ""} ${selectedId === s.id ? "selected" : ""} ${compareMode ? "compare-mode" : ""} ${compareMode && checked ? "compare-checked" : ""}`}
                    style={{
                      "--outcome-c": c,
                      height: ROW_HEIGHT,
                      animationDelay: `${Math.min(absoluteIdx, 15) * 20}ms`,
                    } as React.CSSProperties}
                    role="button"
                    tabIndex={0}
                    aria-pressed={compareMode ? checked : undefined}
                    aria-current={!compareMode && selectedId === s.id ? "true" : undefined}
                    onClick={() => compareMode ? onToggleCompare(s.id) : onSelect(s.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (compareMode) onToggleCompare(s.id);
                        else onSelect(s.id);
                      }
                    }}
                  >
                    {compareMode && (
                      <span
                        className={`compare-check ${checked ? "on" : ""}`}
                        aria-hidden="true"
                      >
                        {checked ? "✓" : ""}
                      </span>
                    )}
                    <div className="meta">
                      <div className="goal">
                        {s.live ? (
                          <span className="row-glyph glyph-live" title="Live session" />
                        ) : s.clearedInto ? (
                          <span className="row-glyph glyph-cleared" title="Context cleared — continues in next session">⟲</span>
                        ) : s.ghost ? (
                          <span className="row-glyph glyph-ghost" title="Ghost session — recovered from transcript" />
                        ) : null}
                        {s.goal}
                      </div>
                      <div className="sub">
                        <button
                          type="button"
                          tabIndex={-1}
                          className="proj-pill"
                          style={{ "--pc": projectColor(s.project) } as React.CSSProperties}
                          title={`Filter by ${s.project}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onProjectClick?.(s.project);
                          }}
                        >
                          {s.project}
                        </button>
                        <span>{formatDuration(s.durationMs)}</span>
                        <span>{formatRelative(s.startedAt)}</span>
                      </div>
                    </div>
                    <div className="row-side">
                      <span className={`row-primary mono tabular ${unit === "usd" ? "is-usd" : ""}`}>{formatUsage(unit, s.tokens, s.costUsd)}</span>
                      <div className="row-chips">
                      {s.pluginCapture && (
                        <div
                          className="plugin-chip"
                          title={`Captured by ccblackbox plugin — ${s.pluginCapture.entries} tool events`}
                        >
                          <span>◉</span>
                          <span className="tabular">{s.pluginCapture.entries}</span>
                        </div>
                      )}
                      {s.frictions.length > 0 && (
                        <div className="friction-chip">
                          <span>△</span>
                          <span className="tabular">{s.frictions.length}</span>
                        </div>
                      )}
                        <span className="row-tokens mono tabular">{formatUsageAlt(unit, s.tokens, s.costUsd)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BulkGhostBar({
  sessions,
  compareIds,
  onToggleCompare,
  onBulkDelete,
}: {
  sessions: Session[];
  compareIds: Set<string>;
  onToggleCompare: (id: string) => void;
  onBulkDelete?: (ids: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const emptyGhosts = sessions.filter((s) => s.ghost && s.ghostKind === "empty");
  const selected = Array.from(compareIds);
  const selectedInView = selected.filter((id) => sessions.some((s) => s.id === id));

  const selectEmpty = () => {
    for (const s of emptyGhosts) if (!compareIds.has(s.id)) onToggleCompare(s.id);
  };
  const selectAll = () => {
    for (const s of sessions) if (!compareIds.has(s.id)) onToggleCompare(s.id);
  };
  const clearAll = () => {
    for (const id of selected) if (sessions.some((s) => s.id === id)) onToggleCompare(id);
  };
  const bulkDelete = async () => {
    if (!onBulkDelete || selectedInView.length === 0) return;
    if (!confirm(`Delete ${selectedInView.length} ghost session(s) permanently?\n\nRemoves the transcript jsonl + any stale live file. Cannot be undone.`)) return;
    setBusy(true);
    try {
      await onBulkDelete(selectedInView);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bulk-bar mono">
      <span className="dim">bulk</span>
      <button className="bulk-btn" onClick={selectEmpty} disabled={emptyGhosts.length === 0}>
        select empty ({emptyGhosts.length})
      </button>
      <button className="bulk-btn" onClick={selectAll}>
        select all ({sessions.length})
      </button>
      <button className="bulk-btn" onClick={clearAll} disabled={selectedInView.length === 0}>
        clear
      </button>
      <button
        className="bulk-btn danger"
        onClick={bulkDelete}
        disabled={busy || selectedInView.length === 0}
      >
        {busy ? "deleting…" : `delete selected (${selectedInView.length})`}
      </button>
    </div>
  );
}
