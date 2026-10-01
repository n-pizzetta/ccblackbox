import { useEffect, useMemo, useState } from "react";
import { adviseContext, fmtLeft, THRESHOLDS, type ContextAdvice, type ContextSnapshot } from "../../../scripts/context-advice.mjs";
import type { Session } from "../../types";
import { projectColor } from "../../utils/fleetStats";
import { formatTokens } from "../../utils/format";
import { useLiveContext } from "../../utils/liveContext";
import "../../context.css";

interface Props {
  sessions: Session[];
  onSelectSession: (id: string) => void;
}

const SHOWN = 3;
/** A snapshot stops being "live" once nothing refreshed it for this long, but its cache countdown stays valid. */
const STALE_MS = 6 * 3_600_000;

const LEVEL_COLOR = { ok: "var(--c-green)", watch: "var(--c-amber)", act: "var(--c-red)" } as const;

function ringColor(usedPct: number | null): string {
  if (usedPct === null) return "var(--c-text-faint)";
  if (usedPct >= THRESHOLDS.act) return "var(--c-red)";
  if (usedPct >= THRESHOLDS.watch) return "var(--c-amber)";
  return "var(--c-cyan)";
}

function Ring({ pct }: { pct: number | null }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, (pct ?? 0) / 100);
  return (
    <span className="ctx-ring">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={ringColor(pct)} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="ctx-ring-num tabular">{pct === null ? "—" : `${pct}%`}</span>
    </span>
  );
}

function CacheChip({ advice }: { advice: ContextAdvice }) {
  const { state, secsLeft, ttl } = advice.cache;
  if (state === "unknown") return <span className="ctx-chip">cache unknown</span>;
  if (state === "cold") return <span className="ctx-chip cold">cache cold</span>;
  const soon = secsLeft !== null && secsLeft < THRESHOLDS.expiringSoon;
  return (
    <span className={`ctx-chip warm ${soon ? "soon" : ""}`} title={ttl ? `Prompt cache ttl ${ttl}` : undefined}>
      cache warm{secsLeft !== null ? ` · ${fmtLeft(secsLeft)} left` : ""}
    </span>
  );
}

function ContextCard({ snap, session, now, onSelectSession }: { snap: ContextSnapshot; session?: Session; now: number; onSelectSession: (id: string) => void }) {
  const advice = adviseContext(snap, now);
  const idleMs = now - snap.capturedAt;
  const color = LEVEL_COLOR[advice.level];
  const title = session?.goal || (snap.model ? `${snap.model} session` : "Session");
  return (
    <div className={`ctx-card level-${advice.level}`}>
      <Ring pct={advice.context.usedPct} />
      <div className="ctx-main">
        <div className="ctx-title-row">
          {session && (
            <button className="ctx-title" onClick={() => onSelectSession(session.id)} title="Open session">{title}</button>
          )}
          {!session && <span className="ctx-title static">{title}</span>}
          {session?.project && (
            <span className="proj-pill" style={{ "--pc": projectColor(session.project) } as React.CSSProperties}>{session.project}</span>
          )}
        </div>
        <div className="ctx-facts mono tabular">
          <span>
            {formatTokens(advice.context.tokens)}
            {advice.context.size ? ` / ${formatTokens(advice.context.size)}` : ""} tokens
          </span>
          <CacheChip advice={advice} />
          {advice.cache.recacheTokens !== null && advice.cache.state !== "unknown" && (
            <span className="dim" title="Tokens re-cached by the next message if the cache is cold">
              cold start ≈ {formatTokens(advice.cache.recacheTokens)} tokens
            </span>
          )}
          {idleMs > 60_000 && <span className="dim">last activity {fmtLeft(idleMs / 1000)} ago</span>}
        </div>
        <ul className="ctx-reasons">
          {advice.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
      <div className="ctx-verdict" style={{ "--vc": color } as React.CSSProperties}>
        <span className="ctx-verdict-dot" />
        <span className="ctx-verdict-label">{advice.label}</span>
      </div>
    </div>
  );
}

/** Per live session: how full the context is, how warm the prompt cache is, and what to do about it. */
export function ContextCards({ sessions, onSelectSession }: Props) {
  const snaps = useLiveContext();
  const [now, setNow] = useState(() => Date.now());
  const [all, setAll] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const fresh = snaps.filter((s) => now - s.capturedAt < STALE_MS);
  const visible = all ? fresh : fresh.slice(0, SHOWN);

  if (fresh.length === 0) {
    return (
      <div className="fleet-block">
        <div className="section-title"><span>Context &amp; cache</span></div>
        <div className="ctx-empty mono dim">
          No live context data yet. It appears after the next Claude Code turn once the status line wrapper is up to date:
          run <code>/ccblackbox:limits</code> to refresh it.
        </div>
      </div>
    );
  }

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Context &amp; cache</span>
        <span className="dim mono tabular" title="Verdicts are heuristics based on context fill and prompt-cache state">
          {fresh.length} session{fresh.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="ctx-list">
        {visible.map((snap) => (
          <ContextCard key={snap.sessionId} snap={snap} session={byId.get(snap.sessionId)} now={now} onSelectSession={onSelectSession} />
        ))}
      </div>
      {fresh.length > SHOWN && (
        <button className="live-cards-more" onClick={() => setAll((v) => !v)}>
          {all ? "show less" : `+${fresh.length - SHOWN} more`}
        </button>
      )}
    </div>
  );
}
