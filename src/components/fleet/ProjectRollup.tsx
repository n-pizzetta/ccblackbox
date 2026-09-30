import { useMemo } from "react";
import type { Session } from "../../types";
import { sumTokens, PROJECT_PALETTE, OTHER_COLOR } from "../../utils/fleetStats";
import { formatCost, formatTokens } from "../../utils/format";

interface Props {
  sessions: Session[];
  limit?: number;
}

export function ProjectRollup({ sessions, limit = 5 }: Props) {
  const rows = useMemo(() => {
    const byProj = new Map<string, { tokens: number; cost: number; count: number }>();
    for (const s of sessions) {
      const key = s.project || "unknown";
      const prev = byProj.get(key) ?? { tokens: 0, cost: 0, count: 0 };
      prev.tokens += sumTokens(s.tokens);
      prev.cost += s.costUsd;
      prev.count += 1;
      byProj.set(key, prev);
    }
    const arr = Array.from(byProj.entries())
      .map(([project, v]) => ({ project, ...v }))
      .filter((r) => r.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);
    const top = arr.slice(0, limit);
    const rest = arr.slice(limit);
    if (rest.length > 0) {
      top.push({
        project: `other (${rest.length})`,
        tokens: rest.reduce((a, r) => a + r.tokens, 0),
        cost: rest.reduce((a, r) => a + r.cost, 0),
        count: rest.reduce((a, r) => a + r.count, 0),
      });
    }
    return top;
  }, [sessions, limit]);

  if (rows.length === 0) {
    return (
      <div className="fleet-block">
        <div className="section-title"><span>Projects</span></div>
        <div className="placeholder mono dim">No project data.</div>
      </div>
    );
  }

  const total = rows.reduce((a, r) => a + r.tokens, 0);
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Projects · tokens & cost</span>
        <span className="dim mono tabular">{rows.length}</span>
      </div>
      <div className="project-rollup">
        <div className="project-rollup-bar">
          {rows.map((r, i) => {
            const pct = (r.tokens / total) * 100;
            const color = i >= PROJECT_PALETTE.length || r.project.startsWith("other") ? OTHER_COLOR : PROJECT_PALETTE[i];
            return (
              <div
                key={r.project}
                className="project-rollup-seg"
                style={{ flex: pct, background: color }}
                title={`${r.project}: ${formatTokens(r.tokens)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
        <div className="project-rollup-list">
          {rows.map((r, i) => {
            const color = i >= PROJECT_PALETTE.length || r.project.startsWith("other") ? OTHER_COLOR : PROJECT_PALETTE[i];
            const pct = (r.tokens / total) * 100;
            const costPct = totalCost > 0 ? (r.cost / totalCost) * 100 : 0;
            return (
              <div key={r.project} className="project-rollup-row">
                <span className="project-rollup-swatch" style={{ background: color }} />
                <span className="mono project-rollup-name">{r.project}</span>
                <span className="mono dim tabular">{r.count} session{r.count > 1 ? "s" : ""}</span>
                <span className="mono tabular right">{formatTokens(r.tokens)}</span>
                <span className="mono dim tabular right">{pct.toFixed(1)}%</span>
                <span className="mono tabular right" style={{ color: "var(--c-amber)" }}>{formatCost(r.cost)}</span>
                <span className="mono dim tabular right">{costPct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
