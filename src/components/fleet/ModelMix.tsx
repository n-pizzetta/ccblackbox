import { useMemo } from "react";
import type { Session } from "../../types";
import { sumTokens } from "../../utils/fleetStats";
import { estimateHint, formatCost, formatTokens } from "../../utils/format";
import { isKnownModel, modelFamily, modelLabel } from "../../../scripts/models.mjs";

interface Props {
  sessions: Session[];
}

const FAMILY_COLOR: Record<string, string> = {
  fable: "var(--c-amber)",
  mythos: "var(--c-amber)",
  opus: "var(--c-violet)",
  sonnet: "var(--c-cyan)",
  haiku: "var(--c-teal)",
  gpt: "var(--c-lime)",
  codex: "var(--c-lime)",
};
const colorOf = (model: string) => FAMILY_COLOR[modelFamily(model)] ?? "var(--c-text-faint)";

export function ModelMix({ sessions }: Props) {
  const rows = useMemo(() => {
    const byModel = new Map<string, { tokens: number; cost: number; count: number }>();
    for (const s of sessions) {
      // Per model when available (sessions can switch models), else the session's model.
      const usage = s.modelUsage ?? { [s.model]: { tokens: sumTokens(s.tokens), cost: s.costUsd } };
      for (const [model, u] of Object.entries(usage)) {
        if (u.tokens <= 0) continue;
        const prev = byModel.get(model) ?? { tokens: 0, cost: 0, count: 0 };
        prev.tokens += u.tokens;
        prev.cost += u.cost;
        prev.count += 1;
        byModel.set(model, prev);
      }
    }
    return Array.from(byModel.entries())
      .map(([model, v]) => ({ model, ...v }))
      .filter((r) => r.tokens > 0)
      .sort((a, b) => b.cost - a.cost);
  }, [sessions]);

  if (rows.length === 0) {
    return (
      <div className="fleet-block">
        <div className="section-title"><span>Model mix</span></div>
        <div className="placeholder mono dim">No model data.</div>
      </div>
    );
  }

  const total = rows.reduce((a, r) => a + r.tokens, 0);
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Model mix</span>
        <span className="dim mono tabular">{rows.length} model{rows.length > 1 ? "s" : ""}</span>
      </div>
      <div className="model-mix">
        <div className="model-mix-bar">
          {rows.map((r) => {
            const pct = (r.tokens / total) * 100;
            return (
              <div
                key={r.model}
                className="model-mix-seg"
                style={{ flex: pct, background: colorOf(r.model) }}
                title={`${modelLabel(r.model)}: ${formatTokens(r.tokens)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
        <div className="model-mix-list">
          {rows.map((r) => {
            const pct = (r.tokens / total) * 100;
            const costPct = totalCost > 0 ? (r.cost / totalCost) * 100 : 0;
            return (
              <div key={r.model} className="model-mix-row">
                <span className="model-mix-swatch" style={{ background: colorOf(r.model) }} />
                <span className="mono model-mix-name">{modelLabel(r.model)}</span>
                <span className="mono dim tabular">{r.count} session{r.count > 1 ? "s" : ""}</span>
                <span className="mono tabular right">{formatTokens(r.tokens)}</span>
                <span className="mono dim tabular right">{pct.toFixed(1)}% vol</span>
                <span
                  className="mono tabular right"
                  style={{ color: "var(--c-text)", fontWeight: 600 }}
                  title={isKnownModel(r.model) ? undefined : estimateHint([r.model])}
                >
                  {isKnownModel(r.model) ? "" : "~"}{formatCost(r.cost)}
                </span>
                <span className="mono dim tabular right">{costPct.toFixed(1)}% $</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
