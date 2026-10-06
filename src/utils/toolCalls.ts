import type { ToolCall } from "../types";

/**
 * Counting tool calls the same way everywhere (the Tools tab and its count, the Overview, the
 * Timeline, the prompts): main-thread calls plus the calls of the sub-agents they started, which the
 * parser nests under them (scripts/subagent-calls.mjs). A row standing for a sub-agent whose call
 * wasn't found is not a call itself.
 */

export interface FlatCall extends ToolCall {
  /** Made by a sub-agent. */
  sub: boolean;
}

/** Every call once, each sub-agent's calls right after the call that started it. */
export function flattenCalls(seq: readonly ToolCall[]): FlatCall[] {
  const out: FlatCall[] = [];
  for (const e of seq) {
    if (!e.orphan) out.push({ ...e, sub: false });
    for (const c of e.children ?? []) out.push({ ...c, sub: true });
  }
  return out;
}

export function countCalls(seq: readonly ToolCall[]): number {
  let n = 0;
  for (const e of seq) n += (e.orphan ? 0 : 1) + (e.children?.length ?? 0);
  return n;
}

export const isFailed = (e: ToolCall) => !!e.result?.isError;

export function countFailed(seq: readonly ToolCall[]): number {
  return flattenCalls(seq).filter(isFailed).length;
}

export function countSubCalls(seq: readonly ToolCall[]): number {
  return seq.reduce((a, e) => a + (e.children?.length ?? 0), 0);
}

/** The main-thread calls made in [from, to), each with the sub-agent calls it started (whenever they ran). */
export function callsBetween(seq: readonly ToolCall[], from: number, to: number): ToolCall[] {
  return seq.filter((e) => e.t >= from && e.t < to);
}

/** Calls made while each prompt ran (until the next prompt), sub-agent calls counted with the call that started them. */
export function callsPerPrompt(seq: readonly ToolCall[], prompts: ReadonlyArray<{ t: number }>): number[] {
  return prompts.map((p, i) => countCalls(callsBetween(seq, p.t, prompts[i + 1]?.t ?? Infinity)));
}

/** Only the failed calls: a failed main-thread call, or a sub-agent's call with only its failed calls. */
export function onlyFailed(seq: readonly ToolCall[]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const e of seq) {
    const kids = e.children?.filter(isFailed) ?? [];
    if (isFailed(e) || kids.length) out.push({ ...e, children: kids.length ? kids : undefined });
  }
  return out;
}
