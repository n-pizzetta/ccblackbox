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

/** Checklist view of utils/healthRules: one row per rule, failing sessions one click away. */
export function HealthCheck({ sessions, allSessions, onSelectSession }: Props) {
  const report = useMemo(() => healthReport(sessions, allSessions), [sessions, allSessions]);
  const byId = useMemo(() => new Map(allSessions.map((s) => [s.id, s])), [allSessions]);

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Health check</span>
        <span className="dim mono tabular">{report.passed}/{report.total} passing</span>
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
