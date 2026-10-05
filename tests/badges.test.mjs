// XP, level and streak on synthetic sessions (scripts/badges.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBadges, currentStreak, levelOf, sessionXp } from "../scripts/badges.mjs";

const HOUR = 3_600_000;

/** Noon on the first Monday on or after 2026-10-05, local time. */
function monday() {
  const d = new Date(2026, 9, 5, 12);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}
const daysFrom = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).getTime();
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const freshState = (now) => ({ startedAt: new Date(now - 30 * 24 * HOUR).toISOString(), unlocked: {}, xp: {} });
/** Badges only count sessions after `startedAt`: starting later isolates session XP from badge XP. */
const xpOnlyState = (now) => ({ startedAt: new Date(now + HOUR).toISOString(), unlocked: {}, xp: {} });

function session(id, startMs, extra = {}) {
  return {
    id,
    project: "p",
    model: "claude-sonnet-5-5",
    startedAt: new Date(startMs).toISOString(),
    turns: Array.from({ length: 6 }, (_, i) => ({ t: i * 60_000 })),
    prompts: [{ t: 0 }],
    tokens: { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 },
    toolCounts: {},
    commits: 0,
    shell: { prs: 0, tests: 0, lints: 0, infra: 0 },
    subAgents: 0,
    filesChanged: 0,
    outcome: "unknown",
    frictions: [],
    quality: null,
    timeline: [],
    ...extra,
  };
}

test("session XP rewards how the session was run, not its size", () => {
  const base = session("a", Date.now());
  assert.equal(sessionXp(base), 1, "5+ turns");
  assert.equal(sessionXp({ ...base, turns: [{ t: 0 }] }), 0);
  const crafted = { ...base, commits: 3, shell: { prs: 0, tests: 4, lints: 1, infra: 0 }, quality: { score: 92 } };
  assert.equal(sessionXp(crafted), 9);
  assert.equal(sessionXp({ ...base, quality: { score: 85 } }), 1, "context score below 90 earns nothing");
  const burner = { ...base, tokens: { input: 5_000_000, output: 2_000_000, cacheRead: 40_000_000, cacheWrite: 3_000_000 } };
  assert.equal(sessionXp(burner), 1, "spend alone earns nothing");
});

test("level n starts at 4 × (n-1)² XP", () => {
  assert.deepEqual(levelOf(0), { level: 1, title: "Rookie", xp: 0, from: 0, next: 4 });
  assert.equal(levelOf(3).level, 1);
  assert.equal(levelOf(4).level, 2);
  assert.equal(levelOf(64).level, 5);
  assert.equal(levelOf(64).title, "Apprentice");
});

test("XP is banked per session: the level never drops when transcripts are cleaned up", () => {
  const now = monday().getTime();
  const state = freshState(now);
  const old = session("old", now - 10 * 24 * HOUR, { commits: 1 });
  const first = computeBadges([old, session("ghost", now - HOUR, { ghost: true, commits: 1 })], state, now);
  assert.equal(state.xp.old, 4);
  assert.equal(state.xp.ghost, undefined, "ghosts earn nothing");
  assert.ok(first.changed);

  const again = computeBadges([], state, now);
  assert.equal(state.xp.old, 4, "kept after the transcript is gone");
  assert.equal(again.level.xp, first.level.xp);

  // A lower recount (e.g. only the /insights meta is left) never lowers the bank.
  computeBadges([{ ...old, commits: 0, turns: [] }], state, now);
  assert.equal(state.xp.old, 4);
});

test("a live session banks what only goes up; its context point waits for the end", () => {
  const now = monday().getTime();
  const state = xpOnlyState(now);
  // Early on, the context score is high...
  const early = computeBadges([session("s", now - HOUR, { live: true, commits: 1, quality: { score: 97 } })], state, now);
  assert.equal(state.xp.s, 4, "turns and commit are banked");
  assert.equal(early.level.xp, 5, "the context point counts, provisionally");
  // ...and falls as the session grows: the early point is not kept.
  const ended = computeBadges([session("s", now - HOUR, { commits: 1, quality: { score: 31 } })], state, now);
  assert.equal(state.xp.s, 4);
  assert.equal(ended.level.xp, 4);
});

test("a new live session with nothing to bank yet", () => {
  const now = monday().getTime();
  const state = xpOnlyState(now);
  const young = session("s", now - HOUR, { live: true, turns: [{ t: 0 }, { t: 60_000 }], quality: { score: 97 } });
  const out = computeBadges([session("done", now - 2 * HOUR), young], state, now);
  assert.equal(state.xp.s, undefined);
  assert.equal(out.level.xp, 2, "the ended session's point plus the live context point");
  assert.equal(out.level.title, "Rookie");
});

test("a live session that crashes keeps what it banked", () => {
  const now = monday().getTime();
  const state = xpOnlyState(now);
  const work = { commits: 1, shell: { prs: 0, tests: 1, lints: 1, infra: 0 } };
  computeBadges([session("s", now - HOUR, { live: true, ...work })], state, now);
  const crashed = computeBadges([session("s", now - HOUR, { ghost: true, ...work })], state, now);
  assert.equal(crashed.level.xp, 8);
});

