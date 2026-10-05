/**
 * Badge catalog and progress, computed server-side from full sessions (the
 * list payload has no shell counters).
 *
 * Badges only count sessions started after ccblackbox first ran: that date
 * and each unlock are kept in ~/.claude/ccblackbox/badges.json, so an unlock
 * survives transcript cleanup and 30-day windows sliding past it.
 *
 * Calibration (see ARCHITECTURE.md): one metric per family, only the target
 * rises with the tier, so a lower tier can never be harder than a higher one.
 * Per-session records are set by rarity; cumulative counters by time for a
 * heavy user (bronze day 1, silver 1-2 weeks, gold ~3 months, platinum ~1 year).
 */
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";

const DAY_MS = 86_400_000;
const WINDOW_MS = 30 * DAY_MS;
/** A pause up to this long does not end a continuous work stretch. */
const RUN_GAP_MS = 15 * 60_000;

export const TIERS = ["bronze", "silver", "gold", "platinum"];

/* ---- Per-session helpers ---- */

const startMs = (s) => Date.parse(s.startedAt);

/** Main-thread activity (turns and prompts) as absolute, sorted timestamps. */
function activity(s) {
  const base = startMs(s);
  const ts = [];
  for (const t of s.turns ?? []) if (!t.sidechain) ts.push(base + t.t);
  for (const p of s.prompts ?? []) ts.push(base + p.t);
  return ts.sort((a, b) => a - b);
}

/** Continuous stretches [from, to]: a gap over RUN_GAP_MS starts a new one. */
function runsOf(s) {
  const ts = activity(s);
  const runs = [];
  let from = ts[0];
  for (let i = 1; i <= ts.length; i++) {
    if (i === ts.length || ts[i] - ts[i - 1] > RUN_GAP_MS) {
      if (ts[i - 1] > from) runs.push([from, ts[i - 1]]);
      from = ts[i];
    }
  }
  return runs;
}

/** cacheRead over everything sent, on sessions big enough to mean something. */
function cacheRatio(t) {
  const pool = t.input + t.cacheRead + t.cacheWrite;
  return pool < 100_000 ? null : t.cacheRead / pool;
}

const hasFacet = (s) => s.outcome !== "unknown" && s.outcome !== "in_progress";
const succeeded = (s) => s.outcome === "fully_achieved" || s.outcome === "mostly_achieved";

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Longest run of active days; a quiet Saturday or Sunday does not break it. */
function bestWeekdayStreak(days, fromMs, toMs) {
  let cur = 0;
  let best = 0;
  const d = new Date(fromMs);
  d.setHours(12, 0, 0, 0);
  for (; d.getTime() <= toMs; d.setDate(d.getDate() + 1)) {
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (days.has(dayKey(d.getTime()))) best = Math.max(best, ++cur);
    else if (!weekend) cur = 0;
  }
  return best;
}

/** Most runs overlapping at one instant (sweep over start/end events). */
function maxOverlap(runs) {
  const ev = runs.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let best = 0;
  for (const [, d] of ev) best = Math.max(best, (cur += d));
  return best;
}

/** Wall time covered by at least one run, so parallel sessions count once. */
function unionMs(runs) {
  const sorted = [...runs].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of sorted) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  return cur ? total + cur[1] - cur[0] : total;
}

/* ---- Catalog ---- */

/**
 * `metric(ctx)` returns the family's value, or one value per tier when tiers
 * measure different thresholds (cache, sniper). `targets` lines up with TIERS,
 * starting at `firstTier`.
 */
