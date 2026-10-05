import { useEffect, useMemo, useState } from "react";
import type { Session } from "../types";
import type { Range } from "../utils/range";
import { useBurnTracker, type Spike } from "../utils/burnTracker";
import { useRateLimits } from "../utils/rateLimits";
import { BurnSpikeBanner } from "./fleet/BurnSpikeBanner";
import { SpikeAnalysisOverlay } from "./fleet/SpikeAnalysisOverlay";
import { LiveTicker } from "./fleet/LiveTicker";
import { FiveHourSession } from "./fleet/FiveHourSession";
import { TopSessions } from "./fleet/TopSessions";
import { TokenTimeSeries } from "./fleet/TokenTimeSeries";
import { HeavyPrompts } from "./fleet/HeavyPrompts";
import { AnomalyFlags } from "./fleet/AnomalyFlags";
import { ProjectRollup } from "./fleet/ProjectRollup";
import { ModelMix } from "./fleet/ModelMix";
import { ToolsHeatmap } from "./fleet/ToolsHeatmap";
import { HealthScore } from "./fleet/HealthScore";
import { Badges } from "./fleet/Badges";
import { HealthCheck } from "./fleet/HealthCheck";
import { OPEN_TAB_EVENT, type DashboardTab } from "../utils/openTab";
import "../gamify.css";

type Tab = DashboardTab;
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "rankings", label: "Rankings" },
  { id: "health", label: "Health" },
  { id: "analysis", label: "Analysis" },
];
const TAB_KEY = "ccblackbox:fleet-tab";

function loadTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === "rankings" || v === "health" || v === "analysis") return v; // a stored "today" (removed tab) falls through
  } catch {
    /* ignore */
  }
  return "rankings";
}

interface Props {
  sessions: Session[];
  allSessions: Session[];
  range: Range;
  zoomed: boolean;
  onToggleZoom: () => void;
  onSelectSession: (id: string) => void;
}

export function FleetDashboard({
  sessions,
  allSessions,
  range,
  zoomed,
  onToggleZoom,
  onSelectSession,
}: Props) {
  const limits = useRateLimits();
  // The 5h window, burn rate and spikes are Claude's usage limits: Codex has its own.
  const claudeSessions = useMemo(() => allSessions.filter((s) => s.agent !== "codex"), [allSessions]);
  const burn = useBurnTracker(claudeSessions, limits);
  const [analysisSpike, setAnalysisSpike] = useState<Spike | null>(null);
  const [tab, setTab] = useState<Tab>(loadTab);

  const selectTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onOpen = (e: Event) => selectTab((e as CustomEvent<Tab>).detail);
    window.addEventListener(OPEN_TAB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TAB_EVENT, onOpen);
  }, []);

  const rangeNote =
    sessions.length === allSessions.length
      ? "All sessions"
      : `${sessions.length} of ${allSessions.length} sessions · filters applied`;

  return (
    <div className={`fleet-dashboard ${zoomed ? "zoomed" : ""}`}>
      {burn.activeSpike && (
        <BurnSpikeBanner
          spike={burn.activeSpike}
          onInvestigate={() => setAnalysisSpike(burn.activeSpike)}
          onDismiss={burn.dismissSpike}
        />
      )}

      <div className="fleet-tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`fleet-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          className="fleet-zoom-toggle"
          onClick={onToggleZoom}
          title={zoomed ? "Exit zoom" : "Zoom dashboard"}
          aria-label={zoomed ? "Exit zoom" : "Zoom dashboard"}
        >
          {zoomed ? "✕ exit zoom" : "⤢ zoom"}
        </button>
      </div>

      {tab === "rankings" && (
        <>
          <div className="fleet-group-label fleet-group-first">
            <span className="fleet-group-name">In the selected range</span>
            <span className="fleet-group-note">{rangeNote}</span>
          </div>
          <TopSessions sessions={sessions} onSelectSession={onSelectSession} />
          <Badges allSessions={allSessions} />
          <ProjectRollup sessions={sessions} allSessions={allSessions} range={range} />
        </>
      )}

      {tab === "health" && (
        <>
          <div className="fleet-group-label fleet-group-first">
            <span className="fleet-group-name">In the selected range</span>
            <span className="fleet-group-note">{rangeNote}</span>
          </div>
          <HealthScore sessions={sessions} allSessions={allSessions} />
          <HealthCheck sessions={sessions} allSessions={allSessions} onSelectSession={onSelectSession} />
        </>
      )}

      {tab === "analysis" && (
        <>
          <div className="fleet-group-label fleet-group-first">
            <span className="fleet-group-name">Right now</span>
            <span className="fleet-group-note">All sessions · ignores filters and range</span>
            <LiveTicker sessions={allSessions} />
          </div>
          <FiveHourSession sessions={claudeSessions} limits={limits} onSelectSession={onSelectSession} />
          <div className="fleet-group-label">
            <span className="fleet-group-name">In the selected range</span>
            <span className="fleet-group-note">{rangeNote}</span>
          </div>
          <div className="fleet-history-host">
            <div className="fleet-history">
              <div className="fleet-stack">
                <AnomalyFlags sessions={sessions} onSelectSession={onSelectSession} />
                <ModelMix sessions={sessions} />
              </div>
              <ToolsHeatmap sessions={sessions} />
              <div className="fleet-span-all">
                <HeavyPrompts sessions={sessions} onSelectSession={onSelectSession} />
              </div>
              <div className="fleet-span-all">
                <TokenTimeSeries sessions={sessions} range={range} />
              </div>
            </div>
          </div>
        </>
      )}

      {analysisSpike && (
        <SpikeAnalysisOverlay
          spike={analysisSpike}
          sessions={sessions.filter((s) => s.agent !== "codex")}
          onClose={() => setAnalysisSpike(null)}
          onSelectSession={(id) => {
            setAnalysisSpike(null);
            onSelectSession(id);
          }}
        />
      )}
    </div>
  );
}
