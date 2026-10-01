import { useRateLimits } from "../utils/rateLimits";
import { useLiveContext } from "../utils/liveContext";

export function LimitsSection() {
  const limits = useRateLimits();
  const connected = !!limits?.fiveHour || !!limits?.sevenDay;
  const contextLive = useLiveContext().length > 0;
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
      {connected && (
        <div className="mono dim limits-status">
          {contextLive ? (
            <span style={{ color: "var(--c-green)" }}>● context advice active</span>
          ) : (
            <>
              Context advice waits for a snapshot: re-run <code>/ccblackbox:limits</code> to refresh the wrapper, then send a
              message.
            </>
          )}
        </div>
      )}
    </div>
  );
}
