import { useEffect, useMemo, useState } from "react";
import type { Session } from "../../types";
import {
  costOfTokens,
  firstEventAfter,
  FIVE_HOUR_MS,
  PROJECT_PALETTE,
  OTHER_COLOR,
  resolveWindowStartMs,
  sumTokens,
  tokensInWindow,
} from "../../utils/fleetStats";
import { aggregateByPrompt, type PromptStats } from "../../utils/aggregateByPrompt";
import { loadWindowStart, saveWindowStart } from "../../utils/windowState";
import { formatCost, formatDuration, formatTokens } from "../../utils/format";
import { limitColor, type LimitWindow, type RateLimits } from "../../utils/rateLimits";

interface Props {
  sessions: Session[];
  limits: RateLimits | null;
  onSelectSession: (id: string) => void;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export function FiveHourSession({ sessions, limits, onSelectSession }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [windowStart, setWindowStart] = useState<number | null>(() => loadWindowStart());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const onWindow = () => setWindowStart(loadWindowStart());
    window.addEventListener("ccblackbox:window-changed", onWindow);
    window.addEventListener("storage", onWindow);
    return () => {
      window.removeEventListener("ccblackbox:window-changed", onWindow);
      window.removeEventListener("storage", onWindow);
    };
  }, []);
  // Exact window when Claude Code reported the reset time (status line wrapper).
  const realStart = limits?.fiveHour?.resetsAt ? limits.fiveHour.resetsAt - FIVE_HOUR_MS : null;

  // Fallback without real limits: persist an inferred anchor as soon as a new
  // message arrives after the previous window expired (or none was set yet).
  useEffect(() => {
    if (realStart !== null) return;
    if (windowStart && now < windowStart + FIVE_HOUR_MS) return;
    const lastExpiry = windowStart ? windowStart + FIVE_HOUR_MS : 0;
    const fresh = firstEventAfter(sessions, lastExpiry, now);
    if (fresh !== null && fresh !== windowStart) {
      saveWindowStart(fresh);
    }
  }, [realStart, windowStart, sessions, now]);

  const fromMs = useMemo(
    () => realStart ?? resolveWindowStartMs(sessions, windowStart, now),
    [realStart, sessions, windowStart, now],
  );
  const windowBurn = useMemo(
    () => fromMs !== null ? tokensInWindow(sessions, fromMs, now) : { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 },
    [sessions, fromMs, now],
  );
  const elapsed = fromMs !== null ? now - fromMs : 0;
  const sessionEnd = fromMs !== null ? fromMs + FIVE_HOUR_MS : 0;
  const resetIn = fromMs !== null ? Math.max(0, sessionEnd - now) : 0;
  const pct = limits?.fiveHour ? limits.fiveHour.usedPct / 100 : null;

  const totalTokens = sumTokens(windowBurn.tokens);

  // With real limits, attribute the used 5h % pro rata to cost (an estimate:
  // Anthropic weights usage per model). Otherwise, share of the window burn.
  const shareOf = (tokens: number, cost: number): number => {
    if (pct !== null) return windowBurn.cost > 0 ? (cost / windowBurn.cost) * pct * 100 : 0;
    return totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
  };
  const shareSuffix = pct !== null ? "of 5h limit (est.)" : "of window";

  const topSessions = useMemo<{ s: Session; burn: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost: number } }[]>(() => {
    if (fromMs === null) return [];
    const rows = sessions
      .map((s) => ({ s, burn: tokensInWindow([s], fromMs, now) }))
      .filter((r) => sumTokens(r.burn.tokens) > 0)
      .sort((a, b) => sumTokens(b.burn.tokens) - sumTokens(a.burn.tokens))
      .slice(0, 5);
    return rows;
  }, [sessions, fromMs, now]);

  const topPrompts = useMemo(() => {
    type Row = { session: Session; stat: PromptStats };
    if (fromMs === null) return [] as Row[];
    const all: Row[] = [];
    for (const s of sessions) {
      if (!s.turns || !s.prompts || s.turns.length === 0 || s.prompts.length === 0) continue;
      const startMs = new Date(s.startedAt).getTime();
      const stats = aggregateByPrompt(s.turns, s.model, s.prompts);
      for (const st of stats) {
        const stStart = startMs + st.t;
        const stEnd = startMs + (isFinite(st.endT) ? st.endT : st.t);
        if (stEnd < fromMs || stStart > now) continue;
        if (st.cost <= 0) continue;
        all.push({ session: s, stat: st });
      }
    }
    all.sort((a, b) => b.stat.cost - a.stat.cost);
    return all.slice(0, 5);
  }, [sessions, fromMs, now]);

  const toolsBreakdown = useMemo<{ tool: string; calls: number; tokens: number; cost: number }[]>(() => {
    if (fromMs === null) return [];
    const m = new Map<string, { calls: number; tokens: number; cost: number }>();
    for (const s of sessions) {
      if (!s.turns) continue;
      const startMs = new Date(s.startedAt).getTime();
      for (const t of s.turns) {
        const ts = startMs + t.t;
        if (ts < fromMs || ts > now) continue;
        if (t.tools.length === 0) continue;
        const turnTokens = sumTokens(t.tokens);
        const turnCost = costOfTokens(t.model ?? s.model, t.tokens);
        for (const tool of t.tools) {
          const cur = m.get(tool) ?? { calls: 0, tokens: 0, cost: 0 };
          cur.calls += 1;
          cur.tokens += turnTokens / t.tools.length;
          cur.cost += turnCost / t.tools.length;
          m.set(tool, cur);
        }
      }
    }
    return Array.from(m.entries())
      .map(([tool, v]) => ({ tool, ...v }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 6);
  }, [sessions, fromMs, now]);

  const projectSplit = useMemo<{ project: string; tokens: number; cost: number }[]>(() => {
    if (fromMs === null) return [];
    const allByProj = new Map<string, { tokens: number; cost: number }>();
    for (const s of sessions) {
      const burn = tokensInWindow([s], fromMs, now);
      const tk = sumTokens(burn.tokens);
      if (tk <= 0) continue;
      const key = s.project || "unknown";
      const cur = allByProj.get(key) ?? { tokens: 0, cost: 0 };
      cur.tokens += tk;
      cur.cost += burn.cost;
      allByProj.set(key, cur);
    }
    const arr = Array.from(allByProj.entries())
      .map(([project, v]) => ({ project, tokens: v.tokens, cost: v.cost }))
      .sort((a, b) => b.tokens - a.tokens);
    const top = arr.slice(0, 5);
    const rest = arr.slice(5);
    if (rest.length > 0) {
      top.push({
        project: `other (${rest.length})`,
        tokens: rest.reduce((a, r) => a + r.tokens, 0),
        cost: rest.reduce((a, r) => a + r.cost, 0),
      });
    }
    return top;
  }, [sessions, fromMs, now]);

  if (fromMs === null) {
    return (
      <div className="fleet-block five-hour-session five-hour-idle">
        <div className="section-title">
          <span>Current 5h session</span>
        </div>
        <span className="dim">Idle · waiting for the first message</span>
      </div>
    );
  }
  if (totalTokens === 0) {
    return (
      <div className="fleet-block five-hour-session five-hour-idle">
        <div className="section-title">
          <span>Current 5h session</span>
        </div>
        <span className="dim">Idle · no Claude Code activity in the last 5h</span>
      </div>
    );
  }

  const projectsTotal = projectSplit.reduce((a, p) => a + p.tokens, 0);

  return (
    <div className="fleet-block five-hour-session">
      <div className="section-title">
        <span>Current 5h session</span>
        <span className="dim mono tabular">
          started {formatClock(fromMs)} · {formatDuration(elapsed)} ago · resets in {formatDuration(resetIn)}
        </span>
      </div>

      <div className="five-hour-summary">
        <div className="five-hour-summary-metric">
          <div className="mono caps dim five-hour-metric-label">tokens</div>
          <div className="five-hour-metric-val tabular">{formatTokens(totalTokens)}</div>
        </div>
        <div className="five-hour-summary-metric">
          <div className="mono caps dim five-hour-metric-label">cost</div>
          <div className="five-hour-metric-val tabular" style={{ color: "var(--c-amber)" }}>{formatCost(windowBurn.cost)}</div>
        </div>
        {limits?.fiveHour && <LimitBar label="5h limit" window={limits.fiveHour} />}
        {limits?.sevenDay && <LimitBar label="7d limit" window={limits.sevenDay} />}
      </div>

      <div className="five-hour-grid">
        {/* Top sessions */}
        <div className="five-hour-card">
          <div className="five-hour-card-title mono caps dim">
            Top sessions <span className="five-hour-card-sub">· % {shareSuffix}</span>
          </div>
          {topSessions.length === 0 ? (
            <div className="placeholder mono dim">—</div>
          ) : (
            <div className="five-hour-rows">
              {topSessions.map((r) => {
                const tokens = sumTokens(r.burn.tokens);
                const share = shareOf(tokens, r.burn.cost);
                return (
                  <button key={r.s.id} className="five-hour-row" onClick={() => onSelectSession(r.s.id)}>
                    <span className="mono five-hour-row-name" title={r.s.goal || r.s.project}>{r.s.goal || r.s.project}</span>
                    <span className="mono dim five-hour-row-sub">{r.s.project}</span>
                    <span className="mono tabular right">{formatTokens(tokens)}</span>
                    <span className="mono dim tabular right" title={`${share.toFixed(2)}% ${shareSuffix}`}>
                      {share < 10 ? share.toFixed(1) : share.toFixed(0)}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Top prompts */}
        <div className="five-hour-card">
          <div className="five-hour-card-title mono caps dim">Top prompts</div>
          {topPrompts.length === 0 ? (
            <div className="placeholder mono dim">—</div>
          ) : (
            <div className="five-hour-rows">
              {topPrompts.map((r) => {
                const p = r.session.prompts?.[r.stat.promptIdx];
                return (
                  <button
                    key={`${r.session.id}-${r.stat.promptIdx}`}
                    className="five-hour-row"
                    onClick={() => onSelectSession(r.session.id)}
                  >
                    <span className="mono five-hour-row-name" title={p?.preview}>{p?.preview.slice(0, 60) || "—"}</span>
                    <span className="mono dim five-hour-row-sub">{r.session.project}</span>
                    <span className="mono tabular right" style={{ color: "var(--c-amber)" }}>{formatCost(r.stat.cost)}</span>
                    <span className="mono dim tabular right">{r.stat.turnCount}t</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Tools */}
        <div className="five-hour-card">
          <div className="five-hour-card-title mono caps dim">Tools</div>
          {toolsBreakdown.length === 0 ? (
            <div className="placeholder mono dim">—</div>
          ) : (
            <div className="five-hour-tools">
              {(() => {
                const max = Math.max(...toolsBreakdown.map((t) => t.calls));
                return toolsBreakdown.map((t) => {
                  const pctW = (t.calls / max) * 100;
                  return (
                    <div key={t.tool} className="five-hour-tool-row">
                      <span className="mono five-hour-tool-name" title={t.tool}>{t.tool}</span>
                      <div className="five-hour-tool-bar-wrap">
                        <div className="five-hour-tool-bar" style={{ width: `${pctW}%` }} />
                      </div>
                      <span className="mono tabular right">{t.calls}</span>
                      <span className="mono dim tabular right">{formatCost(t.cost)}</span>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* Projects */}
        <div className="five-hour-card">
          <div className="five-hour-card-title mono caps dim">
            Projects <span className="five-hour-card-sub">· % {shareSuffix}</span>
          </div>
          {projectSplit.length === 0 ? (
            <div className="placeholder mono dim">—</div>
          ) : (
            <>
              <div className="five-hour-project-bar">
                {projectSplit.map((p, i) => {
                  const w = projectsTotal > 0 ? (p.tokens / projectsTotal) * 100 : 0;
                  const color = p.project.startsWith("other") || i >= PROJECT_PALETTE.length
                    ? OTHER_COLOR
                    : PROJECT_PALETTE[i];
                  return (
                    <div
                      key={p.project}
                      className="five-hour-project-seg"
                      style={{ flex: w, background: color }}
                      title={`${p.project}: ${formatTokens(p.tokens)} (${w.toFixed(0)}%)`}
                    />
                  );
                })}
              </div>
              <div className="five-hour-project-list">
                {projectSplit.map((p, i) => {
                  const color = p.project.startsWith("other") || i >= PROJECT_PALETTE.length
                    ? OTHER_COLOR
                    : PROJECT_PALETTE[i];
                  const share = shareOf(p.tokens, p.cost);
                  return (
                    <div key={p.project} className="five-hour-project-row" title={`${p.project}: ${share.toFixed(2)}% ${shareSuffix}`}>
                      <span className="five-hour-project-swatch" style={{ background: color }} />
                      <span className="mono five-hour-project-name">{p.project}</span>
                      <span className="mono tabular right">{formatTokens(p.tokens)}</span>
                      <span className="mono dim tabular right">
                        {share < 10 ? share.toFixed(1) : share.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LimitBar({ label, window: w }: { label: string; window: LimitWindow }) {
  const frac = w.usedPct / 100;
  return (
    <div className="five-hour-summary-metric grow">
      <div className="mono caps dim five-hour-metric-label">{label}</div>
      <div className="five-hour-fill-bar-wrap">
        <div className="five-hour-fill-bar" style={{ width: `${Math.min(100, w.usedPct)}%`, background: limitColor(frac) }} />
      </div>
      <div className="five-hour-fill-txt mono tabular" style={{ color: limitColor(frac) }}>
        {w.usedPct.toFixed(0)}%
      </div>
    </div>
  );
}
