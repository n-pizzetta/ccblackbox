// A prompt's share of the session, in the unit its weight is shown in (src/utils/promptShare.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promptWeights } from "../src/utils/promptShare.ts";

// the case the old panel got wrong: 24.8k of 319.0k fresh tokens is 7.8%, while its API value is 9.5%
const stats = [
  { fresh: 24_800, cost: 0.246 },
  { fresh: 134_800, cost: 0.952 },
  { fresh: 117_900, cost: 0.878 },
  { fresh: 41_500, cost: 0.514 },
];

test("in tokens, the share is of the session's fresh tokens", () => {
  const w = promptWeights(stats, "tokens");
  assert.equal(w[0].value, 24_800);
  assert.equal((w[0].share * 100).toFixed(1), "7.8");
});

test("in API value, the share is of the session's API value", () => {
  const w = promptWeights(stats, "usd");
  assert.equal(w[0].value, 0.246);
  assert.equal((w[0].share * 100).toFixed(1), "9.5");
});

test("shares add up to the whole session, and an empty session has no shares", () => {
  for (const unit of ["tokens", "usd"]) {
    const sum = promptWeights(stats, unit).reduce((a, w) => a + w.share, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, unit);
  }
  assert.deepEqual(promptWeights([{ fresh: 0, cost: 0 }], "tokens"), [{ value: 0, share: 0 }]);
});
