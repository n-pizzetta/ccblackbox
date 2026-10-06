import type { Session } from "../types";
import { useSnapshotMap } from "../utils/liveContext";
import { useNow } from "../utils/useNow";
import { ContextSummary } from "./ContextCard";

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${String(rem).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

/** What a live session is doing: the running tool or its idle state, time since the last event, the prompt it is on. */
function LiveState({ session }: { session: Session }) {
  const now = useNow(1000);
  const lastTs = session.lastEventAt ? Date.parse(session.lastEventAt) : now;
  const elapsed = Math.max(0, now - lastTs);
  const running = session.runningTool;
  const prompts = session.prompts ?? [];
  const turns = session.turns ?? [];
  const lastPromptIdx = prompts.length - 1;
  const lastPrompt = lastPromptIdx >= 0 ? prompts[lastPromptIdx] : null;
  const turnsOnLast = lastPrompt ? turns.filter((t) => t.promptIdx === lastPromptIdx).length : 0;

  let kind: "tool" | "thinking" | "done" | "idle";
  let label: string;
  let hint: string | null = null;
  if (running) {
    kind = "tool";
    label = `Running ${running.tool}`;
  } else if (elapsed < 5_000) {
    kind = "thinking";
    label = "Claude is thinking";
  } else if (elapsed < 30_000) {
    kind = "done";
    label = "Turn complete";
  } else {
    kind = "idle";
    label = "Idle";
    hint = "waiting for input";
  }

  return (
    <div className={`status-live ${kind}`}>
      <span className="live-dot" aria-hidden="true" />
      <strong className="status-label">
        {label}
        {hint && <span className="status-hint"> — {hint}</span>}
      </strong>
      <span className="status-elapsed tabular" title="Time since the last event in the transcript">
        {formatElapsed(elapsed)}
        <span className="status-elapsed-words"> since last event</span>
      </span>
      {running && (
        <code className="status-input mono" title={running.preview}>
          {running.preview.slice(0, 140)}
        </code>
      )}
      {lastPrompt && (
        <span className="status-prompt tabular" title={lastPrompt.preview}>
          Prompt <b>#{lastPromptIdx + 1}</b>
          <span className="status-sep"> · </span>
          <b>{turnsOnLast}</b> turn{turnsOnLast === 1 ? "" : "s"} so far
        </span>
      )}
      {lastPrompt && !running && (
        <span className="status-prompt-text" title={lastPrompt.preview}>
          {lastPrompt.preview.slice(0, 100)}
        </span>
      )}
    </div>
  );
}

/**
 * One strip above the session tabs: the live state (live sessions) and the context / prompt-cache
 * snapshot with its verdict (any session the status line wrapper reported on recently).
 */
export function SessionStatus({ session }: { session: Session }) {
  const snap = useSnapshotMap().get(session.id);
  if (!session.live && !snap) return null;
  return (
    <div className="status-strip">
      {session.live && <LiveState session={session} />}
      {snap && <ContextSummary snap={snap} />}
    </div>
  );
}
