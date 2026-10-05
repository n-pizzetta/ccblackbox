// Usage limits as several Claude Code sessions overwrite them (scripts/parse-sessions.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshestWindow, mergeLimits } from "../scripts/parse-sessions.mjs";

const NOW = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;
const RESET = NOW + 2 * HOUR;
const win = (usedPct, resetsAt = RESET) => ({ usedPct, resetsAt });
const limits = (fiveHour, sevenDay = win(31, NOW + 72 * HOUR)) => ({ capturedAt: NOW, fiveHour, sevenDay });

test("a stale session never moves the window back", () => {
  const held = win(58);
  assert.deepEqual(freshestWindow(held, win(46), NOW), held, "lower % in the same window");
  assert.deepEqual(freshestWindow(held, null, NOW), held, "no 5h window");
  // normalizeWindow turns a window that has reset into { usedPct: 0, resetsAt: null }.
  assert.deepEqual(freshestWindow(held, { usedPct: 0, resetsAt: null }, NOW), held, "a window from days ago");
});

test("use grows within a window and a new window replaces the old one", () => {
  assert.deepEqual(freshestWindow(win(58), win(60), NOW), win(60));
  assert.deepEqual(freshestWindow(win(58), win(3, RESET + 5 * HOUR), NOW), win(3, RESET + 5 * HOUR));
});

test("once the held window has reset, the latest reading wins, whatever it says", () => {
  const after = RESET + 1;
  assert.deepEqual(freshestWindow(win(58), win(4, RESET + 5 * HOUR), after), win(4, RESET + 5 * HOUR));
  assert.deepEqual(freshestWindow(win(58), { usedPct: 0, resetsAt: null }, after), { usedPct: 0, resetsAt: null });
  assert.equal(freshestWindow(win(58), null, after), null);
});

test("readings flipping between sessions settle on the freshest one", () => {
  const reads = [win(51), null, win(58), { usedPct: 0, resetsAt: null }, win(46), win(58), null];
  let held = null;
  const seen = reads.map((five) => (held = mergeLimits(held, limits(five), NOW)).fiveHour);
  assert.deepEqual(seen, [win(51), win(51), win(58), win(58), win(58), win(58), win(58)]);
});

test("no limits.json clears what was held", () => {
  assert.equal(mergeLimits(limits(win(58)), null, NOW), null);
});
