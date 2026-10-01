import { useMemo, useState } from "react";
import type { Session } from "../../types";
import { freshTokens } from "../../utils/units";
import { CATEGORIES, cacheHit, rankSessions, type Category } from "../../utils/gamify";
import { formatCost, formatDuration, formatTokens } from "../../utils/format";
import { FireCanvas, HeatFilter } from "./FireCanvas";

interface Props {
  sessions: Session[];
  onSelectSession: (id: string) => void;
  limit?: number;
}

const PLACE_CLASS = ["first", "second", "third"];
/** Visual order: 2nd, 1st, 3rd. */
const PODIUM_ORDER = [1, 0, 2];

const CAPTIONS: Record<Category, string> = {
  tokens: "fresh tokens",
  cost: "API value",
  efficiency: "cache hit",
  duration: "active time",
};

function formatValue(c: Category, v: number): string {
  switch (c) {
    case "tokens": return formatTokens(v);
    case "cost": return formatCost(v);
    case "efficiency": return `${(v * 100).toFixed(0)}%`;
    case "duration": return formatDuration(v);
  }
}

function hitColor(hit: number): string {
  if (hit >= 0.9) return "var(--c-green)";
  if (hit >= 0.7) return "var(--c-amber)";
  return "var(--c-red)";
}

function HitRing({ hit }: { hit: number | null }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <svg className="hit-ring" width="22" height="22" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="3" />
      {hit !== null && (
        <circle
          cx="14" cy="14" r={r} fill="none" stroke={hitColor(hit)} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${c * hit} ${c}`} transform="rotate(-90 14 14)"
        />
      )}
    </svg>
  );
}

function details(s: Session): string {
  const hit = cacheHit(s.tokens);
  return `${formatTokens(freshTokens(s.tokens))} fresh tokens · ${formatCost(s.costUsd)} API value · ${formatDuration(s.durationMs)} · cache hit ${hit !== null ? `${(hit * 100).toFixed(0)}%` : "—"}`;
}

export function TopSessions({ sessions, onSelectSession, limit = 10 }: Props) {
  const [category, setCategory] = useState<Category>("tokens");
  const ranked = useMemo(() => rankSessions(sessions, category, limit), [sessions, category, limit]);
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  const max = ranked[0]?.value ?? 1;
  const active = CATEGORIES.find((c) => c.id === category)!;

  return (
    <div className="fleet-block podium-block">
      <div className="section-title">
        <span>Top sessions</span>
        <div className="podium-tabs" role="group" aria-label="Ranking category">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`podium-tab ${c.id === category ? "active" : ""}`}
              aria-pressed={c.id === category}
              title={c.title}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="placeholder mono dim">No data for “{active.title.toLowerCase()}” in range.</div>
      ) : (
        <>
          {/* key restarts the rise animation when the category changes */}
          <div className="podium" key={category}>
            <HeatFilter />
            {PODIUM_ORDER.filter((i) => podium[i]).map((i) => {
              const { s, value } = podium[i];
              const hit = cacheHit(s.tokens);
              return (
                <button
                  key={s.id}
                  className={`podium-card place-${PLACE_CLASS[i]}`}
                  onClick={() => onSelectSession(s.id)}
                  title={details(s)}
                >
                  {i === 0 && <FireCanvas />}
                  <span className="mono podium-project">{s.project}</span>
                  <span className="podium-goal">{s.goal || "—"}</span>
                  <span className="podium-value tabular">{formatValue(category, value)}</span>
                  <span className="podium-caption">{CAPTIONS[category]}</span>
                  <span className="podium-stats mono tabular">
                    {category !== "tokens" && <span>{formatTokens(freshTokens(s.tokens))}</span>}
                    {category !== "cost" && <span style={{ color: "var(--c-amber)" }}>{formatCost(s.costUsd)}</span>}
                    {category !== "duration" && <span>{formatDuration(s.durationMs)}</span>}
                    {category !== "efficiency" && hit !== null && (
                      <span className="podium-cache" title="Cache hit: share of input tokens served from the prompt cache">
                        <HitRing hit={hit} />
                        <span>cache {(hit * 100).toFixed(0)}%</span>
                      </span>
                    )}
                  </span>
                  <span className="podium-pedestal" aria-hidden="true">{i + 1}</span>
                </button>
              );
            })}
          </div>

          {rest.length > 0 && (
            <div className="podium-rest" key={`rest-${category}`}>
              {rest.map(({ s, value }, i) => (
                <button key={s.id} className="podium-rest-row" onClick={() => onSelectSession(s.id)} title={details(s)}>
                  <span className="mono dim tabular podium-rest-rank">{i + 4}</span>
                  <span className="podium-rest-main">
                    <span className="podium-rest-goal">{s.goal || "—"}</span>
                    <span className="mono dim podium-rest-project">{s.project}</span>
                  </span>
                  <span className="podium-rest-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
                  </span>
                  <span className="mono tabular podium-rest-value">{formatValue(category, value)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
