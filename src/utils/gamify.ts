import type { Session } from "../types";
import type { Range } from "./range";
import { costOfTokens, rangeBoundsMs, sumTokens } from "./fleetStats";
import { freshTokens } from "./units";

const DAY_MS = 86_400_000;

/* ---- Podium categories ---- */

export type Category = "tokens" | "cost" | "efficiency" | "duration";

export const CATEGORIES: Array<{ id: Category; label: string; title: string }> = [
  { id: "tokens", label: "Hungriest", title: "Most fresh tokens (input + output + cache writes)" },
  { id: "cost", label: "Heaviest", title: "Highest API value: the closest proxy for weight on your quota" },
  { id: "efficiency", label: "Most efficient", title: "Best cache hit (≥ 10k input)" },
  { id: "duration", label: "Longest", title: "Longest active time" },
];

/** cacheRead / (cacheRead + input), or null when there is too little input to mean anything. */
export function cacheHit(t: Session["tokens"]): number | null {
  const pool = t.input + t.cacheRead;
  if (pool < 10_000) return null;
  return t.cacheRead / pool;
}

export function categoryValue(s: Session, c: Category): number | null {
  switch (c) {
    case "tokens": return freshTokens(s.tokens);
    case "cost": return s.costUsd;
    case "efficiency": return cacheHit(s.tokens);
    case "duration": return s.durationMs;
  }
}

export function rankSessions(sessions: Session[], c: Category, limit: number): Array<{ s: Session; value: number }> {
  const rows: Array<{ s: Session; value: number }> = [];
  for (const s of sessions) {
    const value = categoryValue(s, c);
    if (value !== null && value > 0 && sumTokens(s.tokens) > 0) rows.push({ s, value });
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, limit);
}

/* ---- Project league (rank movement vs the previous period) ---- */

export type ProjectRow = {
  project: string;
  /** Fresh tokens (input + output + cache writes). */
  tokens: number;
  cost: number;
  count: number;
  /** Positive = climbed, negative = dropped, null = no previous rank ("new" or range "all"). */
  delta: number | null;
  isNew: boolean;
};

/** Per-project API value (relative weight) inside a time window. */
function projectTotalsInWindow(sessions: Session[], fromMs: number, toMs: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    if (!s.turns?.length) continue;
    const base = new Date(s.startedAt).getTime();
    let sum = 0;
    for (const t of s.turns) {
      const ts = base + t.t;
      if (ts >= fromMs && ts < toMs) sum += costOfTokens(t.model ?? s.model, t.tokens);
    }
    if (sum > 0) out.set(s.project || "unknown", (out.get(s.project || "unknown") ?? 0) + sum);
  }
  return out;
}

function ranksOf(totals: Map<string, number>): Map<string, number> {
  return new Map([...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p], i) => [p, i + 1]));
}

export function projectLeague(sessions: Session[], allSessions: Session[], range: Range): ProjectRow[] {
  const byProj = new Map<string, { tokens: number; cost: number; count: number }>();
  for (const s of sessions) {
    const key = s.project || "unknown";
    const prev = byProj.get(key) ?? { tokens: 0, cost: 0, count: 0 };
    prev.tokens += freshTokens(s.tokens);
    prev.cost += s.costUsd;
    prev.count += 1;
    byProj.set(key, prev);
  }

  let curRank: Map<string, number> | null = null;
  let prevRank: Map<string, number> | null = null;
  if (range !== "all") {
    const { fromMs, toMs } = rangeBoundsMs(allSessions, range);
    const span = range === "today" ? DAY_MS : toMs - fromMs;
    curRank = ranksOf(projectTotalsInWindow(allSessions, fromMs, toMs));
    prevRank = ranksOf(projectTotalsInWindow(allSessions, fromMs - span, fromMs));
  }

  return [...byProj.entries()]
    .map(([project, v]) => ({ project, ...v }))
    .filter((r) => r.cost > 0 || r.tokens > 0)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .map((r) => {
      const cur = curRank?.get(r.project);
      const prev = prevRank?.get(r.project);
      const comparable = curRank !== null && prevRank !== null && prevRank.size > 0 && cur !== undefined;
      return {
        ...r,
        delta: comparable && prev !== undefined ? prev - cur : null,
        isNew: comparable && prev === undefined,
      };
    });
}

