import type { Session } from "../types";
import type { Range } from "../utils/range";
import { TokenTimeSeries } from "../components/fleet/TokenTimeSeries";
import { ProjectRollup } from "../components/fleet/ProjectRollup";
import { ModelMix } from "../components/fleet/ModelMix";
import { ToolsHeatmap } from "../components/fleet/ToolsHeatmap";
import { HeavyPrompts } from "../components/fleet/HeavyPrompts";

interface Props {
  sessions: Session[];
  allSessions: Session[];
  range: Range;
  onSelectSession: (id: string) => void;
}

/** Where tokens and API value went in the scope: over time, then by project, model and tool. */
export function UsagePage({ sessions, allSessions, range, onSelectSession }: Props) {
  return (
    <div className="page">
      <TokenTimeSeries sessions={sessions} range={range} />
      <div className="page-grid-3">
        <ProjectRollup sessions={sessions} allSessions={allSessions} range={range} />
        <ModelMix sessions={sessions} />
        <ToolsHeatmap sessions={sessions} />
      </div>
      <HeavyPrompts sessions={sessions} onSelectSession={onSelectSession} />
    </div>
  );
}
