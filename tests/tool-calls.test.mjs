// Tool calls counted the same way everywhere, sub-agent calls included (src/utils/toolCalls.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { callsPerPrompt, countCalls, countFailed, countSubCalls, flattenCalls, onlyFailed } from "../src/utils/toolCalls.ts";

const ok = { text: "ok", truncated: false, isError: false };
const err = { text: "Error", truncated: false, isError: true };
const call = (t, tool, result = ok, extra = {}) => ({ t, tool, preview: tool, result, ...extra });

// 3 main-thread calls, one of which ran a sub-agent of 4 calls (1 failed), and a sub-agent without its call
const seq = [
  call(0, "Read"),
  call(10, "Agent", ok, { children: [call(11, "Grep"), call(12, "Read", err), call(13, "Read"), call(14, "Bash")] }),
  call(30, "Bash", err),
  { t: 40, tool: "Agent", preview: "Survey", orphan: true, children: [call(41, "Read"), call(42, "Grep")] },
];

test("every call counts once, sub-agent calls included, a stand-in row not at all", () => {
  assert.equal(countCalls(seq), 3 + 4 + 2);
  assert.equal(flattenCalls(seq).length, countCalls(seq));
  assert.equal(countSubCalls(seq), 6);
  assert.deepEqual(flattenCalls(seq).filter((c) => c.sub).map((c) => c.t), [11, 12, 13, 14, 41, 42]);
});

test("failed calls are counted in sub-agents too, and the failed view keeps them under their call", () => {
  assert.equal(countFailed(seq), 2);
  const failed = onlyFailed(seq);
  assert.deepEqual(failed.map((e) => [e.t, e.children?.map((c) => c.t) ?? null]), [[10, [12]], [30, null]]);
});

test("a prompt's calls include the sub-agent calls its Agent call started, even if they ran after the next prompt", () => {
  const prompts = [{ t: 0 }, { t: 12 }, { t: 35 }];
  // prompt 1: Read + Agent with its 4 calls; prompt 2: Bash; prompt 3: the stand-in's 2 calls
  assert.deepEqual(callsPerPrompt(seq, prompts), [6, 1, 2]);
});
