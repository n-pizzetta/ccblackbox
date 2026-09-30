import { useEffect, useState } from "react";
import type { Session } from "../../types";
import { activeSessions, tokensInWindow, sumTokens } from "../../utils/fleetStats";
import { formatCost, formatDuration, formatTokens } from "../../utils/format";
import { limitColor, type RateLimits } from "../../utils/rateLimits";

interface Props {
  sessions: Session[];
  limits: RateLimits | null;
}

export function LiveTicker({ sessions, limits }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const active = activeSessions(sessions, 5 * 60_000, now);
  const lastMinute = tokensInWindow(sessions, now - 60_000, now);
  const tokensPerMin = sumTokens(lastMinute.tokens);
  const costPerMin = lastMinute.cost;

  const five = limits?.fiveHour;
  const week = limits?.sevenDay;

  return (
    <div className="live-ticker">
      <div className={`live-ticker-cell ${active.length > 0 ? "pulse" : ""}`}>
        <div className="live-ticker-num tabular">{active.length}</div>
        <div className="live-ticker-label mono caps dim">active</div>
        <div className="live-ticker-sub mono dim">{active.length === 0 ? "no live sessions" : `${active.length} session${active.length > 1 ? "s" : ""} ticking`}</div>
      </div>
      <div className="live-ticker-sep" />
      <div className="live-ticker-cell">
        <div className="live-ticker-num tabular">{formatTokens(tokensPerMin)}</div>
        <div className="live-ticker-label mono caps dim">tokens / min</div>
        <div className="live-ticker-sub mono dim">last 60 s window</div>
      </div>
      <div className="live-ticker-sep" />
      <div className="live-ticker-cell">
        <div className="live-ticker-num tabular" style={{ color: costPerMin > 0 ? "var(--c-amber)" : undefined }}>
          {formatCost(costPerMin)}
        </div>
        <div className="live-ticker-label mono caps dim">$ / min</div>
        <div className="live-ticker-sub mono dim">burn rate · last 60 s</div>
      </div>
      {five && (
        <>
          <div className="live-ticker-sep" />
          <div className="live-ticker-cell">
            <div className="live-ticker-num tabular" style={{ color: limitColor(five.usedPct / 100) }}>
              {Math.round(five.usedPct)}%
            </div>
            <div className="live-ticker-label mono caps dim">5h limit</div>
            <div className="live-ticker-sub mono dim">
              {five.resetsAt ? `resets in ${formatDuration(Math.max(0, five.resetsAt - now))}` : "window reset"}
              {week && ` · 7d ${Math.round(week.usedPct)}%`}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
