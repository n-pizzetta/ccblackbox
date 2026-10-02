// Runs the parser against the synthetic data from scripts/seed-demo.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ccblackbox-test-"));
const CLAUDE = join(root, ".claude");
const PROJECTS = join(CLAUDE, "projects");

let parsed;

before(async () => {
  execFileSync(process.execPath, ["scripts/seed-demo.mjs", CLAUDE], { stdio: "ignore" });
  // The parser resolves CLAUDE_CONFIG_DIR at import time.
  process.env.CLAUDE_CONFIG_DIR = CLAUDE;
  const { parseAllSessions } = await import("../scripts/parse-sessions.mjs");
  parsed = await parseAllSessions();
});

after(() => rmSync(root, { recursive: true, force: true }));

/** Main transcript plus sub-agent transcripts of a session. */
function transcriptsOf(id) {
  for (const dir of readdirSync(PROJECTS)) {
    const main = join(PROJECTS, dir, `${id}.jsonl`);
    if (!existsSync(main)) continue;
    const subDir = join(PROJECTS, dir, id, "subagents");
    const subs = existsSync(subDir) ? readdirSync(subDir).map((f) => join(subDir, f)) : [];
    return [main, ...subs];
  }
  throw new Error(`no transcript for ${id}`);
}

/** Output tokens, counting each assistant message once (Claude Code repeats usage per content block). */
function outputTokens(files) {
  const byMessage = new Map();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").trim().split("\n")) {
      const o = JSON.parse(line);
      if (o.type === "assistant") byMessage.set(o.message.id, o.message.usage.output_tokens);
    }
  }
  return [...byMessage.values()].reduce((a, b) => a + b, 0);
}

test("parses every seeded session without errors", () => {
  const seeded = readdirSync(PROJECTS).flatMap((d) => readdirSync(join(PROJECTS, d)).filter((f) => f.endsWith(".jsonl")));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.sessions.length, seeded.length);
});

test("sorts sessions newest first", () => {
  const starts = parsed.sessions.map((s) => new Date(s.startedAt).getTime());
  assert.deepEqual(starts, [...starts].sort((a, b) => b - a));
});

test("counts output tokens once per message, sub-agents included", () => {
  for (const s of parsed.sessions) {
    assert.equal(s.tokens.output, outputTokens(transcriptsOf(s.id)), `session ${s.id}`);
  }
});

test("prices every seeded model", () => {
  for (const s of parsed.sessions) {
    assert.equal(s.unpricedModels, undefined, `session ${s.id}`);
    assert.ok(s.costUsd > 0, `session ${s.id}`);
  }
});

test("attaches /insights facets to the sessions that have them", () => {
  const facets = new Set(readdirSync(join(CLAUDE, "usage-data", "facets")).map((f) => f.replace(/\.json$/, "")));
  assert.ok(facets.size > 0);
  for (const s of parsed.sessions.filter((s) => facets.has(s.id))) {
    assert.ok(s.outcome, `session ${s.id}`);
    assert.ok(s.goal, `session ${s.id}`);
  }
});

test("returns an empty result when there is no Claude data", async () => {
  // A fresh process: the config dir is read once, at import time.
  const empty = join(root, "empty");
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", 'const m = await import("./scripts/parse-sessions.mjs"); console.log(JSON.stringify(await m.parseAllSessions()))'],
    { env: { ...process.env, CLAUDE_CONFIG_DIR: empty } },
  );
  const result = JSON.parse(out);
  assert.deepEqual(result.sessions, []);
  assert.deepEqual(result.errors, []);
});
