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

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

/** Longest run of active days; a quiet Saturday or Sunday does not break it. */
function bestWeekdayStreak(days, fromMs, toMs) {
  let cur = 0;
  let best = 0;
  const d = new Date(fromMs);
  d.setHours(12, 0, 0, 0);
  for (; d.getTime() <= toMs; d.setDate(d.getDate() + 1)) {
    if (days.has(dayKey(d.getTime()))) best = Math.max(best, ++cur);
    else if (!isWeekend(d)) cur = 0;
  }
  return best;
}

/**
 * The streak still alive today, by the same rule as bestWeekdayStreak. A quiet
 * today doesn't end it yet: on a weekday it is only at risk.
 */
export function currentStreak(days, now = Date.now()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  const activeToday = days.has(dayKey(d.getTime()));
  const weekday = !isWeekend(d);
  let current = activeToday ? 1 : 0;
  for (let i = 0; i < 3650; i++) {
    d.setDate(d.getDate() - 1);
    if (days.has(dayKey(d.getTime()))) current++;
    else if (!isWeekend(d)) break;
  }
  return { current, activeToday, atRisk: current > 0 && !activeToday && weekday };
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
 * starting at `firstTier`. `nudge` marks families that reward good practice:
 * only they are suggested as the next goal ("Next up"), never volume or spend.
 */
const FAMILIES = [
  // Per-session records (rarity)
  { id: "marathon", name: "Marathon", icon: "🏃", unit: "min", hint: "Longest continuous stretch in one session; pauses of 15 min or less don't break it", targets: [30, 60, 120, 240], metric: (c) => Math.floor(c.longestRunMs / 60_000) },
  { id: "orchestrator", name: "Orchestrator", icon: "🐝", hint: "Most sub-agents in one session", targets: [1, 5, 20, 50], metric: (c) => max(c.sessions, (s) => s.subAgents) },
  { id: "surgeon", name: "File surgeon", icon: "🩺", hint: "Most files changed in one session", targets: [5, 10, 25, 50], metric: (c) => max(c.sessions, (s) => s.filesChanged) },
  { id: "toolbox", name: "Toolbox", icon: "🧰", hint: "Most distinct tools used in one session", targets: [8, 10, 15], metric: (c) => max(c.sessions, (s) => Object.keys(s.toolCounts ?? {}).length) },
  { id: "juggler", name: "Juggler", icon: "🤹", hint: "Sessions actively running at the same time", targets: [2, 3, 5, 8], metric: (c) => maxOverlap(c.runs) },
  { id: "oneshot", nudge: true, name: "One-shot", icon: "🏹", hint: "Sessions where a single prompt ended in a commit", firstTier: 2, targets: [1, 5], metric: (c) => count(c.sessions, (s) => (s.prompts?.length ?? 0) === 1 && s.commits > 0) },

  // Rolling 30 days
  { id: "shipper", nudge: true, name: "Shipper", icon: "🚢", window: "30d", hint: "Days with a commit made by Claude in the last 30 days", targets: [3, 8, 15, 22], metric: (c) => c.commitDays30 },
  { id: "cache", nudge: true, name: "Cache keeper", icon: "🧊", window: "30d", hint: "Sessions over 100k tokens in the last 30 days with a cache hit of 95% (bronze, silver) or 98% (gold)", targets: [1, 10, 25], metric: (c) => [c.cache95, c.cache95, c.cache98] },
  { id: "streak", name: "Streak", icon: "🔥", hint: "Best run of active days in a row since ccblackbox first ran; quiet weekends don't break it", targets: [3, 7, 14, 30], metric: (c) => c.streak },

  // Shipping and rigor (shell commands run by Claude)
  { id: "pr", nudge: true, name: "PR opener", icon: "🔀", hint: "Pull requests opened with gh pr create", targets: [1, 10, 200, 1000], metric: (c) => sum(c.sessions, (s) => s.shell?.prs ?? 0) },
  { id: "tester", nudge: true, name: "Tester", icon: "🧪", hint: "Sessions that ran tests", targets: [1, 10, 100, 300], metric: (c) => count(c.sessions, (s) => s.shell?.tests > 0) },
  { id: "gatekeeper", nudge: true, name: "Gatekeeper", icon: "🚦", hint: "Sessions that ran a lint, typecheck or build", targets: [1, 10, 100, 300], metric: (c) => count(c.sessions, (s) => s.shell?.lints > 0) },
  { id: "infra", name: "Infra", icon: "🏗️", hint: "Sessions that ran docker, kubectl, terraform, gcloud…", targets: [1, 10, 50, 200], metric: (c) => count(c.sessions, (s) => s.shell?.infra > 0) },
  { id: "explorer", name: "Explorer", icon: "🧭", hint: "Projects with at least one commit", targets: [2, 5, 15, 40], metric: (c) => new Set(c.sessions.filter((s) => s.commits > 0).map((s) => s.project)).size },

  // Ways of working
  { id: "planner", nudge: true, name: "Planner", icon: "🗺️", hint: "Sessions that went through plan mode", targets: [1, 10, 50, 200], metric: (c) => count(c.sessions, (s) => s.toolCounts?.ExitPlanMode > 0) },
  { id: "researcher", name: "Researcher", icon: "🔎", hint: "Sessions that searched or fetched the web", targets: [1, 10, 50, 150], metric: (c) => count(c.sessions, (s) => s.toolCounts?.WebSearch > 0 || s.toolCounts?.WebFetch > 0) },
  { id: "skills", name: "Skill user", icon: "🪄", hint: "Sessions that used a skill", targets: [1, 10, 75, 200], metric: (c) => count(c.sessions, (s) => s.toolCounts?.Skill > 0) },
  { id: "mcp", name: "MCP collector", icon: "🔌", hint: "Distinct MCP servers used", targets: [1, 4, 8, 12], metric: (c) => new Set(c.sessions.flatMap((s) => Object.keys(s.toolCounts ?? {}).filter((k) => k.startsWith("mcp:")))).size },
  { id: "models", name: "Model tourist", icon: "🧬", hint: "Model families used (Haiku, Sonnet, Opus, Fable)", targets: [2, 3, 4], metric: (c) => new Set(c.sessions.flatMap((s) => (s.turns ?? []).map((t) => (t.model ?? s.model).split("-")[0]))).size },

  // Milestones
  { id: "veteran", name: "Veteran", icon: "🎖️", hint: "Sessions", targets: [10, 100, 500, 1500], metric: (c) => c.sessions.length },
  { id: "hours", name: "Hours", icon: "⏳", unit: "h", hint: "Hours of continuous work; parallel sessions count once", targets: [10, 100, 300, 1000], metric: (c) => Math.floor(unionMs(c.runs) / 3_600_000) },
  { id: "editor", name: "Editor", icon: "✍️", hint: "Edit and Write calls", targets: [100, 1000, 10_000, 40_000], metric: (c) => sum(c.sessions, (s) => (s.toolCounts?.Edit ?? 0) + (s.toolCounts?.Write ?? 0) + (s.toolCounts?.MultiEdit ?? 0)) },

  // Need /insights facets or scored sessions; hidden without them.
  { id: "sniper", nudge: true, name: "Sniper", icon: "🎯", requires: "insights", hint: "Fully achieved sessions: any (bronze), with under 2 frictions (silver), with none (gold). Needs /insights", targets: [1, 5, 10], metric: (c) => [count(c.sessions, (s) => s.outcome === "fully_achieved"), count(c.sessions, (s) => s.outcome === "fully_achieved" && s.frictions.length < 2), count(c.sessions, (s) => s.outcome === "fully_achieved" && s.frictions.length === 0)] },
  { id: "comeback", nudge: true, name: "Comeback", icon: "🧗", requires: "insights", hint: "Sessions that hit friction and still got (mostly) done. Needs /insights", targets: [1, 10, 75, 200], metric: (c) => count(c.sessions, (s) => s.frictions.length > 0 && succeeded(s)) },
  { id: "hygiene", nudge: true, name: "Context hygiene", icon: "🫧", requires: "quality", hint: "Ended sessions with a context quality score of 90+", targets: [1, 25, 100, 300], metric: (c) => count(c.sessions, (s) => !s.live && (s.quality?.score ?? 0) >= 90) },
];

function count(arr, fn) { let n = 0; for (const x of arr) if (fn(x)) n++; return n; }
function sum(arr, fn) { let n = 0; for (const x of arr) n += fn(x); return n; }
function max(arr, fn) { let n = 0; for (const x of arr) n = Math.max(n, fn(x)); return n; }

/** Total badge count (one per family tier), for docs and sanity checks. */
export const BADGE_COUNT = FAMILIES.reduce((a, f) => a + f.targets.length, 0);

/* ---- XP and level ---- */

/**
 * XP rewards how a session was run, never how much it spent. Like badges, only
 * Claude Code sessions earn it; unlike badges, sessions from before the first
 * launch count, so the level is real on day one.
 * Calibrated on real history so shipping and checks (commit, tests, lint) make
 * most of it: nearly every session reaches 5 turns and a context score of 90.
 */
const SESSION_XP = [
  { label: "5+ turns", points: 1, test: (s) => (s.turns ?? []).filter((t) => !t.sidechain).length >= 5 },
  { label: "commit", points: 3, test: (s) => s.commits > 0 },
  { label: "tests", points: 2, test: (s) => s.shell?.tests > 0 },
  { label: "lint, typecheck or build", points: 2, test: (s) => s.shell?.lints > 0 },
  // Provisional while the session runs: the score falls as the context grows.
  { label: "context score 90+", points: 1, provisional: true, test: (s) => (s.quality?.score ?? 0) >= 90 },
];
/**
 * XP for a family's first, second, third and fourth tier, whatever their
 * color: One-shot starts at gold for rarity, but its first step is worth 5.
 * Only good-practice badges (`nudge`) add XP: volume and spend badges unlock
 * but earn nothing.
 */
const STEP_XP = [5, 15, 40, 100];
const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));
function tierXp(familyId, tier) {
  const f = FAMILY_BY_ID.get(familyId);
  return f?.nudge ? STEP_XP[TIERS.indexOf(tier) - (f.firstTier ?? 0)] ?? 0 : 0;
}
/** Level n starts at LEVEL_UNIT × (n-1)²: a new user levels up daily, a heavy one every week or two. */
const LEVEL_UNIT = 4;
const LEVEL_TITLES = [[1, "Rookie"], [5, "Apprentice"], [10, "Builder"], [15, "Artisan"], [20, "Expert"], [25, "Master"], [30, "Virtuoso"], [40, "Grandmaster"], [50, "Legend"]];

