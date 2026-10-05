import type { Session } from "../types";
import { freshTokens } from "./units";

export type SortKey = "started" | "usage" | "active";
export type Sort = { key: SortKey; dir: "asc" | "desc" };

/** Sorts a copy for the session table; ties keep the most recent first. */
export function sortSessions(sessions: Session[], sort: Sort, unit: "tokens" | "usd"): Session[] {
  const value = (s: Session): number => {
    if (sort.key === "usage") return unit === "tokens" ? freshTokens(s.tokens) : s.costUsd;
    if (sort.key === "active") return s.durationMs;
    return new Date(s.startedAt).getTime();
  };
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...sessions].sort((a, b) => sign * (value(a) - value(b)) || new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
