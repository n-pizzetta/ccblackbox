import type { Spike } from "../../utils/burnTracker";
import { formatCost, formatTokens } from "../../utils/format";

interface Props {
  spike: Spike;
  onInvestigate: () => void;
  onDismiss: () => void;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export function BurnSpikeBanner({ spike, onInvestigate, onDismiss }: Props) {
  const deltaText = `+${(spike.deltaPct * 100).toFixed(1)}pp`;
  const fromTo = `${(spike.fromPct * 100).toFixed(1)}% → ${(spike.toPct * 100).toFixed(1)}%`;
  const burnText = `${formatTokens(spike.deltaTokens)} · ${formatCost(spike.deltaCost)} burned`;
  return (
    <div
      className={`burn-spike-banner ${spike.critical ? "critical" : "warn"}`}
      role="alert"
    >
      <button className="burn-spike-banner-main" onClick={onInvestigate}>
        <span className="burn-spike-icon">🔥</span>
        <span className="burn-spike-title mono">Spike detected</span>
        <span className="burn-spike-meta mono dim">
          {formatClock(spike.fromMs)} → {formatClock(spike.toMs)} · {fromTo} of 5h limit · <strong>{deltaText}</strong> · {burnText}
        </span>
        <span className="burn-spike-cta mono">investigate →</span>
      </button>
      <button
        className="burn-spike-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss spike"
        title="Dismiss"
      >✕</button>
    </div>
  );
}