/** `settled: false` leaves out what can still drop while the session runs. */
export function sessionXp(s, settled = true) {
  return sum(SESSION_XP, (r) => (r.test(s) && (settled || !r.provisional) ? r.points : 0));
}

export function levelOf(xp) {
  const level = Math.floor(Math.sqrt(xp / LEVEL_UNIT)) + 1;
  return {
    level,
    title: LEVEL_TITLES.findLast(([from]) => level >= from)[1],
    xp,
    from: LEVEL_UNIT * (level - 1) ** 2,
    next: LEVEL_UNIT * level ** 2,
  };
}

const XP_RULES = SESSION_XP.map(({ label, points }) => ({ label, points }));

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
      const obj = (v) => (v && typeof v === "object" ? v : {});
      return { startedAt: st.startedAt, unlocked: obj(st.unlocked), xp: obj(st.xp) };
    }
  } catch { /* missing or unreadable: start fresh */ }
  const fresh = { startedAt: new Date(now).toISOString(), unlocked: {}, xp: {} };
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
 * Progress for every family, the level and the current streak. Records new
 * unlocks in `state.unlocked` (`<family>:<tier>` → ISO date) and each
 * session's best XP in `state.xp` (id → points, so the level never drops when
 * Claude Code cleans up old transcripts), and returns whether either changed.
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
  state.xp ??= {};
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const days = new Set();
  let xpToday = 0;
  let xpLive = 0;
  for (const s of allSessions) {
    if (s.ghost) continue;
    const acts = activity(s);
    for (const ts of acts) days.add(dayKey(ts));
    // The streak is activity with any agent; XP is banked for good, so Codex (no context score) earns none.
    if (s.agent === "codex") continue;
    const earned = sessionXp(s);
    // A live session banks what can only go up (so a crash keeps it); its context point stays provisional.
    const bankable = s.live ? sessionXp(s, false) : earned;
    if (bankable > (state.xp[s.id] ?? 0)) {
      state.xp[s.id] = bankable;
      changed = true;
    }
    if (s.live) xpLive += Math.max(0, earned - (state.xp[s.id] ?? 0));
    if (acts.at(-1) >= midnight) xpToday += Math.max(state.xp[s.id] ?? 0, earned);
  }

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
      return { tier, target, progress: Math.min(progress, target), unlockedAt: state.unlocked[key] ?? null, xp: tierXp(f.id, tier) };
    });
    return {
      id: f.id,
      name: f.name,
      icon: f.icon,
      hint: f.hint,
      unit: f.unit ?? null,
      window: f.window ?? "ever",
      available: f.requires ? available[f.requires] : true,
      nudge: f.nudge ?? false,
      tiers,
    };
  });

  let xp = sum(Object.values(state.xp), (n) => n) + xpLive;
  for (const [key, at] of Object.entries(state.unlocked)) {
    const [id, tier] = key.split(":");
    const points = tierXp(id, tier);
    xp += points;
    if (Date.parse(at) >= midnight) xpToday += points;
  }

  return {
    startedAt: state.startedAt,
    total: BADGE_COUNT,
    families,
    level: { ...levelOf(xp), today: xpToday, rules: XP_RULES, stepXp: STEP_XP },
    streak: currentStreak(days, now),
    changed,
  };
}
