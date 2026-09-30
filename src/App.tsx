import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "./components/BrandMark";
import { Sidebar } from "./components/Sidebar";
import { TopBar, StatsRow, type ReportStatus } from "./components/StatsStrip";
import { SessionList } from "./components/SessionList";
import { SessionDetail } from "./components/SessionDetail";
import { SessionCompare } from "./components/SessionCompare";
import { FleetDashboard } from "./components/FleetDashboard";
import { HelpOverlay } from "./components/HelpOverlay";
import { loadSessions, loadSessionDetail } from "./data/loadSessions";
import type { Session } from "./types";
import type { Range } from "./utils/range";
import { filterByRange, scopeToRange } from "./utils/range";
import "./App.css";
import { Toaster } from "./components/Toaster";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { toastError } from "./utils/toast";

const POLL_MS = 5000;
const STORAGE_KEY = "ccblackbox:state";

type FilterId = "all" | "live" | "ghost" | "friction" | "failed" | "lowquality";
const FILTER_IDS: FilterId[] = ["all", "live", "ghost", "friction", "failed", "lowquality"];
const RANGE_IDS: Range[] = ["today", "7d", "30d", "all"];

interface PersistedState {
  id: string | null;
  range: Range;
  filter: FilterId;
  project: string | null;
  search: string;
}

function parseHash(): Partial<PersistedState> {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return {};
  const [path, query] = raw.split("?");
  const out: Partial<PersistedState> = {};
  const m = path.match(/^session\/([a-f0-9-]{36})$/i);
  if (m) out.id = m[1];
  if (query) {
    const params = new URLSearchParams(query);
    const r = params.get("range");
    if (r && (RANGE_IDS as string[]).includes(r)) out.range = r as Range;
    const f = params.get("filter");
    if (f && (FILTER_IDS as string[]).includes(f)) out.filter = f as FilterId;
    const p = params.get("project");
    if (p) out.project = p;
    const q = params.get("q");
    if (q) out.search = q;
  }
  return out;
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Partial<PersistedState>;
  } catch {
    /* ignore */
  }
  return {};
}

function writeHash(state: PersistedState) {
  const params = new URLSearchParams();
  if (state.range !== "7d") params.set("range", state.range);
  if (state.filter !== "all") params.set("filter", state.filter);
  if (state.project) params.set("project", state.project);
  if (state.search) params.set("q", state.search);
  const qs = params.toString();
  const path = state.id ? `#session/${state.id}` : "";
  const next = `${path}${qs ? (path ? "?" : "#?") + qs : ""}`;
  if (window.location.hash !== next) {
    const full = next || window.location.pathname + window.location.search;
    window.history.replaceState(null, "", full);
  }
}

