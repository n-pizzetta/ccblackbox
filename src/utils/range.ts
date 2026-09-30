import type { Session } from "../types";
import { costOfTokens } from "./fleetStats";

export type Range = "today" | "7d" | "30d" | "all";

export const RANGE_OPTIONS: Array<{ id: Range; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All" },
];

export function rangeStart(range: Range, now: Date = new Date()): Date | null {
  if (range === "all") return null;
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function filterByRange(sessions: Session[], range: Range, now: Date = new Date()): Session[] {
  const start = rangeStart(range, now);
  if (!start) return sessions;
  const startMs = start.getTime();
  return sessions.filter((s) => {
    if (s.live) return true;
    const started = new Date(s.startedAt).getTime();
    const last = s.lastEventAt ? new Date(s.lastEventAt).getTime() : 0;
    return Math.max(started, last) >= startMs;
  });
}

/**
 * Sessions with tokens and cost restricted to the turns inside the range, and
 * per-model usage (sessions can switch models). Aggregates (header totals,
 * fleet cards) use these; a session started before the range only contributes
 * what it spent inside it. Sessions without turns keep their totals.
 */
export function scopeToRange(sessions: Session[], range: Range, now: Date = new Date()): Session[] {
  const fromMs = rangeStart(range, now)?.getTime() ?? null;
  return sessions.map((s) => {
    if (!s.turns?.length) {
      return { ...s, modelUsage: { [s.model]: { tokens: sumAll(s.tokens), cost: s.costUsd } } };
    }
    const base = new Date(s.startedAt).getTime();
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const modelUsage: NonNullable<Session["modelUsage"]> = {};
    let costUsd = 0;
    for (const t of s.turns) {
      if (fromMs !== null && base + t.t < fromMs) continue;
      const model = t.model ?? s.model;
      const cost = costOfTokens(model, t.tokens);
      tokens.input += t.tokens.input;
      tokens.output += t.tokens.output;
      tokens.cacheRead += t.tokens.cacheRead;
      tokens.cacheWrite += t.tokens.cacheWrite;
      costUsd += cost;
      const m = (modelUsage[model] ??= { tokens: 0, cost: 0 });
      m.tokens += sumAll(t.tokens);
      m.cost += cost;
    }
    return { ...s, tokens, costUsd, modelUsage };
  });
}

function sumAll(t: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

export function rangeLabel(range: Range): string {
  switch (range) {
    case "today":
      return "today";
    case "7d":
      return "last 7 days";
    case "30d":
      return "last 30 days";
    case "all":
      return "all time";
  }
}
