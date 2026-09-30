import type { Session } from "../types";
import { estimateHint, formatDuration, formatTokens, formatCost, outcomeColor, outcomeLabel } from "../utils/format";
import { modelLabel } from "../../scripts/models.mjs";

interface Props {
  sessions: Session[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onPick: (id: string) => void;
}

const ROWS: Array<{
  label: string;
  get: (s: Session) => React.ReactNode;
  highlight?: "max" | "min";
  num?: (s: Session) => number;
}> = [
  { label: "Project", get: (s) => <span className="mono">{s.project}</span> },
  { label: "Goal", get: (s) => <span title={s.goal} className="compare-goal">{s.goal}</span> },
  {
    label: "Outcome",
    get: (s) => (
      <span className="mono" style={{ color: outcomeColor(s.outcome) }}>
        {s.ghost ? "ghost" : outcomeLabel(s.outcome)}
      </span>
    ),
  },
  { label: "Model", get: (s) => <span className="mono">{modelLabel(s.model)}</span> },
  {
    label: "Duration",
    get: (s) => <span className="mono tabular">{formatDuration(s.durationMs)}</span>,
    num: (s) => s.durationMs,
    highlight: "max",
  },
  {
    label: "Tokens in",
    get: (s) => <span className="mono tabular">{formatTokens(s.tokens.input)}</span>,
    num: (s) => s.tokens.input,
    highlight: "max",
  },
  {
    label: "Tokens out",
    get: (s) => <span className="mono tabular">{formatTokens(s.tokens.output)}</span>,
    num: (s) => s.tokens.output,
    highlight: "max",
  },
  {
    label: "Cache read",
    get: (s) => <span className="mono tabular">{formatTokens(s.tokens.cacheRead)}</span>,
    num: (s) => s.tokens.cacheRead,
    highlight: "max",
  },
  {
    label: "Cost",
    get: (s) => (
      <span className="mono tabular" title={s.unpricedModels?.length ? estimateHint(s.unpricedModels) : undefined}>
        {s.unpricedModels?.length ? "~" : ""}{formatCost(s.costUsd)}
      </span>
    ),
    num: (s) => s.costUsd,
    highlight: "max",
  },
  {
    label: "Messages",
    get: (s) => <span className="mono tabular">{s.messages}</span>,
    num: (s) => s.messages,
  },
  {
    label: "Tool calls",
    get: (s) => {
      const total = Object.values(s.toolCounts).reduce((a, b) => a + b, 0);
      return <span className="mono tabular">{total}</span>;
    },
    num: (s) => Object.values(s.toolCounts).reduce((a, b) => a + b, 0),
    highlight: "max",
  },
  {
    label: "Files edited",
    get: (s) => <span className="mono tabular">{s.filesChanged}</span>,
    num: (s) => s.filesChanged,
  },
  {
    label: "Frictions",
    get: (s) =>
      s.frictions.length > 0 ? (
        <span className="mono tabular" style={{ color: "var(--c-amber)" }}>
          △ {s.frictions.length}
        </span>
      ) : (
        <span className="mono dim">—</span>
      ),
    num: (s) => s.frictions.length,
    highlight: "max",
  },
  {
    label: "Quality score",
    get: (s) =>
      s.quality ? (
        <span className="mono tabular">
          {s.quality.grade} · {s.quality.score.toFixed(1)}
        </span>
      ) : (
        <span className="mono dim">—</span>
      ),
    num: (s) => s.quality?.score ?? -1,
    highlight: "min",
  },
];

export function SessionCompare({ sessions, onClose, onRemove, onPick }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="compare-wrap">
        <div className="compare-head">
          <h2>Compare</h2>
          <button className="compare-close" onClick={onClose} aria-label="Exit compare mode">✕</button>
        </div>
        <div className="placeholder">
          Select 2+ sessions from the list to compare.
        </div>
      </div>
    );
  }

  return (
    <div className="compare-wrap scrollbar">
      <div className="compare-head">
        <h2>Compare <span className="dim mono tabular">({sessions.length})</span></h2>
        <button className="compare-close" onClick={onClose} aria-label="Exit compare mode">✕ close</button>
      </div>
      <div className="compare-table">
        <div className="compare-row compare-row-head">
          <div className="compare-label" />
          {sessions.map((s) => (
            <div key={s.id} className="compare-col-head">
              <button className="compare-col-title" onClick={() => onPick(s.id)} title="Open this session">
                {s.goal.slice(0, 40)}{s.goal.length > 40 ? "…" : ""}
              </button>
              <button className="compare-col-remove" onClick={() => onRemove(s.id)} aria-label="Remove from comparison">✕</button>
            </div>
          ))}
        </div>
        {ROWS.map((r) => {
          let winnerIdx = -1;
          if (r.highlight && r.num) {
            const nums = sessions.map(r.num);
            const target = r.highlight === "max" ? Math.max(...nums) : Math.min(...nums.filter((n) => n >= 0));
            winnerIdx = nums.findIndex((n) => n === target);
          }
          return (
            <div key={r.label} className="compare-row">
              <div className="compare-label mono dim">{r.label}</div>
              {sessions.map((s, i) => (
                <div key={s.id} className={`compare-cell ${i === winnerIdx ? "winner" : ""}`}>
                  {r.get(s)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
