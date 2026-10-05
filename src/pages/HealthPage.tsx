import type { Session } from "../types";
import { HealthCheck } from "../components/fleet/HealthCheck";
import { AnomalyFlags } from "../components/fleet/AnomalyFlags";

interface Props {
  sessions: Session[];
  allSessions: Session[];
  onSelectSession: (id: string) => void;
}

/** What to fix in how sessions are run: rule checks first, then outlier sessions. */
export function HealthPage({ sessions, allSessions, onSelectSession }: Props) {
  return (
    <div className="page">
      <HealthCheck sessions={sessions} allSessions={allSessions} onSelectSession={onSelectSession} />
      <AnomalyFlags sessions={sessions} onSelectSession={onSelectSession} />
    </div>
  );
}
