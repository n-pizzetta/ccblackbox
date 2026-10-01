import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../types";
import { projectColor } from "../utils/fleetStats";

export type FilterId = "all" | "live" | "ghost" | "friction" | "failed" | "lowquality";

// `sessions` is the time-scoped (inRange) set. Counts are computed from this pre-filter
// baseline so an active filter never zeroes out its siblings.
interface Props {
  filter: FilterId;
  onFilterChange: (f: FilterId) => void;
  projectFilter: string | null;
  onProjectFilterChange: (p: string | null) => void;
  sessions: Session[];
}

type Item = { id: FilterId; label: string; count: number; tip: string };

const OUTCOME_LEGEND: Array<{ color: string; label: string }> = [
  { color: "var(--c-green)", label: "achieved / live" },
  { color: "var(--c-cyan)", label: "mostly" },
  { color: "var(--c-amber)", label: "partial" },
  { color: "var(--c-red)", label: "not achieved" },
  { color: "var(--c-text-faint)", label: "unknown" },
];

function statusItems(sessions: Session[]): Item[] {
  const ghostByKind = { crashed: 0, empty: 0 } as Record<string, number>;
  for (const s of sessions) if (s.ghost) ghostByKind[s.ghostKind ?? "empty"] += 1;
  const ghostCount = ghostByKind.crashed + ghostByKind.empty;
  const anyQuality = sessions.some((s) => s.quality);
  return [
    { id: "all", label: "All sessions", count: sessions.length, tip: "" },
    { id: "live", label: "Live", count: sessions.filter((s) => s.live).length, tip: "Sessions with a running claude process" },
    {
      id: "ghost",
      label: "Ghosts",
      count: ghostCount,
      tip: `Empty sessions (no prompt, no tool call) and sessions whose process died.\n${ghostByKind.crashed} crashed · ${ghostByKind.empty} empty`,
    },
    { id: "friction", label: "Friction", count: sessions.filter((s) => s.frictions.length > 0).length, tip: "Sessions flagged for wrong approach, tool errors, interruptions, etc." },
    {
      id: "failed",
      label: "Low outcome",
      count: sessions.filter((s) => !s.ghost && (s.outcome === "not_achieved" || s.outcome === "partially_achieved")).length,
      tip: "Sessions labelled 'partially' or 'not' achieved (excludes ghosts)",
    },
    ...(anyQuality
      ? [{
          id: "lowquality" as FilterId,
          label: "Low quality",
          count: sessions.filter((s) => s.quality && s.quality.score < 70).length,
          tip: "Quality score < 70 (token-optimizer: stale reads, bloated results, duplicates, etc.)",
        }]
      : []),
  ];
}

/** Filters button + popover, and the row of active filters (removable) under the list header. */
export function SessionFilters({ filter, onFilterChange, projectFilter, onProjectFilterChange, sessions }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = useMemo(() => statusItems(sessions), [sessions]);
  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.project, (counts.get(s.project) ?? 0) + 1);
    return [...counts.entries()].sort(([, a], [, b]) => b - a);
  }, [sessions]);

  const activeStatus = filter !== "all" ? items.find((i) => i.id === filter) : undefined;
  const activeCount = (activeStatus ? 1 : 0) + (projectFilter ? 1 : 0);

  return (
    <div className="session-filters" ref={wrapRef}>
      <div className="session-filters-row">
        <button
          type="button"
          className={`filters-btn ${open ? "open" : ""} ${activeCount > 0 ? "has-active" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">⚲</span> Filters
          {activeCount > 0 && <span className="filters-btn-count tabular">{activeCount}</span>}
        </button>

        {projectFilter && (
          <button
            type="button"
            className="active-chip"
            style={{ "--pc": projectColor(projectFilter) } as React.CSSProperties}
            onClick={() => onProjectFilterChange(null)}
            title={`Clear project filter: ${projectFilter}`}
          >
            <span className="active-chip-dot" />
            <span className="mono">{projectFilter}</span>
            <span className="active-chip-x" aria-hidden="true">×</span>
          </button>
        )}
        {activeStatus && (
          <button
            type="button"
            className="active-chip status"
            onClick={() => onFilterChange("all")}
            title={`Clear filter: ${activeStatus.label}`}
          >
            <span>{activeStatus.label}</span>
            <span className="active-chip-x" aria-hidden="true">×</span>
          </button>
        )}
        {activeCount >= 2 && (
          <button
            type="button"
            className="filters-clear"
            onClick={() => {
              onFilterChange("all");
              onProjectFilterChange(null);
            }}
          >
            clear
          </button>
        )}
      </div>

      {open && (
        <div className="filters-pop" role="dialog" aria-label="Filters">
          <div className="filters-pop-section">
            <div className="filters-pop-label">Status</div>
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                className={`filters-pop-item ${filter === i.id ? "active" : ""} ${i.count === 0 && filter !== i.id ? "empty" : ""}`}
                aria-pressed={filter === i.id}
                onClick={() => onFilterChange(i.id)}
                title={i.tip || undefined}
              >
                <span>{i.label}</span>
                <span className="mono tabular filters-pop-count">{i.count}</span>
              </button>
            ))}
          </div>

          <div className="filters-pop-section">
            <div className="filters-pop-label">Project</div>
            {projects.map(([p, count]) => {
              const active = projectFilter === p;
              return (
                <button
                  key={p}
                  type="button"
                  className={`filters-pop-item ${active ? "active" : ""}`}
                  aria-pressed={active}
                  onClick={() => onProjectFilterChange(active ? null : p)}
                >
                  <span className="filters-pop-project">
                    <span className="project-dot" style={{ background: projectColor(p) }} />
                    <span className="mono">{p}</span>
                  </span>
                  <span className="mono tabular filters-pop-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="filters-pop-legend">
            <span className="filters-pop-label">Row bar</span>
            {OUTCOME_LEGEND.map((l) => (
              <span key={l.label} className="filters-pop-legend-item">
                <span className="legend-bar" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
