import type { Session } from "../types";
import type { RateLimits } from "../utils/rateLimits";
import { nextUp, type BadgesPayload } from "../utils/gamify";
import { NextUp } from "../components/fleet/Badges";
import { LiveTicker } from "../components/fleet/LiveTicker";
import { FiveHourSession } from "../components/fleet/FiveHourSession";
import { SessionList } from "../components/SessionList";
import { PageSection } from "./PageSection";

interface Props {
  allSessions: Session[];
  /** Sessions that count against the usage limits (the 5h window). */
  limitSessions: Session[];
  limits: RateLimits | null;
  badges: BadgesPayload | null;
  onSelectSession: (id: string) => void;
  onShowAllSessions: () => void;
  onOpenProgress: () => void;
}

const LATEST = 6;

/** What is running and how much of the limits is left. Ignores the range and filters on purpose. */
export function NowPage({ allSessions, limitSessions, limits, badges, onSelectSession, onShowAllSessions, onOpenProgress }: Props) {
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

      {badges && <ProgressStrip badges={badges} onOpen={onOpenProgress} />}

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

/** Level, today's XP, the streak and the three closest good-practice badges: a goal on the landing page. */
function ProgressStrip({ badges, onOpen }: { badges: BadgesPayload; onOpen: () => void }) {
  const { level, streak } = badges;
  if (nextUp(badges.families, 1).length === 0) return null;
  const note = level ? `Lv ${level.level} ${level.title} · +${level.today} XP today` : undefined;
  return (
    <PageSection
      title="Next up"
      note={note}
      aside={
        <>
          {streak && streak.current > 0 && (
            <span className={`streak-note mono tabular ${streak.atRisk ? "at-risk" : ""}`}>
              🔥 {streak.current} day{streak.current === 1 ? "" : "s"}{streak.atRisk ? " · not yet today" : ""}
            </span>
          )}
          <button className="link-btn" onClick={onOpen}>Progress →</button>
        </>
      }
    >
      <NextUp families={badges.families} limit={3} onOpen={onOpen} />
    </PageSection>
  );
}
