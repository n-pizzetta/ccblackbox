import type { Session } from "../types";
import { aggregateByPrompt, type PromptStats } from "./aggregateByPrompt";
import { costOfTokens, sumTokens, tokensInWindow } from "./fleetStats";

export type Burn = { tokens: number; cost: number };

/**
 * What sessions and projects are ranked by: API value, the closest to what the usage limits
 * count (they weigh models and token kinds), or tokens when nothing in the window is priced.
 * It depends on the window only, never on whether the limits were read.
 */
export type Weigh = "tokens" | "cost";

/** What burned in a time window, per session, prompt, tool and project, heaviest first; ties by id or name. */
export type WindowBreakdown = {
  total: Burn;
  weigh: Weigh;
  /** By `weigh`. */
  sessions: Array<{ s: Session } & Burn>;
  /** By API value, counting only each prompt's turns inside the window. */
  prompts: Array<{ session: Session; stat: PromptStats }>;
  /** By calls; a turn's tokens and cost are split evenly between its tools. */
  tools: Array<{ tool: string; calls: number } & Burn>;
  /** By `weigh`. */
  projects: Array<{ project: string } & Burn>;
};

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function windowBreakdown(sessions: Session[], fromMs: number, toMs: number): WindowBreakdown {
  const all = tokensInWindow(sessions, fromMs, toMs);
  const rows: WindowBreakdown["sessions"] = [];
  const prompts: WindowBreakdown["prompts"] = [];
  const tools = new Map<string, { calls: number } & Burn>();
  const projects = new Map<string, Burn>();

  for (const s of sessions) {
    // Cheap skip: this runs every few seconds over the whole history.
    const startMs = new Date(s.startedAt).getTime();
    if (startMs > toMs || (s.lastEventAt && new Date(s.lastEventAt).getTime() < fromMs)) continue;
    const burn = tokensInWindow([s], fromMs, toMs);
    const tokens = sumTokens(burn.tokens);
    if (tokens > 0) {
      rows.push({ s, tokens, cost: burn.cost });
      const key = s.project || "unknown";
      const p = projects.get(key) ?? { tokens: 0, cost: 0 };
      p.tokens += tokens;
      p.cost += burn.cost;
      projects.set(key, p);
    }
    if (!s.turns?.length) continue;

    const inWindow = s.turns.filter((t) => startMs + t.t >= fromMs && startMs + t.t <= toMs);
    if (s.prompts?.length) {
      // A prompt started before the window only counts the turns that ran inside it.
      for (const stat of aggregateByPrompt(inWindow, s.model, s.prompts)) {
        if (stat.cost > 0) prompts.push({ session: s, stat });
      }
    }

    for (const t of inWindow) {
      if (t.tools.length === 0) continue;
      const tokensEach = sumTokens(t.tokens) / t.tools.length;
      const costEach = costOfTokens(t.model ?? s.model, t.tokens) / t.tools.length;
      for (const tool of t.tools) {
        const cur = tools.get(tool) ?? { calls: 0, tokens: 0, cost: 0 };
        cur.calls += 1;
        cur.tokens += tokensEach;
        cur.cost += costEach;
        tools.set(tool, cur);
      }
    }
  }

  const weigh: Weigh = all.cost > 0 ? "cost" : "tokens";
  const heavier = (a: Burn, b: Burn) => b[weigh] - a[weigh];
  return {
    total: { tokens: sumTokens(all.tokens), cost: all.cost },
    weigh,
    sessions: rows.sort((a, b) => heavier(a, b) || byName(a.s.id, b.s.id)),
    prompts: prompts.sort((a, b) => b.stat.cost - a.stat.cost || byName(a.session.id, b.session.id) || a.stat.promptIdx - b.stat.promptIdx),
    tools: [...tools.entries()].map(([tool, v]) => ({ tool, ...v })).sort((a, b) => b.calls - a.calls || byName(a.tool, b.tool)),
    projects: [...projects.entries()].map(([project, v]) => ({ project, ...v })).sort((a, b) => heavier(a, b) || byName(a.project, b.project)),
  };
}
