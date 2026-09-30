import { useRateLimits } from "../utils/rateLimits";

export function LimitsSection() {
  const limits = useRateLimits();
  const connected = !!limits?.fiveHour || !!limits?.sevenDay;
  return (
    <div className="settings-section">
      <div className="settings-label mono caps dim">Usage limits</div>
      {connected ? (
        <div className="mono dim limits-status">
          <span style={{ color: "var(--c-green)" }}>● connected</span>
          {limits?.capturedAt && <> · updated {new Date(limits.capturedAt).toLocaleTimeString()}</>}
        </div>
      ) : (
        <div className="mono dim limits-status">
          Not connected. Run <code>/ccblackbox:limits</code> in Claude Code (or{" "}
          <code>node scripts/install-statusline.mjs</code> from a clone) to show your real 5h and 7-day limits
          here.
        </div>
      )}
    </div>
  );
}
