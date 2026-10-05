import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../../types";
import { healthReport } from "../../utils/healthRules";

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

/** Ring summary of utils/healthRules for the selected range. */
export function HealthScore({ sessions, allSessions }: Props) {
  const report = useMemo(() => healthReport(sessions, allSessions), [sessions, allSessions]);
  const score = report.total ? (report.passed / report.total) * 100 : null;

  const shownScore = useCountUp(score ?? 0);

  const r = 30;
  const c = 2 * Math.PI * r;
  const frac = score === null ? 0 : Math.min(1, shownScore / 100);

  return (
    <div className="hero">
      <div className="hero-cell hero-score" title="Health check rules passing in this range">
        <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="6" />
          {score !== null && (
            <circle
              cx="38" cy="38" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 38 38)"
            />
          )}
        </svg>
        <span className="hero-score-num tabular">{score === null ? "—" : `${report.passed}/${report.total}`}</span>
        <div className="hero-text">
          <span className="hero-label">Health score</span>
          <span className="hero-sub">{score === null ? "no data yet" : "checks passing"}</span>
        </div>
      </div>

    </div>
  );
}
