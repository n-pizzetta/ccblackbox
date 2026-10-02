#!/usr/bin/env node
/**
 * Generates a fake Claude config dir (what ~/.claude holds) with realistic,
 * fully synthetic data, for screenshots and for developing without exposing
 * real sessions.
 *
 *   pnpm seed:demo                                    # writes .demo-claude/
 *   CLAUDE_CONFIG_DIR="$PWD/.demo-claude" pnpm dev    # or: pnpm serve
 *
 * Deterministic (seeded) except for timestamps, which are relative to now so
 * the "today", 7d and 5h views are populated.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CLAUDE = resolve(process.argv[2] ?? ".demo-claude");
const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;

let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;

const PROJECTS = {
  "acme-api": [
    "Add rate limiting to the public REST endpoints",
    "Fix the flaky integration test in orders/checkout",
    "Migrate the auth middleware to the new session store",
    "Profile the slow /search endpoint and add an index",
  ],
  "web-dashboard": [
    "Build a dark-mode toggle that respects the system setting",
    "Refactor the chart components to share one tooltip",
    "Fix layout shift on the settings page",
    "Add keyboard navigation to the data table",
  ],
  "infra-terraform": [
    "Split the staging VPC module into reusable pieces",
    "Add alerts for queue backlog in the worker cluster",
    "Review the IAM policies for least privilege",
  ],
  "docs-site": [
    "Write a getting-started guide for the CLI",
    "Fix broken links reported by the link checker",
    "Generate API reference pages from the OpenAPI spec",
  ],
  "mobile-app": [
    "Debug the crash on cold start in release builds",
    "Add offline caching for the feed screen",
  ],
};

const FOLLOW_UPS = [
  "Looks good, now add tests for the edge cases",
  "Can you also update the README?",
  "That broke the build, check the CI log",
  "Use the existing helper instead of a new one",
  "Great, commit it with a conventional message",
  "Explain why this approach is safer",
];

const TOOLS = [
  ["Read", () => ({ file_path: `/Users/demo/dev/src/${pick(["index", "server", "utils", "config"])}.ts` })],
  ["Edit", () => ({ file_path: `/Users/demo/dev/src/${pick(["routes", "store", "chart", "auth"])}.ts`, old_string: "a", new_string: "b" })],
  ["Bash", () => ({ command: pick(["pnpm test", "pnpm lint", "git status", "rg -n TODO src", "pnpm build", "git commit -m \"fix: handle empty input\""]) })],
  ["Grep", () => ({ pattern: pick(["rateLimit", "useTheme", "TODO", "session"]) })],
  ["Write", () => ({ file_path: `/Users/demo/dev/src/${pick(["new-feature", "helpers", "types"])}.ts`, content: "…" })],
  ["TaskCreate", () => ({ subject: "Follow up on review comments" })],
  ["WebSearch", () => ({ query: "best practice for idempotent retries" })],
  ["mcp__github__create_pull_request", () => ({ title: "Improve error handling" })],
  ["Agent", () => ({ prompt: "Search the codebase for every caller of the old API and list them." })],
];

const MODELS = ["claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"];

function writeJsonl(path, lines) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/** One transcript: prompts, assistant turns with tool calls, tool results. */
function transcript({ id, cwd, start, prompts, model, sidechain = false }) {
  const lines = [];
  let t = start;
  let ctx = int(8_000, 20_000);
  const base = { sessionId: id, cwd, ...(sidechain ? { isSidechain: true, agentId: hex(16) } : {}) };
  const stamp = () => new Date(t).toISOString();
  for (const text of prompts) {
    lines.push({ ...base, type: "user", timestamp: stamp(), message: { role: "user", content: text } });
    const turns = int(3, 12);
    for (let i = 0; i < turns; i++) {
      t += int(4, 40) * 1000;
      const [name, input] = pick(TOOLS);
      const toolId = `toolu_${hex(20)}`;
      const write = int(1_000, 12_000);
      const oneHour = rand() < 0.7 ? write : 0;
      const msgId = `msg_${hex(20)}`;
      const usage = {
        input_tokens: int(2, 40),
        output_tokens: int(150, 2_500),
        cache_read_input_tokens: ctx,
        cache_creation_input_tokens: write,
        cache_creation: { ephemeral_5m_input_tokens: write - oneHour, ephemeral_1h_input_tokens: oneHour },
      };
      ctx += write;
      // Claude Code writes one line per content block, repeating id and usage.
      const message = (content) => ({ id: msgId, role: "assistant", model, usage, content });
      lines.push({ ...base, type: "assistant", timestamp: stamp(), requestId: `req_${hex(16)}`, message: message([{ type: "text", text: "Let me look at that." }]) });
      lines.push({ ...base, type: "assistant", timestamp: stamp(), message: message([{ type: "tool_use", id: toolId, name, input: input() }]) });
      t += int(1, 20) * 1000;
      lines.push({ ...base, type: "user", timestamp: stamp(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }] } });
    }
    t += rand() < 0.2 ? int(8, 40) * MIN : int(20, 180) * 1000;
  }
  return { lines, end: t };
}