test("a live session's early context score doesn't unlock Context hygiene", () => {
  const now = monday().getTime();
  const state = freshState(now);
  computeBadges([session("s", now - HOUR, { live: true, quality: { score: 97 } })], state, now);
  assert.equal(state.unlocked["hygiene:bronze"], undefined);
  computeBadges([session("s", now - HOUR, { quality: { score: 97 } })], state, now);
  assert.ok(state.unlocked["hygiene:bronze"]);
});

test("Codex sessions earn no XP but keep the streak alive", () => {
  const now = monday().getTime();
  const state = xpOnlyState(now);
  const work = { agent: "codex", commits: 1, shell: { prs: 0, tests: 1, lints: 1, infra: 0 } };
  const out = computeBadges([session("cx", now - HOUR, work)], state, now);
  assert.equal(state.xp.cx, undefined);
  assert.equal(out.level.xp, 0);
  assert.equal(out.level.today, 0);
  assert.deepEqual(out.streak, { current: 1, activeToday: true, atRisk: false });
});

test("only good-practice badges add XP", () => {
  const now = monday().getTime();
  const state = freshState(now);
  const out = computeBadges([session("a", now - HOUR, { subAgents: 50 })], state, now);
  assert.ok(state.unlocked["orchestrator:platinum"], "50 sub-agents unlock every Orchestrator tier");
  assert.equal(out.level.xp, 1, "...and add no XP");
  assert.ok(out.families.find((f) => f.id === "orchestrator").tiers.every((t) => t.xp === 0));
  assert.equal(out.families.find((f) => f.id === "tester").tiers[0].xp, 5);

  computeBadges([session("a", now - HOUR, { subAgents: 50, shell: { prs: 0, tests: 1, lints: 0, infra: 0 } })], state, now);
  assert.ok(state.unlocked["tester:bronze"]);
});

test("badge XP goes by tier reached, so One-shot's first tier (gold) is worth 5", () => {
  const now = monday().getTime();
  const out = computeBadges([session("a", now - HOUR, { commits: 1 })], freshState(now), now);
  const oneshot = out.families.find((f) => f.id === "oneshot");
  assert.deepEqual(oneshot.tiers.map((t) => [t.tier, t.xp]), [["gold", 5], ["platinum", 15]]);
  assert.ok(oneshot.tiers[0].unlockedAt, "one prompt that ends in a commit");
  assert.deepEqual(out.families.find((f) => f.id === "tester").tiers.map((t) => t.xp), [5, 15, 40, 100]);
});

test("every tier has its own name", () => {
  const now = monday().getTime();
  const out = computeBadges([], freshState(now), now);
  for (const f of out.families) {
    const names = f.tiers.map((t) => t.name);
    assert.ok(names.every((n) => typeof n === "string" && n.length > 0), f.id);
    assert.equal(new Set(names).size, names.length, `${f.id}: names repeat`);
  }
  assert.deepEqual(out.families.find((f) => f.id === "marathon").tiers.map((t) => t.name), ["5K", "10K", "Half marathon", "Marathon"]);
});

test("today's XP counts sessions worked in today and badges unlocked today", () => {
  const now = monday().getTime();
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const state = xpOnlyState(now);
  state.unlocked["tester:bronze"] = new Date(now - 24 * HOUR).toISOString();
  const yesterday = session("y", now - 30 * HOUR, { commits: 1 });
  // Started before midnight, committed after it.
  const overnight = session("o", midnight - 10 * 60_000, {
    commits: 1,
    turns: Array.from({ length: 6 }, (_, i) => ({ t: i * 10 * 60_000 })),
  });
  const out = computeBadges([yesterday, overnight], state, now);
  assert.equal(out.level.today, 4, "the overnight session, not yesterday's, and no badge unlocked today");
  assert.equal(out.level.xp, 4 + 4 + 5);
});

test("the current streak skips quiet weekends and is at risk on a quiet weekday", () => {
  const mon = monday();
  // Active Monday to Friday of the previous week, quiet weekend.
  const days = new Set([-7, -6, -5, -4, -3].map((n) => dayKey(daysFrom(mon, n))));
  assert.deepEqual(currentStreak(days, mon.getTime()), { current: 5, activeToday: false, atRisk: true });
  assert.deepEqual(currentStreak(days, daysFrom(mon, -1)), { current: 5, activeToday: false, atRisk: false }, "a quiet Sunday is not a risk");

  days.add(dayKey(mon.getTime()));
  assert.deepEqual(currentStreak(days, mon.getTime()), { current: 6, activeToday: true, atRisk: false });

  days.delete(dayKey(daysFrom(mon, -5)));
  assert.equal(currentStreak(days, mon.getTime()).current, 3, "a quiet Wednesday breaks it");
  assert.equal(currentStreak(new Set(), mon.getTime()).atRisk, false, "nothing to lose");
});

test("the payload flags good-practice families and carries the streak", () => {
  const now = monday().getTime();
  const out = computeBadges([session("a", now - HOUR)], freshState(now), now);
  const nudged = out.families.filter((f) => f.nudge).map((f) => f.id);
  assert.ok(nudged.includes("tester") && nudged.includes("cache"));
  for (const id of ["orchestrator", "juggler", "veteran", "streak"]) assert.ok(!nudged.includes(id), id);
  assert.deepEqual(out.streak, { current: 1, activeToday: true, atRisk: false });
});
