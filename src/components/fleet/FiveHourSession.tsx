import { useEffect, useMemo, useState } from "react";
import type { Session } from "../../types";
import {
  firstEventAfter,
  FIVE_HOUR_MS,
  OTHER_COLOR,
  PROJECT_PALETTE,
  projectColor,
  resolveWindowStartMs,
} from "../../utils/fleetStats";
import { windowBreakdown } from "../../utils/windowBreakdown";
import { loadWindowStart, saveWindowStart } from "../../utils/windowState";
import { formatCost, formatDuration, formatTokens } from "../../utils/format";
import type { RateLimits } from "../../utils/rateLimits";
import { KpiRow } from "../Kpi";
import { HotSpots } from "./HotSpots";

interface Props {
  sessions: Session[];
  limits: RateLimits | null;
  onSelectSession: (id: string) => void;
}

/** Each project's session-list color, unless an earlier one in the card took it: then the next free one. */
function distinctColors(projects: string[]): string[] {
  const used = new Set<string>();
  return projects.map((p) => {
    let color = p.startsWith("other (") ? OTHER_COLOR : projectColor(p);
    if (used.has(color)) color = PROJECT_PALETTE.find((c) => !used.has(c)) ?? OTHER_COLOR;
    used.add(color);
    return color;
  });
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
    window.addEventListener("marey:window-changed", onWindow);
    window.addEventListener("storage", onWindow);
    return () => {
      window.removeEventListener("marey:window-changed", onWindow);
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
  const pct = limits?.fiveHour ? limits.fiveHour.usedPct / 100 : null;
  // Rank by what the % column shows: API value against a known limit, else tokens.
  const weigh = pct !== null ? "cost" : "tokens";
  const data = useMemo(
    () => (fromMs !== null ? windowBreakdown(sessions, fromMs, now, weigh) : null),
    [sessions, fromMs, now, weigh],
  );
  const totalTokens = data?.total.tokens ?? 0;
  // While the window is idle, the hot spots fall back to today so the page still says what consumed most.
  const today = useMemo(
    () => (totalTokens === 0 ? windowBreakdown(sessions, new Date(now).setHours(0, 0, 0, 0), now) : null),
    [totalTokens, sessions, now],
  );
  const elapsed = fromMs !== null ? now - fromMs : 0;
  const sessionEnd = fromMs !== null ? fromMs + FIVE_HOUR_MS : 0;
  const resetIn = fromMs !== null ? Math.max(0, sessionEnd - now) : 0;

  // With real limits, attribute the used 5h % pro rata to cost (an estimate:
  // Anthropic weights usage per model). Otherwise, share of the window burn.
  const shareOf = (tokens: number, cost: number): number => {
    const windowCost = data?.total.cost ?? 0;
    if (pct !== null) return windowCost > 0 ? (cost / windowCost) * pct * 100 : 0;
    return totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
  };
  const shareSuffix = pct !== null ? "of 5h limit (est.)" : "of window";

  const topSessions = data?.sessions.slice(0, 5) ?? [];
  const topPrompts = data?.prompts.slice(0, 5) ?? [];
  const toolsBreakdown = data?.tools.slice(0, 6) ?? [];
  const projectSplit = useMemo(() => {
    const all = data?.projects ?? [];
    const top = all.slice(0, 5);
    const rest = all.slice(5);
    if (rest.length > 0) {
      top.push({
        project: `other (${rest.length})`,
        tokens: rest.reduce((a, r) => a + r.tokens, 0),
        cost: rest.reduce((a, r) => a + r.cost, 0),
      });
    }
    return top;
  }, [data]);

  if (fromMs === null || !data || totalTokens === 0) {
    return (
      <div className="fleet-block five-hour-session five-hour-idle">
        <div className="section-title">
          <span>Current 5h window</span>
          <span className="dim">{fromMs === null ? "Idle · waiting for the first message" : "Idle · no Claude Code activity in the last 5h"}</span>
        </div>
        {today && <HotSpots data={today} scope="today" limitPct={null} onSelectSession={onSelectSession} />}
      </div>
    );
  }

  const projectsTotal = projectSplit.reduce((a, p) => a + p[weigh], 0);
  const projectColors = distinctColors(projectSplit.map((p) => p.project));

  return (
    <div className="fleet-block five-hour-session">
      <div className="section-title">
        <span>Current 5h window</span>
        <span className="dim mono tabular">started {formatClock(fromMs)}</span>
      </div>

      <KpiRow
        items={[
          { label: "Tokens", value: formatTokens(totalTokens), sub: "all kinds, in this window" },
          { label: "API value", value: formatCost(data.total.cost), sub: pct !== null ? `${Math.round(pct * 100)}% of the 5h limit used` : "limit not reported" },
          { label: "Elapsed", value: formatDuration(elapsed), sub: "of 5h" },
          { label: "Resets in", value: formatDuration(resetIn), sub: `at ${formatClock(sessionEnd)}` },
        ]}
      />

      <HotSpots data={data} scope="window" limitPct={pct} onSelectSession={onSelectSession} />

      <div className="five-hour-grid">
        {/* Top sessions */}
        <div className="five-hour-card">
          <div className="five-hour-card-title">
            Top sessions <span className="five-hour-card-sub">· % {shareSuffix}</span>
          </div>
          {topSessions.length === 0 ? (
            <div className="placeholder mono dim">—</div>
          ) : (
            <div className="five-hour-rows">
              {topSessions.map((r) => {
                const share = shareOf(r.tokens, r.cost);
                return (
                  <button key={r.s.id} className="five-hour-row" onClick={() => onSelectSession(r.s.id)}>
                    <span className="mono five-hour-row-name" title={r.s.goal || r.s.project}>{r.s.goal || r.s.project}</span>
                    <span className="mono dim five-hour-row-sub">{r.s.project}</span>
                    <span className="mono tabular right">{formatTokens(r.tokens)}</span>
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
          <div className="five-hour-card-title">Top prompts</div>
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
          <div className="five-hour-card-title">Tools</div>
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
          <div className="five-hour-card-title">
            Projects <span className="five-hour-card-sub">· % {shareSuffix}</span>
          </div>
          {projectSplit.length === 0 ? (
            <div className="placeholder mono dim">—</div>
          ) : (
            <>
              <div className="five-hour-project-bar">
                {projectSplit.map((p, i) => {
                  const w = projectsTotal > 0 ? (p[weigh] / projectsTotal) * 100 : 0;
                  return (
                    <div
                      key={p.project}
                      className="five-hour-project-seg"
                      style={{ flex: w, background: projectColors[i] }}
                      title={`${p.project}: ${formatTokens(p.tokens)} · ${formatCost(p.cost)} (${w.toFixed(0)}% of the ${weigh === "cost" ? "API value" : "tokens"})`}
                    />
                  );
                })}
              </div>
              <div className="five-hour-project-list">
                {projectSplit.map((p, i) => {
                  const share = shareOf(p.tokens, p.cost);
                  return (
                    <div key={p.project} className="five-hour-project-row" title={`${p.project}: ${share.toFixed(2)}% ${shareSuffix}`}>
                      <span className="five-hour-project-swatch" style={{ background: projectColors[i] }} />
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