function App() {
  const initial = useMemo(() => ({ ...loadPersisted(), ...parseHash() }), []);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [source, setSource] = useState<"real" | "mock" | "loading">("loading");
  const [generatedAt, setGeneratedAt] = useState<string | undefined>();
  const [parseErrors, setParseErrors] = useState<string[] | undefined>();
  const [selectedId, setSelectedIdInternal] = useState<string | null>(initial.id ?? null);
  const [filter, setFilter] = useState<FilterId>(initial.filter ?? "all");
  const [projectFilter, setProjectFilter] = useState<string | null>(initial.project ?? null);
  const [range, setRange] = useState<Range>(initial.range ?? "7d");
  const [search, setSearch] = useState(initial.search ?? "");
  const [dashboardZoomed, setDashboardZoomed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [reportStatus, setReportStatus] = useState<ReportStatus>({ exists: false });

  useEffect(() => {
    const state: PersistedState = { id: selectedId, range, filter, project: projectFilter, search };
    writeHash(state);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [selectedId, range, filter, projectFilter, search]);

  const toggleDashboardZoom = () => {
    const next = !dashboardZoomed;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => setDashboardZoomed(next));
    } else {
      setDashboardZoomed(next);
    }
  };

  const [navOpen, setNavOpen] = useState(false);

  const setSelectedId = (id: string | null) => {
    setSelectedIdInternal(id);
  };

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      const next = parsed.id ?? null;
      if (next !== selectedId) setSelectedIdInternal(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const r = await loadSessions();
      if (cancelled) return;
      setAllSessions(r.sessions);
      setSource(r.source);
      setGeneratedAt(r.generatedAt);
      setParseErrors(r.parseErrors);
      if (r.sessions.length > 0) {
        setSelectedIdInternal((id) => (id && !r.sessions.some((s) => s.id === id) ? null : id));
      }
      try {
        const rs = await fetch("/api/report-status").then((x) => x.json());
        if (!cancelled) {
          setReportStatus({ exists: !!rs.exists, mtime: rs.mtime ?? undefined });
        }
      } catch {
        /* ignore — likely served as static export without API */
      }
    }
    refresh();
    const hot = (import.meta as ImportMeta & { hot?: { on: (e: string, cb: () => void) => void; off?: (e: string, cb: () => void) => void } }).hot;
    const hmrActive = !!hot;
    const id = hmrActive ? null : setInterval(refresh, POLL_MS);
    const onPush = () => refresh();
    if (hot) hot.on("ccblackbox:sessions-updated", onPush);
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
      if (hot?.off) hot.off("ccblackbox:sessions-updated", onPush);
    };
  }, []);

  const inRange = useMemo(() => filterByRange(allSessions, range), [range, allSessions]);

  const q = search.trim().toLowerCase();
  const filtered = inRange.filter((s) => {
    if (projectFilter && s.project !== projectFilter) return false;
    if (q) {
      const hay = `${s.goal} ${s.project} ${s.summary}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter === "live") return !!s.live;
    if (filter === "ghost") return !!s.ghost;
    if (filter === "friction") return s.frictions.length > 0;
    if (filter === "failed") return !s.ghost && (s.outcome === "not_achieved" || s.outcome === "partially_achieved");
    if (filter === "lowquality") return !!s.quality && s.quality.score < 70;
    return true;
  });
  // Aggregates only count what was spent inside the range (per turn).
  const scopedFiltered = useMemo(() => scopeToRange(filtered, range), [filtered, range]);

  const selectedSummary: Session | null = selectedId
    ? filtered.find((s) => s.id === selectedId) ??
      inRange.find((s) => s.id === selectedId) ??
      allSessions.find((s) => s.id === selectedId) ??
      null
    : null;

  const [detail, setDetail] = useState<{ id: string; data: Session | null } | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    loadSessionDetail(selectedId)
      .then((d) => { if (!cancelled) setDetail({ id: selectedId, data: d }); })
      .catch(() => {
        if (cancelled) return;
        setDetail({ id: selectedId, data: null });
        toastError("Could not load the session details. Showing the summary only.");
      });
    return () => { cancelled = true; };
  }, [selectedId]);
  const selectedDetail = detail && detail.id === selectedId ? detail.data : null;

  const selected: Session | null = selectedSummary || selectedDetail
    ? ({
        timeline: [],
        prompts: [],
        turns: [],
        toolSequence: [],
        fileHistory: [],
        ...selectedSummary,
        ...selectedDetail,
      } as Session)
    : null;

  const selectedIdx = selected ? filtered.findIndex((s) => s.id === selected.id) : -1;
  const navigate = (dir: "prev" | "next") => {
    if (selectedIdx < 0 || filtered.length === 0) return;
    const target = dir === "next" ? selectedIdx + 1 : selectedIdx - 1;
    if (target < 0 || target >= filtered.length) return;
    setSelectedId(filtered[target].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.altKey || (e.metaKey && e.key !== "f") || (e.ctrlKey && e.key !== "f")) return;
      const isNav = e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowUp" || e.key === "k";
      if (isNav) {
        // only hijack arrows while a session is open, so the dashboard can still scroll
        if (!selectedId || helpOpen) return;
        e.preventDefault();
        navigate(e.key === "ArrowDown" || e.key === "j" ? "next" : "prev");
      }
      else if (e.key === "Escape") {
        if (helpOpen) return;
        if (navOpen) setNavOpen(false);
        else if (selectedId) setSelectedId(null);
        else if (dashboardZoomed) toggleDashboardZoom();
      }
      else if (e.key === "f" && (e.metaKey || e.ctrlKey) && !selectedId) {
        e.preventDefault();
        toggleDashboardZoom();
      }
      else if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, filtered.length, dashboardZoomed, selectedId, helpOpen, navOpen]);

  if (source === "loading") {
    return (
      <div className="app">
        <div className="loading-screen">
          <BrandMark size={44} />
          <div className="mono dim" style={{ marginTop: 14 }}>reading ~/.claude/projects/…</div>
        </div>
      </div>
    );
  }

  const sessionOpen = !!selected;

  return (
    <div className={`app ${sessionOpen ? "session-overlay" : ""} ${dashboardZoomed && !sessionOpen ? "dashboard-zoomed" : ""}`}>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} role="presentation" />}
      <Sidebar
        open={navOpen}
        filter={filter}
        onFilterChange={setFilter}
        sessions={inRange}
        projectFilter={projectFilter}
        onProjectFilterChange={setProjectFilter}
        parseErrors={parseErrors}
      />
      <main className="main scrollbar">
        <button
          className="nav-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          aria-label="Toggle filters"
        >
          ☰ Filters
        </button>
        <TopBar
          range={range}
          onRangeChange={setRange}
          source={source}
          generatedAt={generatedAt}
          activeFilterCount={
            (filter !== "all" ? 1 : 0) +
            (projectFilter ? 1 : 0) +
            (search ? 1 : 0)
          }
          onClearFilters={() => {
            setFilter("all");
            setProjectFilter(null);
            setSearch("");
          }}
          onHelp={() => setHelpOpen(true)}
          reportStatus={reportStatus}
        />
        <StatsRow
          sessions={scopedFiltered}
          totalInRange={inRange.length}
          range={range}
          activeFilterCount={
            (filter !== "all" ? 1 : 0) +
            (projectFilter ? 1 : 0) +
            (search ? 1 : 0)
          }
        />
        <div className="split">
          <SessionList
            sessions={filtered}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            search={search}
            onSearchChange={setSearch}
            compareMode={compareMode}
            onToggleCompareMode={() => {
              setCompareMode((v) => {
                if (v) setCompareIds(new Set());
                return !v;
              });
            }}
            compareIds={compareIds}
            onToggleCompare={(id) =>
              setCompareIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            ghostsFocused={filter === "ghost"}
            onBulkDelete={async (ids) => {
              const res = await fetch("/api/ghost/bulk-delete", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ids }),
              });
              if (!res.ok) {
                toastError("Bulk delete failed: " + (await res.text()));
                return;
              }
              setCompareIds(new Set());
            }}
          />
          {compareMode ? (
            <SessionCompare
              sessions={allSessions.filter((s) => compareIds.has(s.id))}
              onClose={() => {
                setCompareMode(false);
                setCompareIds(new Set());
              }}
              onRemove={(id) =>
                setCompareIds((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                })
              }
              onPick={(id) => {
                setCompareMode(false);
                setCompareIds(new Set());
                setSelectedId(id);
              }}
            />
          ) : (
            <FleetDashboard
              sessions={scopedFiltered}
              allSessions={allSessions}
              range={range}
              zoomed={dashboardZoomed}
              onToggleZoom={toggleDashboardZoom}
              onSelectSession={setSelectedId}
            />
          )}
        </div>
      </main>
      {selected && (
        <div className="session-overlay-host">
          <ErrorBoundary key={selected.id} onClose={() => setSelectedId(null)}>
          <SessionDetail
            session={selected}
            fullscreen={true}
            onClose={() => setSelectedId(null)}
            onNavigate={navigate}
            hasPrev={selectedIdx > 0}
            hasNext={selectedIdx >= 0 && selectedIdx < filtered.length - 1}
            position={selectedIdx + 1}
            total={filtered.length}
          />
          </ErrorBoundary>
        </div>
      )}
      <Toaster />
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

export default App;
