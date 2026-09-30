import { useMemo } from "react";
import type { Session } from "../../types";

interface Props {
  sessions: Session[];
  limit?: number;
}

export function ToolsHeatmap({ sessions, limit = 8 }: Props) {
  const { rows, total } = useMemo(() => {
    const byTool = new Map<string, number>();
    for (const s of sessions) {
      for (const [tool, count] of Object.entries(s.toolCounts ?? {})) {
        byTool.set(tool, (byTool.get(tool) ?? 0) + count);
      }
    }
    const arr = Array.from(byTool.entries())
      .map(([tool, count]) => ({ tool, count }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
    // Shares are of all calls, not just the rows shown.
    return { rows: arr.slice(0, limit), total: arr.reduce((a, r) => a + r.count, 0) };
  }, [sessions, limit]);

  if (rows.length === 0) {
    return (
      <div className="fleet-block">
        <div className="section-title"><span>Tools</span></div>
        <div className="placeholder mono dim">No tool usage in range.</div>
      </div>
    );
  }

  const max = Math.max(...rows.map((r) => r.count));

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Tools · cross-session usage</span>
        <span className="dim mono tabular">{total} calls</span>
      </div>
      <div className="tools-heatmap">
        {rows.map((r) => {
          const pct = (r.count / max) * 100;
          const share = (r.count / total) * 100;
          return (
            <div key={r.tool} className="tools-heatmap-row">
              <span className="mono tools-heatmap-name" title={r.tool}>{r.tool}</span>
              <div className="tools-heatmap-bar-wrap">
                <div className="tools-heatmap-bar" style={{ width: `${pct}%` }} />
              </div>
              <span className="mono tabular right">{r.count}</span>
              <span className="mono dim tabular right">{share.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
