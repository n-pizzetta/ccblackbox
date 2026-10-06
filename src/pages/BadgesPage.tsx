import { useEffect, useState } from "react";
import type { Session } from "../types";
import type { BadgesPayload } from "../utils/gamify";
import { KpiRow } from "../components/Kpi";
import { TopSessions } from "../components/fleet/TopSessions";
import { Badges, NextUp } from "../components/fleet/Badges";
import { PageSection } from "./PageSection";
import type { Provider } from "../utils/providers";

interface Props {
  allSessions: Session[];
  provider: Provider;
  /** Null without the local API: only the records show. */
  badges: BadgesPayload | null;
  /** Unlocks not seen here yet; marked as seen on arrival, still flagged "new" during the visit. */
  unseen: Set<string>;
  onViewed: () => void;
  onSelectSession: (id: string) => void;
}

/** "Progress": level, next goals, badges and records. All time: the range and filters don't apply. */
export function BadgesPage({ allSessions, provider, badges, unseen, onViewed, onSelectSession }: Props) {
  const [fresh, setFresh] = useState<Set<string>>(() => new Set(unseen));
  if ([...unseen].some((k) => !fresh.has(k))) setFresh(new Set([...fresh, ...unseen]));
  useEffect(() => {
    if (unseen.size > 0) onViewed();
  }, [unseen, onViewed]);

  const level = badges?.level;
  const streak = badges?.streak;

  return (
    <div className="page">
      {provider === "codex" && (
        <PageSection title="Codex records" note="All time">
          <p className="dim provider-note">Badges and XP are currently available for Claude Code. Your Codex records are shown below.</p>
        </PageSection>
      )}
      {level && streak && (
        <PageSection title="Progress" note="Claude Code · All time · not affected by the range or filters">
          <KpiRow
            items={[
              { label: "Level", value: level.level, sub: level.title },
              {
                label: "Next level",
                value: `${Math.round(((level.xp - level.from) / (level.next - level.from)) * 100)}%`,
                sub: `${level.xp} / ${level.next} XP`,
              },
              { label: "Today", value: `+${level.today} XP`, sub: "since midnight", title: "XP of the sessions you worked in today, plus badges unlocked today" },
              {
                label: "Streak",
                value: `${streak.current} day${streak.current === 1 ? "" : "s"}`,
                sub: streak.atRisk ? "not yet today" : "skips weekends",
                title: "Active days in a row. A quiet Saturday or Sunday doesn't break it; a quiet weekday does.",
                tone: streak.atRisk ? "amber" : undefined,
              },
            ]}
          />
          <p className="xp-rules dim">
            <span title="Each session scores once per item, all history included. A running session's XP is provisional until it ends.">Earn XP per session:</span>
            {level.rules.map((r) => (
              <span key={r.label} className="mono">{r.label} <b>+{r.points}</b></span>
            ))}
            <span className="mono" title="Per tier reached, from a family's first: only badges that reward good practice (the ones in Next up) add XP">
              good-practice badge <b>+{level.stepXp.join(" / ")}</b>
            </span>
          </p>
        </PageSection>
      )}
      {badges && (
        <PageSection title="Next up" note="Claude Code · Closest badges that reward good practice">
          <NextUp families={badges.families} limit={6} />
        </PageSection>
      )}
      {badges && <Badges data={badges} fresh={fresh} />}
      <TopSessions sessions={allSessions} onSelectSession={onSelectSession} title="Records" />
    </div>
  );
}
