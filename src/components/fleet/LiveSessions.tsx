import { useEffect, useState } from "react";
import type { Session } from "../../types";
import { activeSessions, sumTokens, tokensInWindow } from "../../utils/fleetStats";
import { formatCost, formatDuration, formatTokens } from "../../utils/format";

const BURN_WINDOW_MS = 60_000;
const COLLAPSED_COUNT = 4;

function recentBurn(s: Session, now: number): number {
  const w = tokensInWindow([s], now - BURN_WINDOW_MS, now);
  return sumTokens(w.tokens);
}

interface Props {
  sessions: Session[];
  onSelectSession: (id: string) => void;
}

function SparkLine({ turns }: { turns: NonNullable<Session["turns"]> }) {
  const last = turns.slice(-30);
  if (last.length === 0) return null;
  const values = last.map((t) => sumTokens(t.tokens));
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 28;
  const step = last.length > 1 ? w / (last.length - 1) : 0;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg className="live-card-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke="var(--c-green)" strokeWidth="1.5" points={points} />
    </svg>
  );
}

export function LiveSessions({ sessions, onSelectSession }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  const active = activeSessions(sessions, 5 * 60_000, now)
    .map((s) => ({ s, burn: recentBurn(s, now), total: sumTokens(s.tokens) }))
    .sort((a, b) => {
      const aBurning = a.burn > 0;
      const bBurning = b.burn > 0;
      if (aBurning !== bBurning) return aBurning ? -1 : 1;
      if (aBurning && bBurning) return b.burn - a.burn;
      return b.total - a.total;
    })
    .map((x) => x.s);
  const [expanded, setExpanded] = useState(false);
  const canCollapse = active.length > COLLAPSED_COUNT;
  const visible = expanded || !canCollapse ? active : active.slice(0, COLLAPSED_COUNT);

  if (active.length === 0) {
    return (
      <div className="fleet-block">
        <div className="section-title">
          <span>Live sessions</span>
          <span className="dim mono">none</span>
        </div>
        <div className="placeholder mono dim">No active sessions right now. Start a Claude Code prompt in any project to see it light up here.</div>
      </div>
    );
  }

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Live sessions</span>
        <span className="dim mono tabular">{active.length}</span>
      </div>
      <div className="live-cards">
          {visible.map((s) => {
          // The process can be older than the transcript (resumed or /clear-ed sessions).
          const uptime = now - new Date(s.processStartedAt ?? s.startedAt).getTime();
          const forgotten = uptime > 24 * 3_600_000;
          const lastEvt = s.lastEventAt ? now - new Date(s.lastEventAt).getTime() : null;
          const stale = lastEvt !== null && lastEvt > 30 * 60_000;
          const burn = recentBurn(s, now);
          return (
            <button key={s.id} className={`live-card ${stale ? "stale" : ""} ${burn > 0 ? "burning" : ""}`} onClick={() => onSelectSession(s.id)}>
              <div className="live-card-head">
                <span className="live-dot" />
                <span className="mono live-card-project">{s.project}</span>
                {burn > 0 && (
                  <span className="live-card-burn mono caps" title={`${formatTokens(burn)} tokens in last ${BURN_WINDOW_MS / 1000}s`}>
                    🔥 {formatTokens(burn)}/{BURN_WINDOW_MS / 1000}s
                  </span>
                )}
                <span
                  className={`mono live-card-uptime tabular ${forgotten ? "forgotten" : "dim"}`}
                  title={`Process running for ${formatDuration(uptime)}${s.version ? ` · Claude Code ${s.version}` : ""}${forgotten ? " · over 24h: forgotten?" : ""}`}
                >
                  {formatDuration(uptime)}
                </span>
              </div>
              <div className="live-card-goal">{s.goal || "session"}</div>
              {s.runningTool && (
                <div className="live-card-tool mono dim">
                  <span className="live-tool-name">{s.runningTool.tool}</span>
                  {" · "}
                  <span className="live-tool-preview">{s.runningTool.preview.slice(0, 80)}</span>
                </div>
              )}
              <div className="live-card-foot">
                <span className="mono tabular">{formatTokens(sumTokens(s.tokens))}</span>
                <span className="mono dim"> tokens</span>
                <span className="live-card-sep" />
                <span className="mono tabular" style={{ color: "var(--c-amber)" }}>{formatCost(s.costUsd)}</span>
                {s.turns && s.turns.length > 0 && <SparkLine turns={s.turns} />}
              </div>
            </button>
          );
        })}
      </div>
      {canCollapse && (
        <button className="live-cards-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Show fewer" : `Show all ${active.length}`}
        </button>
      )}
    </div>
  );
}
