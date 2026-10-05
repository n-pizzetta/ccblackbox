import { useMemo } from "react";
import type { Session } from "../types";
import { projectColor } from "../utils/fleetStats";

export type FilterId = "all" | "live" | "ghost" | "friction" | "failed" | "lowquality" | "claude" | "codex";

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

/** Option labels, also for a persisted filter whose item is hidden in the current range. */
const FILTER_LABELS: Record<FilterId, string> = {
  all: "All sessions",
  live: "Live",
  ghost: "Ghosts",
  friction: "Friction",
  failed: "Low outcome",
  lowquality: "Low quality",
  claude: "Claude Code",
  codex: "Codex",
};

function statusItems(sessions: Session[]): Item[] {
  const ghostByKind = { crashed: 0, empty: 0 } as Record<string, number>;
  for (const s of sessions) if (s.ghost) ghostByKind[s.ghostKind ?? "empty"] += 1;
  const ghostCount = ghostByKind.crashed + ghostByKind.empty;
  const anyQuality = sessions.some((s) => s.quality);
  const codexCount = sessions.filter((s) => s.agent === "codex").length;
  return [
    { id: "all", label: "All sessions", count: sessions.length, tip: "" },
    { id: "live", label: "Live", count: sessions.filter((s) => s.live).length, tip: "Claude Code: running process · Codex: task in progress" },
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
          tip: "Context quality score < 70 (context fill, stale reads, bloated results, compactions, duplicates)",
        }]
      : []),
    // Agent filters only matter once both agents have sessions.
    ...(codexCount > 0 && codexCount < sessions.length
      ? [
          { id: "claude" as FilterId, label: "Claude Code", count: sessions.length - codexCount, tip: "Sessions from Claude Code (~/.claude)" },
          { id: "codex" as FilterId, label: "Codex", count: codexCount, tip: "Sessions from Codex (~/.codex)" },
        ]
      : []),
  ];
}

/** Status and project pickers of the scope bar. Counts come from the range, before filtering. */
export function SessionFilters({ filter, onFilterChange, projectFilter, onProjectFilterChange, sessions }: Props) {
  const items = useMemo(() => statusItems(sessions), [sessions]);
  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.project, (counts.get(s.project) ?? 0) + 1);
    return [...counts.entries()].sort(([, a], [, b]) => b - a);
  }, [sessions]);
  const activeStatus = items.find((i) => i.id === filter);

  return (
    <>
      <label className={`scope-select ${projectFilter ? "set" : ""}`}>
        <span className="scope-select-label">Project</span>
        {projectFilter && (
          <span className="project-dot" style={{ background: projectColor(projectFilter) }} aria-hidden="true" />
        )}
        <select value={projectFilter ?? ""} onChange={(e) => onProjectFilterChange(e.target.value || null)}>
          <option value="">All ({sessions.length})</option>
          {projects.map(([p, count]) => (
            <option key={p} value={p}>{p} ({count})</option>
          ))}
          {/* a project from the URL that has no session in this range */}
          {projectFilter && !projects.some(([p]) => p === projectFilter) && (
            <option value={projectFilter}>{projectFilter} (0)</option>
          )}
        </select>
      </label>
      <label className={`scope-select ${filter !== "all" ? "set" : ""}`} title={activeStatus?.tip || undefined}>
        <span className="scope-select-label">Show</span>
        <select value={filter} onChange={(e) => onFilterChange(e.target.value as FilterId)}>
          {items.map((i) => (
            <option key={i.id} value={i.id} disabled={i.count === 0 && filter !== i.id}>
              {i.id === "all" ? "All" : i.label} ({i.count})
            </option>
          ))}
          {/* a filter from the URL whose option is hidden in this range */}
          {!activeStatus && <option value={filter}>{FILTER_LABELS[filter]} (0)</option>}
        </select>
      </label>
    </>
  );
}
