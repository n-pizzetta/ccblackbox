import { useMemo } from "react";
import type { Session } from "../../types";
import { computeBadges } from "../../utils/gamify";

interface Props {
  sessions: Session[];
}

export function Badges({ sessions }: Props) {
  const badges = useMemo(() => computeBadges(sessions), [sessions]);
  const unlocked = badges.filter((b) => b.unlocked).length;

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Badges</span>
        <span className="dim mono tabular">{unlocked}/{badges.length}</span>
      </div>
      <div className="badges">
        {badges.map((b) => (
          <div
            key={b.id}
            className={`badge ${b.unlocked ? "unlocked" : "locked"}`}
            title={`${b.name}: ${b.hint}${b.unlocked ? "" : ` (${b.progress}/${b.target})`}`}
          >
            <span className="badge-icon" aria-hidden="true">{b.icon}</span>
            <span className="badge-name">{b.name}</span>
            {b.unlocked ? (
              <span className="badge-state mono">unlocked</span>
            ) : (
              <>
                <span className="badge-track" aria-hidden="true">
                  <span style={{ width: `${(b.progress / b.target) * 100}%` }} />
                </span>
                <span className="badge-state mono tabular">{b.progress}/{b.target}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
