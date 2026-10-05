import { useRateLimits } from "../utils/rateLimits";
import { useLiveContext } from "../utils/liveContext";

/** Status row for the usage limits bridge, plus a one-line fix when something is missing. */
export function LimitsSection() {
  const limits = useRateLimits();
  const connected = !!limits?.fiveHour || !!limits?.sevenDay;
  const contextLive = useLiveContext().length > 0;
  return (
    <>
      <div className="profile-row">
        <span className="profile-row-label">Usage limits</span>
        {connected ? (
          <span className="profile-row-value mono">
            <span className="profile-dot ok" aria-hidden="true" />
            {limits?.capturedAt ? "synced " + new Date(limits.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "connected"}
          </span>
        ) : (
          <span className="profile-row-value mono">
            <span className="profile-dot off" aria-hidden="true" />
            off
          </span>
        )}
      </div>
      {!connected && (
        <p className="profile-hint">
          Run <code>/marey:limits</code> in Claude Code to show your real 5h and 7-day limits.
        </p>
      )}
      {connected && !contextLive && (
        <p className="profile-hint">
          Context advice is waiting: re-run <code>/marey:limits</code>, then send a message.
        </p>
      )}
    </>
  );
}