const FAMILIES = [
  // Per-session records (rarity)
  { id: "marathon", name: "Marathon", icon: "🏃", unit: "min", hint: "Longest continuous stretch in one session; pauses of 15 min or less don't break it", targets: [30, 60, 120, 240], metric: (c) => Math.floor(c.longestRunMs / 60_000) },
  { id: "orchestrator", name: "Orchestrator", icon: "🐝", hint: "Most sub-agents in one session", targets: [1, 5, 20, 50], metric: (c) => max(c.sessions, (s) => s.subAgents) },
  { id: "surgeon", name: "File surgeon", icon: "🩺", hint: "Most files changed in one session", targets: [5, 10, 25, 50], metric: (c) => max(c.sessions, (s) => s.filesChanged) },
  { id: "toolbox", name: "Toolbox", icon: "🧰", hint: "Most distinct tools used in one session", targets: [8, 10, 15], metric: (c) => max(c.sessions, (s) => Object.keys(s.toolCounts ?? {}).length) },
  { id: "juggler", name: "Juggler", icon: "🤹", hint: "Sessions actively running at the same time", targets: [2, 3, 5, 8], metric: (c) => maxOverlap(c.runs) },
  { id: "oneshot", name: "One-shot", icon: "🏹", hint: "Sessions where a single prompt ended in a commit", firstTier: 2, targets: [1, 5], metric: (c) => count(c.sessions, (s) => (s.prompts?.length ?? 0) === 1 && s.commits > 0) },

  // Rolling 30 days
  { id: "shipper", name: "Shipper", icon: "🚢", window: "30d", hint: "Days with a commit made by Claude in the last 30 days", targets: [3, 8, 15, 22], metric: (c) => c.commitDays30 },
  { id: "cache", name: "Cache keeper", icon: "🧊", window: "30d", hint: "Sessions over 100k tokens in the last 30 days with a cache hit of 95% (bronze, silver) or 98% (gold)", targets: [1, 10, 25], metric: (c) => [c.cache95, c.cache95, c.cache98] },
  { id: "streak", name: "Streak", icon: "🔥", hint: "Consecutive active days; quiet weekends don't break it", targets: [3, 7, 14, 30], metric: (c) => c.streak },

  // Shipping and rigor (shell commands run by Claude)
  { id: "pr", name: "PR opener", icon: "🔀", hint: "Pull requests opened with gh pr create", targets: [1, 10, 200, 1000], metric: (c) => sum(c.sessions, (s) => s.shell?.prs ?? 0) },
  { id: "tester", name: "Tester", icon: "🧪", hint: "Sessions that ran tests", targets: [1, 10, 100, 300], metric: (c) => count(c.sessions, (s) => s.shell?.tests > 0) },
  { id: "gatekeeper", name: "Gatekeeper", icon: "🚦", hint: "Sessions that ran a lint, typecheck or build", targets: [1, 10, 100, 300], metric: (c) => count(c.sessions, (s) => s.shell?.lints > 0) },
  { id: "infra", name: "Infra", icon: "🏗️", hint: "Sessions that ran docker, kubectl, terraform, gcloud…", targets: [1, 10, 50, 200], metric: (c) => count(c.sessions, (s) => s.shell?.infra > 0) },
  { id: "explorer", name: "Explorer", icon: "🧭", hint: "Projects with at least one commit", targets: [2, 5, 15, 40], metric: (c) => new Set(c.sessions.filter((s) => s.commits > 0).map((s) => s.project)).size },

  // Ways of working
  { id: "planner", name: "Planner", icon: "🗺️", hint: "Sessions that went through plan mode", targets: [1, 10, 50, 200], metric: (c) => count(c.sessions, (s) => s.toolCounts?.ExitPlanMode > 0) },
  { id: "researcher", name: "Researcher", icon: "🔎", hint: "Sessions that searched or fetched the web", targets: [1, 10, 50, 150], metric: (c) => count(c.sessions, (s) => s.toolCounts?.WebSearch > 0 || s.toolCounts?.WebFetch > 0) },
  { id: "skills", name: "Skill user", icon: "🪄", hint: "Sessions that used a skill", targets: [1, 10, 75, 200], metric: (c) => count(c.sessions, (s) => s.toolCounts?.Skill > 0) },
  { id: "mcp", name: "MCP collector", icon: "🔌", hint: "Distinct MCP servers used", targets: [1, 4, 8, 12], metric: (c) => new Set(c.sessions.flatMap((s) => Object.keys(s.toolCounts ?? {}).filter((k) => k.startsWith("mcp:")))).size },
  { id: "models", name: "Model tourist", icon: "🧬", hint: "Model families used (Haiku, Sonnet, Opus, Fable)", targets: [2, 3, 4], metric: (c) => new Set(c.sessions.flatMap((s) => (s.turns ?? []).map((t) => (t.model ?? s.model).split("-")[0]))).size },

  // Milestones
  { id: "veteran", name: "Veteran", icon: "🎖️", hint: "Sessions", targets: [10, 100, 500, 1500], metric: (c) => c.sessions.length },
  { id: "hours", name: "Hours", icon: "⏳", unit: "h", hint: "Hours of continuous work; parallel sessions count once", targets: [10, 100, 300, 1000], metric: (c) => Math.floor(unionMs(c.runs) / 3_600_000) },
  { id: "editor", name: "Editor", icon: "✍️", hint: "Edit and Write calls", targets: [100, 1000, 10_000, 40_000], metric: (c) => sum(c.sessions, (s) => (s.toolCounts?.Edit ?? 0) + (s.toolCounts?.Write ?? 0) + (s.toolCounts?.MultiEdit ?? 0)) },

  // Need /insights facets or scored sessions; hidden without them.
  { id: "sniper", name: "Sniper", icon: "🎯", requires: "insights", hint: "Fully achieved sessions: any (bronze), with under 2 frictions (silver), with none (gold). Needs /insights", targets: [1, 5, 10], metric: (c) => [count(c.sessions, (s) => s.outcome === "fully_achieved"), count(c.sessions, (s) => s.outcome === "fully_achieved" && s.frictions.length < 2), count(c.sessions, (s) => s.outcome === "fully_achieved" && s.frictions.length === 0)] },
  { id: "comeback", name: "Comeback", icon: "🧗", requires: "insights", hint: "Sessions that hit friction and still got (mostly) done. Needs /insights", targets: [1, 10, 75, 200], metric: (c) => count(c.sessions, (s) => s.frictions.length > 0 && succeeded(s)) },
  { id: "hygiene", name: "Context hygiene", icon: "🫧", requires: "quality", hint: "Sessions with a context quality score of 90+", targets: [1, 25, 100, 300], metric: (c) => count(c.sessions, (s) => (s.quality?.score ?? 0) >= 90) },
];

