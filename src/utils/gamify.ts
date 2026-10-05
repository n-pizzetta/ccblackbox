import { useEffect, useState } from "react";
import type { Session } from "../types";
import type { Range } from "./range";
import { costOfTokens, rangeBoundsMs, sumTokens } from "./fleetStats";
import { freshTokens } from "./units";

const DAY_MS = 86_400_000;

/* ---- Podium categories ---- */

export type Category = "tokens" | "cost" | "duration";

export const CATEGORIES: Array<{ id: Category; label: string; title: string }> = [
  { id: "tokens", label: "Hungriest", title: "Most fresh tokens (input + output + cache writes)" },
  { id: "cost", label: "Heaviest", title: "Highest API value: the closest proxy for weight on your quota" },
  { id: "duration", label: "Longest", title: "Longest continuous stretch: no pause over 15 min" },
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
    case "duration": return s.longestRunMs ?? null;
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

/* ---- Badges, level and streak (computed server-side by scripts/badges.mjs) ---- */

export type Tier = "bronze" | "silver" | "gold" | "platinum";

export const TIER_LABEL: Record<Tier, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };

/** `xp` is what unlocking the tier adds to the level: 0 for volume and spend families. */
export type BadgeTier = { tier: Tier; target: number; progress: number; unlockedAt: string | null; xp: number };

export type BadgeFamily = {
  id: string;
  name: string;
  icon: string;
  hint: string;
  unit: string | null;
  window: "ever" | "30d";
  /** False when the family needs data this user doesn't have (/insights, scored sessions). */
  available: boolean;
  /** Rewards good practice (tests, commits, cache, context): the only families suggested as a next goal. */
  nudge: boolean;
  tiers: BadgeTier[];
};

/** XP from how sessions were run (all history) plus good-practice badge tiers. Level n starts at `from`. */
export type Level = {
  level: number;
  title: string;
  xp: number;
  from: number;
  next: number;
  /** XP of sessions worked in today and badges unlocked today. */
  today: number;
  /** XP per session for each criterion met. */
  rules: Array<{ label: string; points: number }>;
  /** XP a good-practice badge adds for its first, second, third and fourth tier. */
  stepXp: number[];
};

/** Active days in a row; quiet weekends don't break it, a quiet weekday today puts it at risk. */
export type Streak = { current: number; activeToday: boolean; atRisk: boolean };

export type BadgesPayload = { startedAt: string | null; total: number; families: BadgeFamily[]; level?: Level; streak?: Streak };

/** Fetches /api/badges whenever `version` changes (pass the session list); null without the API. */
export function useBadges(version: unknown): BadgesPayload | null {
  const [data, setData] = useState<BadgesPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/badges", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d && Array.isArray(d.families) ? d : null); })
      .catch(() => { /* static export or mock data: no API */ });
    return () => { cancelled = true; };
  }, [version]);
  return data;
}

export const badgeKey = (f: BadgeFamily, t: BadgeTier) => `${f.id}:${t.tier}`;

/** `family:tier` keys of every unlocked tier. */
export function unlockedKeys(families: BadgeFamily[]): string[] {
  return families.flatMap((f) => f.tiers.filter((t) => t.unlockedAt).map((t) => badgeKey(f, t)));
}

export type NextGoal = { family: BadgeFamily; tier: BadgeTier; ratio: number };

/** The locked tiers closest to unlocking, among families that reward good practice. */
export function nextUp(families: BadgeFamily[], limit: number): NextGoal[] {
  const out: NextGoal[] = [];
  for (const family of families) {
    if (!family.available || !family.nudge) continue;
    const tier = family.tiers.find((t) => !t.unlockedAt);
    if (tier) out.push({ family, tier, ratio: tier.progress / tier.target });
  }
  return out.sort((a, b) => b.ratio - a.ratio || (a.tier.target - a.tier.progress) - (b.tier.target - b.tier.progress)).slice(0, limit);
}
