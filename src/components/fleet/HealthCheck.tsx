import { useMemo } from "react";
import type { Session } from "../../types";
import { healthReport, type RuleStatus } from "../../utils/healthRules";
import "../../health.css";

interface Props {
  sessions: Session[];
  allSessions: Session[];
  onSelectSession: (id: string) => void;
}

const MARK: Record<RuleStatus, string> = { pass: "✓", warn: "!", fail: "✗", na: "–" };

function scoreColor(frac: number): string {
  if (frac >= 0.75) return "var(--c-green)";
  if (frac >= 0.5) return "var(--c-amber)";
  return "var(--c-red)";
}

/** Small ring + "5/9 passing": the health score, in the checklist's own heading. */
function ScoreRing({ passed, total }: { passed: number; total: number }) {
  const frac = total ? passed / total : 0;
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span className="health-score mono tabular" title="Health check rules passing in this scope">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="3" />
        <circle cx="9" cy="9" r={r} fill="none" stroke={scoreColor(frac)} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      {passed}/{total} passing
    </span>
  );
}

/** Checklist view of utils/healthRules, score in the heading: one row per rule, failing sessions one click away. */
export function HealthCheck({ sessions, allSessions, onSelectSession }: Props) {
  const report = useMemo(() => healthReport(sessions, allSessions), [sessions, allSessions]);
  const byId = useMemo(() => new Map(allSessions.map((s) => [s.id, s])), [allSessions]);

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Health check</span>
        {report.total > 0 && <ScoreRing passed={report.passed} total={report.total} />}
      </div>
      <ul className="health-rules">
        {report.rules.map((r) => (
          <li key={r.id} className={`health-rule status-${r.status}`}>
            <span className="health-mark mono" aria-label={r.status}>{MARK[r.status]}</span>
            <div className="health-body">
              <div className="health-head">
                <span className="health-name">{r.name}</span>
                <span className="health-value mono tabular">{r.value}</span>
                <span className="health-target dim">{r.target}</span>
              </div>
              <p className="health-why dim">{r.why}</p>
              {r.status !== "pass" && r.status !== "na" && (
                <>
                  <p className="health-hint">{r.hint}</p>
                  {r.sessionIds.length > 0 && (
                    <div className="health-sessions">
                      {r.sessionIds.map((id) => {
                        const s = byId.get(id);
                        return (
                          <button key={id} className="health-session mono" onClick={() => onSelectSession(id)} title={s?.goal}>
                            {s ? `${s.project} · ${new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : id.slice(0, 8)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
