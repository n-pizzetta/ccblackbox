import type { Session } from "../types";
import { costOfTokens, type TokenBundle } from "./fleetStats";
import { priceFor } from "../../scripts/models.mjs";

export type PromptStats = {
  promptIdx: number;
  t: number;
  endT: number;
  turnCount: number;
  tokens: TokenBundle;
  cost: number;
  tools: string[];
  dominantKind: "input" | "output" | "cacheRead" | "cacheWrite";
};

export function aggregateByPrompt(
  turns: NonNullable<Session["turns"]>,
  model: string,
  prompts: NonNullable<Session["prompts"]>,
): PromptStats[] {
  const stats: PromptStats[] = prompts.map((p, i) => ({
    promptIdx: i,
    t: p.t,
    endT: prompts[i + 1]?.t ?? Infinity,
    turnCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    tools: [],
    dominantKind: "input",
  }));
  for (const tn of turns) {
    if (tn.promptIdx === undefined) continue;
    const s = stats[tn.promptIdx];
    if (!s) continue;
    s.turnCount++;
    s.tokens.input += tn.tokens.input;
    s.tokens.output += tn.tokens.output;
    s.tokens.cacheRead += tn.tokens.cacheRead;
    s.tokens.cacheWrite += tn.tokens.cacheWrite;
    s.cost += costOfTokens(tn.model ?? model, tn.tokens);
    for (const t of tn.tools) s.tools.push(t);
  }
  const p = priceFor(model);
  for (const s of stats) {
    const contrib = {
      input: (s.tokens.input / 1e6) * p.in,
      output: (s.tokens.output / 1e6) * p.out,
      cacheRead: (s.tokens.cacheRead / 1e6) * p.cacheRead,
      cacheWrite: (s.tokens.cacheWrite / 1e6) * p.cacheWrite,
    } as const;
    let max: PromptStats["dominantKind"] = "output";
    let maxV = -1;
    for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (contrib[k] > maxV) { maxV = contrib[k]; max = k; }
    }
    s.dominantKind = max;
  }
  return stats;
}
