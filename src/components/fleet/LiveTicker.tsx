import { useEffect, useState } from "react";
import type { Session } from "../../types";
import { activeSessions, tokensInWindow } from "../../utils/fleetStats";
import { formatCost, formatTokens } from "../../utils/format";
import { freshTokens } from "../../utils/units";

interface Props {
  sessions: Session[];
}

/** One line of live burn: running sessions and what the last minute cost. */
export function LiveTicker({ sessions }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const active = activeSessions(sessions, 5 * 60_000, now).length;
  const lastMinute = tokensInWindow(sessions, now - 60_000, now);
  const freshPerMin = freshTokens(lastMinute.tokens);

  return (
    <div className={`live-burn ${active > 0 ? "on" : ""}`} title="Last 60 seconds, selected providers. API value is a relative weight, not a bill.">
      <span className="live-burn-dot" aria-hidden="true" />
      <span>{active === 0 ? "no live session" : `${active} live session${active > 1 ? "s" : ""}`}</span>
      <span className="mono tabular">{formatTokens(freshPerMin)} fresh tokens / min</span>
      <span className="mono tabular">{formatCost(lastMinute.cost)} API / min</span>
    </div>
  );
}
