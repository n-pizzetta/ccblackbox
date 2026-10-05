import type { Session } from "../types";

/**
 * Usage health check: plain rules over the sessions in range. Each one passes,
 * warns or fails against documented thresholds, says why it matters and what
 * to do, and lists the sessions behind a miss. "na" rules lack data and don't
 * count in the score. Add a rule by appending to RULES.
 */

export type RuleStatus = "pass" | "warn" | "fail" | "na";

export type RuleResult = {
  id: string;
  name: string;
  status: RuleStatus;
  /** Measured value, formatted. */
  value: string;
  /** What passing means, formatted. */
  target: string;
  why: string;
  hint: string;
  /** Sessions behind a warn/fail, worst first. */
  sessionIds: string[];
};

export type HealthReport = { rules: RuleResult[]; passed: number; total: number };

const DAY_MS = 86_400_000;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const kTokens = (v: number) => `${Math.round(v / 1000)}k`;

/** Lower is better: pass at or under `pass`, warn at or under `warn`. */
function lowerIsBetter(v: number, pass: number, warn: number): RuleStatus {
  return v <= pass ? "pass" : v <= warn ? "warn" : "fail";
}
function higherIsBetter(v: number, pass: number, warn: number): RuleStatus {
  return v >= pass ? "pass" : v >= warn ? "warn" : "fail";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const hasFacet = (s: Session) => s.outcome !== "unknown" && s.outcome !== "in_progress";

/** `sessions`: in range, ghosts excluded; `ghosts`: the ghosts in range; `allSessions`: unscoped. */
type Ctx = { sessions: Session[]; ghosts: Session[]; allSessions: Session[]; now: number };
type Rule = (c: Ctx) => RuleResult;

const na = (base: Omit<RuleResult, "status" | "value" | "sessionIds">, value = "no data"): RuleResult => ({
  ...base,
  status: "na",
  value,
  sessionIds: [],
});

const RULES: Rule[] = [
  ({ sessions }) => {
    const base = {
      id: "context-quality",
      name: "Context quality",
      target: "≥ 85% of sessions score 70+",
      why: "Stale reads, bloated tool results, compactions and a full context make answers slower, costlier and less accurate.",
      hint: "Open the worst sessions and check their quality breakdown.",
    };
    const scored = sessions.filter((s) => s.quality);
    if (scored.length === 0) return na(base);
    const low = scored.filter((s) => s.quality!.score < 70).sort((a, b) => a.quality!.score - b.quality!.score);
    const share = 1 - low.length / scored.length;
    return { ...base, status: higherIsBetter(share, 0.85, 0.7), value: pct(share), sessionIds: low.map((s) => s.id) };
  },

  ({ sessions }) => {
    const base = {
      id: "context-fill",
      name: "Context headroom",
      target: "≤ 5% of sessions peak above 80% of the window",
      why: "Near the limit, auto-compaction kicks in and earlier detail is summarized away.",
      hint: "/clear between unrelated tasks; /compact at a natural break before it gets full.",
    };
    const scored = sessions.filter((s) => s.quality?.fillPct != null);
    if (scored.length === 0) return na(base);
    const full = scored.filter((s) => s.quality!.fillPct! >= 80).sort((a, b) => b.quality!.fillPct! - a.quality!.fillPct!);
    const share = full.length / scored.length;
    return { ...base, status: lowerIsBetter(share, 0.05, 0.15), value: pct(share), sessionIds: full.map((s) => s.id) };
  },

  ({ sessions }) => {
    const base = {
      id: "compactions",
      name: "Compactions",
      target: "≤ 5% of sessions compact twice or more",
      why: "Each compaction loses detail; repeated ones mean a session carried on too long.",
      hint: "Split long work into sessions per task, with a short handoff note.",
    };
    const scored = sessions.filter((s) => s.quality?.compactions != null);
    if (scored.length === 0) return na(base);
    const deep = scored.filter((s) => s.quality!.compactions! >= 2).sort((a, b) => b.quality!.compactions! - a.quality!.compactions!);
    const share = deep.length / scored.length;
    return { ...base, status: lowerIsBetter(share, 0.05, 0.15), value: pct(share), sessionIds: deep.map((s) => s.id) };
  },

  ({ sessions }) => {
    const base = {
      id: "cache",
      name: "Prompt cache",
      target: "≥ 85% of input served from cache",
      why: "Cached input is about 10× cheaper and counts far less against your limits.",
      hint: "Avoid long pauses mid-session (the cache expires) and editing CLAUDE.md or MCP config mid-session.",
    };
    // Claude Code's cache: Codex caches automatically and never writes, so it would always pass.
    const claude = sessions.filter((s) => s.agent !== "codex");
    let read = 0;
    let all = 0;
    for (const s of claude) {
      read += s.tokens.cacheRead;
      all += s.tokens.input + s.tokens.cacheRead + s.tokens.cacheWrite;
    }
    if (all < 100_000) return na(base);
    const ratio = read / all;
    const worst = claude
      .map((s) => ({ s, pool: s.tokens.input + s.tokens.cacheRead + s.tokens.cacheWrite }))
      .filter(({ pool }) => pool >= 100_000)
      .map(({ s, pool }) => ({ s, r: s.tokens.cacheRead / pool }))
      .filter(({ r }) => r < 0.85)
      .sort((a, b) => a.r - b.r);
    return { ...base, status: higherIsBetter(ratio, 0.85, 0.7), value: pct(ratio), sessionIds: worst.map(({ s }) => s.id) };
  },

  ({ sessions }) => {
    const base = {
      id: "startup-cost",
      name: "Startup cost",
      target: "Median first-turn context ≤ 25k tokens",
      why: "System prompt, CLAUDE.md, memory, skills and MCP tool definitions are paid on every turn of every session.",
      hint: "Trim CLAUDE.md and its @imports, disable MCP servers and plugins you don't use.",
    };
    // The advice is about Claude Code's own setup (CLAUDE.md, MCP, plugins).
    const first = sessions
      .filter((s) => s.agent !== "codex")
      .map((s) => ({ s, t: s.turns?.[0]?.tokens }))
      .filter((x): x is { s: Session; t: NonNullable<typeof x.t> } => !!x.t)
      .map(({ s, t }) => ({ s, ctx: t.input + t.cacheRead + t.cacheWrite }))
      .filter(({ ctx }) => ctx > 0);
    if (first.length === 0) return na(base);
    const m = median(first.map((x) => x.ctx));
    const heavy = first.filter(({ ctx }) => ctx > 25_000).sort((a, b) => b.ctx - a.ctx);
    return { ...base, status: lowerIsBetter(m, 25_000, 45_000), value: kTokens(m), sessionIds: heavy.map(({ s }) => s.id) };
  },

  ({ sessions }) => {
    const base = {
      id: "outcome",
      name: "Outcomes",
      target: "≤ 15% of sessions partly or not achieved",
      why: "Sessions that miss their goal are where the most time and quota go to waste.",
      hint: "Review them: unclear goal, missing context, or a task too big for one session?",
    };
    const faceted = sessions.filter(hasFacet);
    if (faceted.length === 0) return na(base, "run /insights");
    const missed = faceted.filter((s) => s.outcome === "partially_achieved" || s.outcome === "not_achieved");
    const share = missed.length / faceted.length;
    return { ...base, status: lowerIsBetter(share, 0.15, 0.3), value: pct(share), sessionIds: missed.map((s) => s.id) };
  },

  ({ sessions }) => {
    const base = {
      id: "friction",
      name: "Friction",
      target: "≤ 1 friction per session",
      why: "Frictions (misunderstandings, wrong approaches, tool errors) cost turns and patience.",
      hint: "Recurring frictions are worth a line in CLAUDE.md.",
    };
    const faceted = sessions.filter(hasFacet);
    if (faceted.length === 0) return na(base, "run /insights");
    const avg = faceted.reduce((a, s) => a + s.frictions.length, 0) / faceted.length;
    const rough = faceted.filter((s) => s.frictions.length > 1).sort((a, b) => b.frictions.length - a.frictions.length);
    return { ...base, status: lowerIsBetter(avg, 1, 2), value: avg.toFixed(1), sessionIds: rough.map((s) => s.id) };
  },

  ({ allSessions, now }) => {
    const base = {
      id: "stale-processes",
      name: "Forgotten sessions",
      target: "No Claude Code process running for over 24h",
      why: "Forgotten sessions hold memory, and resuming one days later pays for its whole context.",
      hint: "Close the terminals you no longer use; start a fresh session instead of resuming an old one.",
    };
    const stale = allSessions
      .filter((s) => s.live && s.processStartedAt && now - Date.parse(s.processStartedAt) > DAY_MS)
      .sort((a, b) => Date.parse(a.processStartedAt!) - Date.parse(b.processStartedAt!));
    return { ...base, status: lowerIsBetter(stale.length, 0, 2), value: String(stale.length), sessionIds: stale.map((s) => s.id) };
  },

  ({ ghosts }) => {
    const base = {
      id: "housekeeping",
      name: "Housekeeping",
      target: "No ghost sessions (empty or crashed)",
      why: "Ghosts clutter the list and skew counts.",
      hint: "Use the Ghost filter in the session list to review and clean them.",
    };
    return { ...base, status: lowerIsBetter(ghosts.length, 0, 5), value: String(ghosts.length), sessionIds: ghosts.map((s) => s.id) };
  },
];

export function healthReport(sessions: Session[], allSessions: Session[], now: number = Date.now()): HealthReport {
  const ctx = { sessions: sessions.filter((s) => !s.ghost), ghosts: sessions.filter((s) => s.ghost), allSessions, now };
  const rules = RULES.map((rule) => {
    const r = rule(ctx);
    return { ...r, sessionIds: r.status === "pass" ? [] : r.sessionIds.slice(0, 5) };
  });
  const counted = rules.filter((r) => r.status !== "na");
  return { rules, passed: counted.filter((r) => r.status === "pass").length, total: counted.length };
}