function count(arr, fn) { let n = 0; for (const x of arr) if (fn(x)) n++; return n; }
function sum(arr, fn) { let n = 0; for (const x of arr) n += fn(x); return n; }
function max(arr, fn) { let n = 0; for (const x of arr) n = Math.max(n, fn(x)); return n; }

/** Total badge count (one per family tier), for docs and sanity checks. */
export const BADGE_COUNT = FAMILIES.reduce((a, f) => a + f.targets.length, 0);

/* ---- Context ---- */

function buildContext(sessions, now) {
  const runs = sessions.flatMap(runsOf);
  const days = new Set();
  const commitDays = new Set();
  let cache95 = 0;
  let cache98 = 0;
  for (const s of sessions) {
    const base = startMs(s);
    for (const ts of activity(s)) days.add(dayKey(ts));
    for (const e of s.timeline ?? []) {
      const ts = base + e.t;
      if (e.kind === "commit" && now - ts < WINDOW_MS) commitDays.add(dayKey(ts));
    }
    if (now - base < WINDOW_MS) {
      const r = cacheRatio(s.tokens);
      if (r !== null && r >= 0.95) cache95++;
      if (r !== null && r >= 0.98) cache98++;
    }
  }
  return {
    sessions,
    runs,
    longestRunMs: runs.reduce((a, [x, y]) => Math.max(a, y - x), 0),
    commitDays30: commitDays.size,
    cache95,
    cache98,
    days,
  };
}

/* ---- State ---- */

export function badgeStatePath(claudeDir) {
  return join(claudeDir, "ccblackbox", "badges.json");
}

/** Reads badges.json, creating it (first launch = now) when missing. */
export async function loadBadgeState(path, now = Date.now()) {
  try {
    const st = JSON.parse(await fsp.readFile(path, "utf8"));
    if (typeof st.startedAt === "string" && !Number.isNaN(Date.parse(st.startedAt))) {
      return { startedAt: st.startedAt, unlocked: st.unlocked && typeof st.unlocked === "object" ? st.unlocked : {} };
    }
  } catch { /* missing or unreadable: start fresh */ }
  const fresh = { startedAt: new Date(now).toISOString(), unlocked: {} };
  await saveBadgeState(path, fresh);
  return fresh;
}

export async function saveBadgeState(path, state) {
  try {
    await fsp.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ version: 1, ...state }, null, 2) + "\n");
    await fsp.rename(tmp, path);
  } catch (e) {
    console.error("[ccblackbox] could not save badges:", e.message);
  }
}

/* ---- Compute ---- */

/**
 * Progress for every family. Records new unlocks in `state.unlocked`
 * (`<family>:<tier>` → ISO date) and returns whether it changed.
 */
export function computeBadges(allSessions, state, now = Date.now()) {
  const since = Date.parse(state.startedAt);
  // Badges are earned with Claude Code: Codex sessions don't count (their tools and models differ).
  const sessions = allSessions.filter((s) => !s.ghost && s.agent !== "codex" && startMs(s) >= since);
  const ctx = buildContext(sessions, now);
  ctx.streak = bestWeekdayStreak(ctx.days, since, now);
  const available = {
    insights: allSessions.some(hasFacet),
    quality: allSessions.some((s) => s.quality),
  };

  let changed = false;
  const families = FAMILIES.map((f) => {
    const raw = f.metric(ctx);
    const first = f.firstTier ?? 0;
    const tiers = f.targets.map((target, i) => {
      const tier = TIERS[first + i];
      const key = `${f.id}:${tier}`;
      const progress = Array.isArray(raw) ? raw[i] : raw;
      if (!state.unlocked[key] && progress >= target) {
        state.unlocked[key] = new Date(now).toISOString();
        changed = true;
      }
      return { tier, target, progress: Math.min(progress, target), unlockedAt: state.unlocked[key] ?? null };
    });
    return {
      id: f.id,
      name: f.name,
      icon: f.icon,
      hint: f.hint,
      unit: f.unit ?? null,
      window: f.window ?? "ever",
      available: f.requires ? available[f.requires] : true,
      tiers,
    };
  });

  return { startedAt: state.startedAt, total: BADGE_COUNT, families, changed };
}
