import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "../types";
import { formatDuration, formatRelative, outcomeColor } from "../utils/format";

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
}

const ROW_HEIGHT = 62;
const OVERSCAN = 8;

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
}: Props) {
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = sessions.findIndex((s) => s.id === selectedId);
    if (idx < 0) return;
    const rowTop = idx * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop || rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: rowTop - el.clientHeight / 3, behavior: "smooth" });
    }
  }, [selectedId, sessions]);

  const total = sessions.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const offsetTop = startIdx * ROW_HEIGHT;
  const visible = sessions.slice(startIdx, endIdx);

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
      {compareMode && ghostsFocused && (
        <BulkGhostBar
          sessions={sessions}
          compareIds={compareIds}
          onToggleCompare={onToggleCompare}
          onBulkDelete={onBulkDelete}
        />
      )}
      <div className="list-scroll scrollbar" ref={scrollRef}>
        {total === 0 ? (
          <div className="list-empty mono dim">
            {search ? `No sessions matching "${search}"` : "No sessions in this view"}
          </div>
        ) : (
          <div className="list-inner" style={{ height: total * ROW_HEIGHT }}>
            <div style={{ transform: `translateY(${offsetTop}px)` }}>
              {visible.map((s, i) => {
                const absoluteIdx = startIdx + i;
                const c = outcomeColor(s.outcome);
                const checked = compareIds.has(s.id);
                return (
                  <div
                    key={s.id}
                    className={`session-row ${selectedId === s.id ? "selected" : ""} ${compareMode ? "compare-mode" : ""} ${compareMode && checked ? "compare-checked" : ""}`}
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
                        ) : (
                          <span className="row-glyph outcome-dot" title={s.outcome.replace(/_/g, " ")} />
                        )}
                        {s.goal}
                      </div>
                      <div className="sub">
                        <span>{s.project}</span>
                        <span>·</span>
                        <span>{formatDuration(s.durationMs)}</span>
                        <span>·</span>
                        <span>{formatRelative(s.startedAt)}</span>
                      </div>
                    </div>
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
