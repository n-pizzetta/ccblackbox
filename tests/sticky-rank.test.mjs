// Ranking of the Now page's 5h window lists (src/utils/stickyRank.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stickyRank } from "../src/utils/stickyRank.ts";

const rows = (weights) => Object.entries(weights).map(([id, w]) => ({ id, w }));
const rank = (weights, shown, margin) => stickyRank(rows(weights), (r) => r.id, (r) => r.w, shown, margin).map((r) => r.id);

test("heaviest first; equal weights break on the key, whatever the input order", () => {
  assert.deepEqual(rank({ c: 2, b: 5, a: 2 }), ["b", "a", "c"]);
  assert.deepEqual(rank({ a: 2, c: 2, b: 5 }), ["b", "a", "c"]);
});

test("a near tie keeps the order shown last time", () => {
  // b overtook a by 0.3, under the 0.5 margin: a stays first.
  assert.deepEqual(rank({ a: 10, b: 10.3, c: 4 }, ["a", "b", "c"], 0.5), ["a", "b", "c"]);
  // And the other way round: once b leads, a needs more than the margin to take it back.
  assert.deepEqual(rank({ a: 10.3, b: 10, c: 4 }, ["b", "a", "c"], 0.5), ["b", "a", "c"]);
});

test("a clear lead moves a row up", () => {
  assert.deepEqual(rank({ a: 10, b: 11, c: 4 }, ["a", "b", "c"], 0.5), ["b", "a", "c"]);
  assert.deepEqual(rank({ a: 10, b: 3, c: 12 }, ["a", "b", "c"], 0.5), ["c", "a", "b"]);
});

test("new rows join by weight and gone ones drop out", () => {
  assert.deepEqual(rank({ a: 10, c: 4, d: 7 }, ["a", "b", "c"], 0.5), ["a", "d", "c"]);
});

test("ranking its own result again changes nothing", () => {
  const weights = { a: 10, b: 10.4, c: 10.8, d: 3, e: 11.5 };
  for (const shown of [[], ["a", "b", "c", "d", "e"], ["e", "d", "c", "b", "a"], ["d", "a", "e"]]) {
    const once = rank(weights, shown, 0.5);
    assert.deepEqual(rank(weights, once, 0.5), once, `from ${shown.join(",")}`);
  }
});

test("two sessions climbing side by side don't swap on every poll", () => {
  // They take turns gaining 0.4, so a plain sort changes the leader on every poll.
  const leaders = (margin) => {
    let shown = [];
    let a = 5, b = 5.2;
    const out = [];
    for (let i = 0; i < 10; i++) {
      if (i % 2) b += 0.4; else a += 0.4;
      shown = rank({ a, b }, shown, margin);
      out.push(shown[0]);
    }
    return out.join("");
  };
  assert.equal(leaders(0), "ababababab");
  assert.equal(leaders(0.5), "aaaaaaaaaa");
});
