import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../../types";
import { activityStreak, healthScore, levelOf } from "../../utils/gamify";
import { formatTokens } from "../../utils/format";

interface Props {
  sessions: Session[];
  allSessions: Session[];
}

/** Eases a number toward `target` on change; snaps when the user prefers reduced motion. */
function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const v = origin + (target - origin) * (1 - (1 - p) ** 3);
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return reduced ? target : value;
}

function scoreColor(score: number): string {
  if (score >= 75) return "var(--c-green)";
  if (score >= 50) return "var(--c-amber)";
  return "var(--c-red)";
}

export function HeroBanner({ sessions, allSessions }: Props) {
  const score = useMemo(() => healthScore(sessions), [sessions]);
  const streak = useMemo(() => activityStreak(allSessions), [allSessions]);
  const level = useMemo(() => levelOf(allSessions), [allSessions]);

  const shownScore = useCountUp(score ?? 0);
  const shownStreak = useCountUp(streak, 500);

  const r = 30;
  const c = 2 * Math.PI * r;
  const frac = score === null ? 0 : Math.min(1, shownScore / 100);

  return (
    <div className="hero">
      <div className="hero-cell hero-score" title="Average quality score of the sessions in range">
        <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="6" />
          {score !== null && (
            <circle
              cx="38" cy="38" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 38 38)"
            />
          )}
        </svg>
        <span className="hero-score-num tabular">{score === null ? "—" : Math.round(shownScore)}</span>
        <div className="hero-text">
          <span className="hero-label">Health score</span>
          <span className="hero-sub">{score === null ? "no quality data yet" : "avg session quality"}</span>
        </div>
      </div>

      <div className="hero-cell" title="Consecutive days with activity">
        <span className="hero-flame" aria-hidden="true">🔥</span>
        <div className="hero-text">
          <span className="hero-big tabular">{Math.round(shownStreak)}<small>day{streak === 1 ? "" : "s"}</small></span>
          <span className="hero-label">Streak</span>
        </div>
      </div>

      <div className="hero-cell hero-level" title={`${formatTokens(level.total)} lifetime tokens · next level at ${formatTokens(level.nextAt)}`}>
        <div className="hero-text">
          <span className="hero-big">Lv {level.level}<small>{level.title}</small></span>
          <span className="hero-track" aria-hidden="true">
            <span style={{ width: `${Math.round(level.progress * 100)}%` }} />
          </span>
          <span className="hero-label tabular">{formatTokens(level.total)} / {formatTokens(level.nextAt)}</span>
        </div>
      </div>
    </div>
  );
}
