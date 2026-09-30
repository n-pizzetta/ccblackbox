import { useMemo } from "react";
import type { Session } from "../../types";
import { sumTokens } from "../../utils/fleetStats";
import { formatCost, formatDuration, formatTokens } from "../../utils/format";

interface Props {
  sessions: Session[];
  onSelectSession: (id: string) => void;
  limit?: number;
}

function cacheHit(t: Session["tokens"]): number | null {
  const pool = t.input + t.cacheRead;
  if (pool < 10_000) return null;
  return t.cacheRead / pool;
}

function hitColor(hit: number): string {
  if (hit >= 0.9) return "var(--c-green)";
  if (hit >= 0.7) return "var(--c-amber)";
  return "var(--c-red)";
}

export function TopSessions({ sessions, onSelectSession, limit = 10 }: Props) {
  const ranked = useMemo(() => {
    return [...sessions]
      .map((s) => ({ s, total: sumTokens(s.tokens) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }, [sessions, limit]);

  if (ranked.length === 0) {
    return (
      <div className="fleet-block">
        <div className="section-title">
          <span>Top sessions by tokens</span>
        </div>
        <div className="placeholder mono dim">No token data in range.</div>
      </div>
    );
  }

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Top sessions by tokens</span>
        <span className="dim mono tabular">top {ranked.length}</span>
      </div>
      <div className="top-sessions">
        <div className="top-sessions-head mono dim caps">
          <span>#</span>
          <span>project</span>
          <span>goal</span>
          <span className="right">tokens</span>
          <span className="right">cost</span>
          <span className="right">duration</span>
          <span className="right">cache hit</span>
        </div>
        {ranked.map((r, i) => {
          const hit = cacheHit(r.s.tokens);
          return (
            <button key={r.s.id} className="top-sessions-row" onClick={() => onSelectSession(r.s.id)}>
              <span className="mono dim tabular">{i + 1}</span>
              <span className="mono top-sessions-project">{r.s.project}</span>
              <span className="top-sessions-goal">{r.s.goal || "—"}</span>
              <span className="mono tabular right">{formatTokens(r.total)}</span>
              <span className="mono tabular right" style={{ color: "var(--c-amber)" }}>{formatCost(r.s.costUsd)}</span>
              <span className="mono tabular right dim">{formatDuration(r.s.durationMs)}</span>
              <span
                className="mono tabular right"
                style={{ color: hit !== null ? hitColor(hit) : "var(--c-text-faint)" }}
                title={hit !== null ? `cacheRead / (cacheRead + input) = ${formatTokens(r.s.tokens.cacheRead)} / ${formatTokens(r.s.tokens.cacheRead + r.s.tokens.input)}` : "not enough input data"}
              >
                {hit !== null ? `${(hit * 100).toFixed(0)}%` : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
