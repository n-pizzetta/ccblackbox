import { useEffect, useRef, useState } from "react";
import type { Session } from "../types";
import { SettingsButton } from "./SettingsButton";
import { BrandMark } from "./BrandMark";
import { toastError } from "../utils/toast";

type Filter = "all" | "live" | "ghost" | "friction" | "failed" | "lowquality";

// `sessions` here is always the `inRange` (time-scoped) set. Filter counts MUST
// be computed from the pre-filter baseline — otherwise active filters would
// zero-out siblings. Other panels receive the fully-filtered subset.
interface Props {
  open?: boolean;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  sessions: Session[];
  projectFilter: string | null;
  onProjectFilterChange: (p: string | null) => void;
  parseErrors?: string[];
}

const PROJECTS_VISIBLE = 5;

function NavGlyph({ kind }: { kind: "none" | "live" | "ghost" | "friction" | "failed" | "lowquality" }) {
  if (kind === "live") return <span className="glyph glyph-live" />;
  if (kind === "ghost") return <span className="glyph glyph-ghost" />;
  if (kind === "friction") return <span className="glyph glyph-friction">△</span>;
  if (kind === "failed") return <span className="glyph glyph-failed" />;
  if (kind === "lowquality") return <span className="glyph glyph-lowquality">◐</span>;
  return <span className="glyph glyph-none" />;
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h10" />
      <path d="M6.5 4V2.5h3V4" />
      <path d="M4.5 4l.6 8.5a1 1 0 001 .9h3.8a1 1 0 001-.9L11.5 4" />
      <path d="M7 7v4" />
      <path d="M9 7v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

function ParseErrorRow({ fileName }: { fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const trash = async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/parse-error/${encodeURIComponent(fileName)}/trash`, { method: "POST" });
      if (!res.ok) {
        toastError("Trash failed: " + (await res.text()));
        setBusy(false);
        return;
      }
      setDone(true);
    } catch (e) {
      toastError("Trash failed: " + (e as Error).message);
      setBusy(false);
    }
  };
  return (
    <li className={`parse-errors-pop-row ${done ? "trashed" : ""}`}>
      <span className="parse-errors-pop-name">{fileName}</span>
      <button
        className="parse-errors-pop-trash"
        onClick={trash}
        disabled={busy || done}
        title={done ? "Trashed" : "Move to .trash/"}
        aria-label={done ? "Trashed" : `Trash ${fileName}`}
      >
        {done ? (
          <CheckIcon />
        ) : busy ? (
          <span className="dim">…</span>
        ) : (
          <TrashIcon />
        )}
      </button>
    </li>
  );
}

function ParseErrorsItem({ errors }: { errors: string[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 6, left: r.right + 8 });
    };
    updatePos();
    const onClick = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="nav-item parse-errors-nav"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="nav-item-label">
          <span className="glyph glyph-error">!</span>
          <span>Parse errors</span>
        </span>
        <span className="count tabular" style={{ color: "var(--c-amber)" }}>{errors.length}</span>
      </button>
      {open && pos && (
        <div
          ref={popRef}
          className="parse-errors-popover"
          role="dialog"
          aria-label="Parse errors"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="parse-errors-pop-head">
            <span className="mono caps dim">Parse errors</span>
            <span className="mono dim tabular">{errors.length} total</span>
          </div>
          <p className="parse-errors-pop-desc mono dim">
            session-meta files the parser couldn't read (missing session_id / start_time, malformed JSON). Safe to ignore — these sessions are skipped.
          </p>
          <ul className="parse-errors-pop-list mono">
            {errors.slice(0, 20).map((e) => (
              <ParseErrorRow key={e} fileName={e} />
            ))}
          </ul>
          {errors.length > 20 && (
            <div className="mono dim parse-errors-pop-more">… +{errors.length - 20} more</div>
          )}
          <div className="parse-errors-pop-hint mono dim">
            Location: ~/.claude/usage-data/session-meta/
          </div>
        </div>
      )}
    </>
  );
}

export function Sidebar({ open, filter, onFilterChange, sessions, projectFilter, onProjectFilterChange, parseErrors }: Props) {
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const liveCount = sessions.filter((s) => s.live).length;
  const ghostCount = sessions.filter((s) => s.ghost).length;
  const ghostByKind = { crashed: 0, empty: 0 } as Record<string, number>;
  for (const s of sessions) {
    if (s.ghost) {
      const k = s.ghostKind ?? "empty";
      ghostByKind[k] = (ghostByKind[k] ?? 0) + 1;
    }
  }
  const ghostTip =
    ghostCount > 0
      ? `Empty sessions (no prompt, no tool call) and sessions whose Claude Code process died.\n${ghostByKind.crashed} crashed · ${ghostByKind.empty} empty`
      : "Empty sessions and sessions whose Claude Code process died (crash, kill, reboot)";
  const frictionCount = sessions.filter((s) => s.frictions.length > 0).length;
  const failedCount = sessions.filter(
    (s) => !s.ghost && (s.outcome === "not_achieved" || s.outcome === "partially_achieved"),
  ).length;
  const lowQualityCount = sessions.filter((s) => s.quality && s.quality.score < 70).length;
  const anyQuality = sessions.some((s) => s.quality);

  const items: Array<{ id: Filter; label: string; count: number; glyph: "none" | "live" | "ghost" | "friction" | "failed" | "lowquality"; tip?: string }> = [
    { id: "all", label: "All sessions", count: sessions.length, glyph: "none" },
    { id: "live", label: "Live", count: liveCount, glyph: "live", tip: "Sessions with a running claude process" },
    { id: "ghost", label: "Ghosts", count: ghostCount, glyph: "ghost", tip: ghostTip },
    { id: "friction", label: "Friction", count: frictionCount, glyph: "friction", tip: "Sessions LLM-flagged for wrong approach, tool errors, interruptions, etc." },
    { id: "failed", label: "Low outcome", count: failedCount, glyph: "failed", tip: "Sessions LLM-labelled 'partially' or 'not' achieved (excludes ghosts)" },
    ...(anyQuality ? [{ id: "lowquality" as Filter, label: "Low quality", count: lowQualityCount, glyph: "lowquality" as const, tip: "Quality score < 70 (measured by token-optimizer: stale reads, bloated results, duplicates, etc.)" }] : []),
  ];

  const projectCounts = new Map<string, number>();
  for (const s of sessions) projectCounts.set(s.project, (projectCounts.get(s.project) ?? 0) + 1);
  const projects = Array.from(projectCounts.entries()).sort(([, a], [, b]) => b - a);
  let visibleProjects = projectsExpanded ? projects : projects.slice(0, PROJECTS_VISIBLE);
  if (!projectsExpanded && projectFilter && !visibleProjects.some(([p]) => p === projectFilter)) {
    const entry = projects.find(([p]) => p === projectFilter);
    if (entry) visibleProjects = [entry, ...visibleProjects];
  }
  const hiddenCount = projects.length - visibleProjects.length;

  return (
    <aside className={`sidebar scrollbar ${open ? "open" : ""}`}>
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          ccblackbox
          <div className="dimcaps">flight recorder</div>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-label">Filter by</div>
        {items.map((i) => (
          <button
            key={i.id}
            className={`nav-item ${filter === i.id ? "active" : ""}`}
            aria-pressed={filter === i.id}
            onClick={() => onFilterChange(i.id)}
            title={i.tip}
          >
            <span className="nav-item-label">
              <NavGlyph kind={i.glyph} />
              {i.label}
            </span>
            <span className="count tabular">{i.count}</span>
          </button>
        ))}
        {parseErrors && parseErrors.length > 0 && (
          <ParseErrorsItem errors={parseErrors} />
        )}
      </div>

      <div className="nav-section">
        <div className="nav-label">Projects</div>
        {visibleProjects.map(([p, count]) => {
          const active = projectFilter === p;
          return (
            <button
              key={p}
              className={`nav-item project-item ${active ? "active" : ""}`}
              aria-pressed={active}
              onClick={() => onProjectFilterChange(active ? null : p)}
              title={active ? `Clear filter: ${p}` : `Filter by ${p}`}
            >
              <span className="mono project-name" title={p}>{p}</span>
              <span className="count tabular">{count}</span>
            </button>
          );
        })}
        {projects.length > PROJECTS_VISIBLE && (
          <button
            className="nav-item more-toggle"
            onClick={() => setProjectsExpanded((v) => !v)}
          >
            <span className="nav-item-label mono dim">
              {projectsExpanded ? "show less" : `${hiddenCount} more`}
            </span>
            <span className="count mono dim">{projectsExpanded ? "▴" : "▾"}</span>
          </button>
        )}
      </div>

      <div className="sidebar-spacer" />

      <SettingsButton />

    </aside>
  );
}