rmSync(CLAUDE, { recursive: true, force: true });

let sessionCount = 0;
const projectNames = Object.keys(PROJECTS);
for (let day = 6; day >= 0; day--) {
  const perDay = day === 0 ? 6 : int(3, 6);
  for (let k = 0; k < perDay; k++) {
    const project = pick(projectNames);
    const cwd = `/Users/demo/dev/${project}`;
    const slug = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const id = uuid();
    const start = day === 0 ? NOW - int(10, 280) * MIN : NOW - day * 24 * HOUR - int(1, 10) * HOUR;
    const goal = pick(PROJECTS[project]);
    const prompts = [goal, ...Array.from({ length: int(1, 5) }, () => pick(FOLLOW_UPS))];
    const model = pick(MODELS);
    const { lines } = transcript({ id, cwd, start, prompts, model });
    if (rand() < 0.3) lines.push({ type: "custom-title", customTitle: goal.toLowerCase().split(" ").slice(0, 4).join("-"), sessionId: id });
    writeJsonl(join(CLAUDE, "projects", slug, `${id}.jsonl`), lines);

    // Some sessions delegate to sub-agents.
    if (rand() < 0.35) {
      for (let a = 0; a < int(1, 3); a++) {
        const sub = transcript({ id, cwd, start: start + int(2, 20) * MIN, prompts: ["Survey the relevant files and report back."], model: "claude-haiku-4-5-20251001", sidechain: true });
        writeJsonl(join(CLAUDE, "projects", slug, id, "subagents", `agent-${hex(16)}.jsonl`), sub.lines);
      }
    }

    // /insights enrichment for older sessions.
    if (day > 0 && rand() < 0.6) {
      const outcome = pick(["fully_achieved", "fully_achieved", "mostly_achieved", "partially_achieved"]);
      const frictions = rand() < 0.4 ? { [pick(["tool_failure", "wrong_approach", "misunderstood_request", "buggy_code"])]: int(1, 2) } : {};
      writeFileSync(join(mkdirp(join(CLAUDE, "usage-data", "session-meta")), `${id}.json`), JSON.stringify({ session_id: id, start_time: new Date(start).toISOString(), project_path: cwd }));
      writeFileSync(join(mkdirp(join(CLAUDE, "usage-data", "facets")), `${id}.json`), JSON.stringify({
        outcome,
        underlying_goal: goal,
        brief_summary: `${goal}. ${outcome === "fully_achieved" ? "Done and tested." : "Partly done; follow-ups noted."}`,
        friction_counts: frictions,
        friction_detail: Object.keys(frictions).length ? "A command failed once before the fix landed." : "",
        user_satisfaction_counts: { likely_satisfied: int(1, 3), neutral: int(0, 1) },
      }));
    }
    sessionCount++;
  }
}

// Usage limits as recorded by the status line wrapper.
mkdirSync(join(CLAUDE, "ccblackbox"), { recursive: true });
writeFileSync(join(CLAUDE, "ccblackbox", "limits.json"), JSON.stringify({
  capturedAt: NOW,
  rate_limits: {
    five_hour: { used_percentage: 58, resets_at: Math.floor((NOW + 2 * HOUR + 14 * MIN) / 1000) },
    seven_day: { used_percentage: 31, resets_at: Math.floor((NOW + 3 * 24 * HOUR) / 1000) },
  },
}));

// Badges count from the first launch; backdate it so the demo history counts.
writeFileSync(join(CLAUDE, "ccblackbox", "badges.json"), JSON.stringify({ version: 1, startedAt: new Date(NOW - 365 * 24 * HOUR).toISOString(), unlocked: {} }));

function mkdirp(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

console.log(`[seed-demo] wrote ${sessionCount} synthetic sessions to ${CLAUDE}`);
console.log(`[seed-demo] run: CLAUDE_CONFIG_DIR="${CLAUDE}" pnpm dev`);