/* ---- Badges ---- */

export type Badge = {
  id: string;
  name: string;
  hint: string;
  icon: string;
  progress: number;
  target: number;
  unlocked: boolean;
};

function badge(id: string, name: string, icon: string, hint: string, progress: number, target: number): Badge {
  return { id, name, icon, hint, progress: Math.min(progress, target), target, unlocked: progress >= target };
}

export function computeBadges(sessions: Session[]): Badge[] {
  const real = sessions.filter((s) => !s.ghost && sumTokens(s.tokens) > 0);
  const cacheMasters = real.filter((s) => (cacheHit(s.tokens) ?? 0) > 0.9).length;
  const snipers = real.filter((s) => s.outcome === "fully_achieved" && s.frictions.length < 2).length;
  const clean = real.filter((s) => s.frictions.length === 0 && s.messages > 0).length;
  const commits = real.reduce((a, s) => a + s.commits, 0);
  const maxAgents = real.reduce((a, s) => Math.max(a, s.subAgents), 0);
  const marathons = real.filter((s) => s.durationMs >= 2 * 3_600_000).length;
  const quality = real.filter((s) => (s.quality?.score ?? 0) >= 80).length;

  return [
    badge("cache", "Cache master", "🧊", "Cache hit above 90% on 5 sessions", cacheMasters, 5),
    badge("sniper", "Sniper", "🎯", "3 fully achieved sessions with fewer than 2 frictions", snipers, 3),
    badge("clean", "Clean run", "🧹", "5 sessions without a single friction", clean, 5),
    badge("shipper", "Shipper", "🚢", "10 commits in the period", commits, 10),
    badge("orchestrator", "Orchestrator", "🐝", "A session with 5+ sub-agents", maxAgents, 5),
    badge("marathon", "Marathon", "🏃", "A session with 2h+ of active time", marathons, 1),
    badge("quality", "High quality", "💎", "5 sessions with a quality score of 80+", quality, 5),
  ];
}

/* ---- Hero: health score, streak, level ---- */

export function healthScore(sessions: Session[]): number | null {
  const scores = sessions.map((s) => s.quality?.score).filter((v): v is number => typeof v === "number");
  if (scores.length === 0) return null;
  return scores.reduce((a, v) => a + v, 0) / scores.length;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Consecutive days with activity, ending today (a quiet today keeps yesterday's streak alive). */
export function activityStreak(allSessions: Session[], now: number = Date.now()): number {
  const days = new Set<string>();
  for (const s of allSessions) {
    const base = new Date(s.startedAt).getTime();
    days.add(dayKey(base));
    if (s.lastEventAt) days.add(dayKey(new Date(s.lastEventAt).getTime()));
    for (const t of s.turns ?? []) days.add(dayKey(base + t.t));
  }
  let cursor = now;
  if (!days.has(dayKey(cursor))) cursor -= DAY_MS;
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

const LEVEL_UNIT = 1_000_000;
const LEVEL_TITLES = ["Rookie", "Operator", "Engineer", "Architect", "Wizard", "Legend"];

export type Level = { level: number; title: string; progress: number; nextAt: number; total: number };

/** Cosmetic level from lifetime fresh tokens: level n starts at 1M × (n-1)². */
export function levelOf(allSessions: Session[]): Level {
  const total = allSessions.reduce((a, s) => a + freshTokens(s.tokens), 0);
  const level = Math.floor(Math.sqrt(total / LEVEL_UNIT)) + 1;
  const from = LEVEL_UNIT * (level - 1) ** 2;
  const nextAt = LEVEL_UNIT * level ** 2;
  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    progress: (total - from) / (nextAt - from),
    nextAt,
    total,
  };
}
