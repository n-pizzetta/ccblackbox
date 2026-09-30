import { useState } from "react";
import type { Session } from "../types";
import type { Range } from "../utils/range";
import { useBurnTracker, type Spike } from "../utils/burnTracker";
import { useRateLimits } from "../utils/rateLimits";
import { BurnSpikeBanner } from "./fleet/BurnSpikeBanner";
import { SpikeAnalysisOverlay } from "./fleet/SpikeAnalysisOverlay";
import { LiveTicker } from "./fleet/LiveTicker";
import { FiveHourSession } from "./fleet/FiveHourSession";
import { LiveSessions } from "./fleet/LiveSessions";
import { TopSessions } from "./fleet/TopSessions";
import { TokenTimeSeries } from "./fleet/TokenTimeSeries";
import { HeavyPrompts } from "./fleet/HeavyPrompts";
import { AnomalyFlags } from "./fleet/AnomalyFlags";
import { ProjectRollup } from "./fleet/ProjectRollup";
import { ModelMix } from "./fleet/ModelMix";
import { ToolsHeatmap } from "./fleet/ToolsHeatmap";

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
  const burn = useBurnTracker(allSessions, limits);
  const [analysisSpike, setAnalysisSpike] = useState<Spike | null>(null);

  return (
    <div className={`fleet-dashboard ${zoomed ? "zoomed" : ""}`}>
      {burn.activeSpike && (
        <BurnSpikeBanner
          spike={burn.activeSpike}
          onInvestigate={() => setAnalysisSpike(burn.activeSpike)}
          onDismiss={burn.dismissSpike}
        />
      )}

      <div className="fleet-group-label fleet-group-first">
        <span className="fleet-group-name">Right now</span>
        <span className="fleet-group-note">All sessions · ignores filters and range</span>
        <button
          className="fleet-zoom-toggle"
          onClick={onToggleZoom}
          title={zoomed ? "Exit zoom" : "Zoom dashboard"}
          aria-label={zoomed ? "Exit zoom" : "Zoom dashboard"}
        >
          {zoomed ? "✕ exit zoom" : "⤢ zoom"}
        </button>
      </div>

      <LiveTicker sessions={allSessions} limits={limits} />

      <FiveHourSession sessions={allSessions} limits={limits} onSelectSession={onSelectSession} />

      <LiveSessions sessions={sessions} onSelectSession={onSelectSession} />

      <div className="fleet-group-label">
        <span className="fleet-group-name">In the selected range</span>
        <span className="fleet-group-note">
          {sessions.length === allSessions.length
            ? "All sessions"
            : `${sessions.length} of ${allSessions.length} sessions · filters applied`}
        </span>
      </div>

      <div className="fleet-history-host">
      <div className="fleet-history">
        <div className="fleet-span-all">
          <TopSessions sessions={sessions} onSelectSession={onSelectSession} />
        </div>
        <AnomalyFlags sessions={sessions} onSelectSession={onSelectSession} />
        <ToolsHeatmap sessions={sessions} />
        <ProjectRollup sessions={sessions} />
        <ModelMix sessions={sessions} />
        <div className="fleet-span-all">
          <HeavyPrompts sessions={sessions} onSelectSession={onSelectSession} />
        </div>
        <div className="fleet-span-all">
          <TokenTimeSeries sessions={sessions} range={range} />
        </div>
      </div>
      </div>

      {analysisSpike && (
        <SpikeAnalysisOverlay
          spike={analysisSpike}
          sessions={sessions}
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
