import { useMemo, useState } from "react";
import type { Session } from "../../types";
import { freshTokens } from "../../utils/units";
import { CATEGORIES, rankSessions, type Category } from "../../utils/gamify";
import { formatCost, formatDuration, formatTokens } from "../../utils/format";

interface Props {
  sessions: Session[];
  onSelectSession: (id: string) => void;
  limit?: number;
  title?: string;
}

const PLACE_CLASS = ["first", "second", "third"];
/** Visual order: 2nd, 1st, 3rd. */
const PODIUM_ORDER = [1, 0, 2];

const CAPTIONS: Record<Category, string> = {
  tokens: "fresh tokens",
  cost: "API value",
  duration: "longest stretch",
};

function formatValue(c: Category, v: number): string {
  switch (c) {
    case "tokens": return formatTokens(v);
    case "cost": return formatCost(v);
    case "duration": return formatDuration(v);
  }
}

export function TopSessions({ sessions, onSelectSession, limit = 10, title = "Top sessions" }: Props) {
  const [category, setCategory] = useState<Category>("tokens");
  const ranked = useMemo(() => rankSessions(sessions, category, limit), [sessions, category, limit]);
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  const max = ranked[0]?.value ?? 1;
  const active = CATEGORIES.find((c) => c.id === category)!;

  return (
    <div className="fleet-block podium-block">
      <div className="section-title">
        <span>{title}</span>
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
            {PODIUM_ORDER.filter((i) => podium[i]).map((i) => {
              const { s, value } = podium[i];
              return (
                <button
                  key={s.id}
                  className={`podium-card place-${PLACE_CLASS[i]}`}
                  onClick={() => onSelectSession(s.id)}
                >
                  {i === 0 && (
                    <span className="podium-glint" aria-hidden="true">
                      <span className="podium-glint-glow" />
                      <span className="podium-glint-line" />
                    </span>
                  )}
                  <span className="mono podium-project">{s.project}</span>
                  <span className="podium-goal">{s.goal || "—"}</span>
                  <span className="podium-value tabular">{formatValue(category, value)}</span>
                  <span className="podium-caption">{CAPTIONS[category]}</span>
                  <span className="podium-stats mono tabular">
                    {category !== "tokens" && <span>{formatTokens(freshTokens(s.tokens))}</span>}
                    {category !== "cost" && <span style={{ color: "var(--c-amber)" }}>{formatCost(s.costUsd)}</span>}
                    {category !== "duration" && <span>{formatDuration(s.durationMs)}</span>}
                  </span>
                  <span className="podium-pedestal" aria-hidden="true">{i + 1}</span>
                </button>
              );
            })}
          </div>

          {rest.length > 0 && (
            <div className="podium-rest" key={`rest-${category}`}>
              {rest.map(({ s, value }, i) => (
                <button key={s.id} className="podium-rest-row" onClick={() => onSelectSession(s.id)}>
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
