// Friction markers on the session timeline (src/utils/frictionTimes.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { frictionTimes } from "../src/utils/frictionTimes.ts";

const f = (at) => ({ at, kind: "tool_error", detail: "A command failed" });

test("a friction sits at its fraction of the session's span", () => {
  const out = frictionTimes([f(0), f(0.25), f(0.5), f(1)], 10_000, 50_000);
  assert.deepEqual(out.map((x) => x.t), [10_000, 20_000, 30_000, 50_000]);
  assert.deepEqual(out[1], { t: 20_000, kind: "tool_error", detail: "A command failed" });
});

test("positions outside 0–1 stay on the chart", () => {
  assert.deepEqual(frictionTimes([f(-0.2), f(1.4)], 0, 1_000).map((x) => x.t), [0, 1_000]);
});

test("on a chart with a shortened idle gap, the fraction is of the chart, so no marker falls in the gap", () => {
  // 0–10s of work, then a 100s pause drawn as 1s, then 10s of work: the axis is 21 units long
  const axis = (t) => (t <= 10_000 ? t : t <= 110_000 ? 10_000 + (t - 10_000) / 100 : t - 99_000);
  const out = frictionTimes([f(0.25), f(0.75)], 0, 120_000, axis);
  assert.ok(Math.abs(out[0].t - 5_250) <= 1, `${out[0].t}`);
  assert.ok(Math.abs(out[1].t - 114_750) <= 1, `${out[1].t}`);
  assert.ok(out.every((x) => x.t <= 10_000 || x.t >= 110_000), "none inside the pause");
});

test("no span, no spread: every friction at the start", () => {
  assert.deepEqual(frictionTimes([f(0.3), f(0.9)], 5_000, 5_000).map((x) => x.t), [5_000, 5_000]);
});
