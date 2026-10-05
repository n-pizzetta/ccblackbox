/**
 * Top-level pages. Each answers one question:
 * now      what is running and how much of my limits is left (ignores the scope)
 * sessions which sessions, in the scope (range + filters)
 * usage    where tokens and API value went, in the scope
 * health   what to fix in how I work, in the scope
 * badges   "Progress": level, next goals, badges and records (all time)
 */
export type Page = "now" | "sessions" | "usage" | "health" | "badges";

export const PAGE_IDS: Page[] = ["now", "sessions", "usage", "health", "badges"];

/** Pages in the main navigation, in order; digits 1-5 switch between them. */
export const NAV_PAGES: Array<{ id: Page; label: string }> = [
  { id: "now", label: "Now" },
  { id: "sessions", label: "Sessions" },
  { id: "usage", label: "Usage" },
  { id: "health", label: "Health" },
  { id: "badges", label: "Progress" },
];

/** Pages whose figures follow the range and filters: they show the scope bar. */
export const SCOPED_PAGES: ReadonlySet<Page> = new Set<Page>(["sessions", "usage", "health"]);
