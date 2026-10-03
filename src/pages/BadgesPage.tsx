import { useMemo } from "react";
import type { Session } from "../types";
import { activityStreak, levelOf } from "../utils/gamify";
import { formatTokens } from "../utils/format";
import { KpiRow } from "../components/Kpi";
import { TopSessions } from "../components/fleet/TopSessions";
import { Badges } from "../components/fleet/Badges";
import { PageSection } from "./PageSection";

interface Props {
  allSessions: Session[];
  onSelectSession: (id: string) => void;
}

/** Level, personal records and badges. All time: the range and filters don't apply. */
export function BadgesPage({ allSessions, onSelectSession }: Props) {
  const level = useMemo(() => levelOf(allSessions), [allSessions]);
  const streak = useMemo(() => activityStreak(allSessions), [allSessions]);

  return (
    <div className="page">
      <PageSection title="Progress" note="All time · not affected by the range or filters">
        <KpiRow
          items={[
            { label: "Level", value: level.level, sub: level.title },
            { label: "Next level", value: `${Math.round(level.progress * 100)}%`, sub: `${formatTokens(level.total)} / ${formatTokens(level.nextAt)}` },
            { label: "Streak", value: `${streak} day${streak === 1 ? "" : "s"}`, sub: "consecutive active days" },
            { label: "Sessions", value: allSessions.length, sub: "recorded" },
          ]}
        />
      </PageSection>
      <TopSessions sessions={allSessions} onSelectSession={onSelectSession} title="Records" />
      <Badges allSessions={allSessions} />
    </div>
  );
}
