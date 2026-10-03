import type { Session } from "../types";
import type { RateLimits } from "../utils/rateLimits";
import { LiveTicker } from "../components/fleet/LiveTicker";
import { FiveHourSession } from "../components/fleet/FiveHourSession";
import { SessionList } from "../components/SessionList";
import { PageSection } from "./PageSection";

interface Props {
  allSessions: Session[];
  /** Sessions that count against the usage limits (the 5h window). */
  limitSessions: Session[];
  limits: RateLimits | null;
  onSelectSession: (id: string) => void;
  onShowAllSessions: () => void;
}

const LATEST = 6;

/** What is running and how much of the limits is left. Ignores the range and filters on purpose. */
export function NowPage({ allSessions, limitSessions, limits, onSelectSession, onShowAllSessions }: Props) {
  const live = allSessions.filter((s) => s.live);
  const rows = live.length > 0 ? live : allSessions.slice(0, LATEST);

  return (
    <div className="page">
      <PageSection
        title="Right now"
        note="All sessions · not affected by the range or filters"
        aside={<LiveTicker sessions={allSessions} />}
      >
        <FiveHourSession sessions={limitSessions} limits={limits} onSelectSession={onSelectSession} />
      </PageSection>

      <PageSection
        title={live.length > 0 ? "Live sessions" : "Latest sessions"}
        note={live.length > 0 ? `${live.length} running` : "No session running"}
        aside={<button className="link-btn" onClick={onShowAllSessions}>All sessions →</button>}
      >
        <SessionList sessions={rows} onSelect={onSelectSession} autoHeight />
      </PageSection>
    </div>
  );
}
