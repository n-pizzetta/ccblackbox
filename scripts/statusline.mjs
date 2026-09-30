#!/usr/bin/env node
/**
 * ccblackbox status line wrapper.
 *
 * Claude Code pipes a JSON payload to the status line command on every
 * refresh. It is the only place the real usage limits (`rate_limits`: 5-hour
 * and 7-day windows, as shown by `/usage`) are exposed, so this wrapper:
 *   1. records `rate_limits` to ~/.claude/ccblackbox/limits.json,
 *   2. hands the untouched payload to the user's previous status line command
 *      (saved by install-statusline.mjs), or prints a minimal line if none.
 *
 * Installed to ~/.claude/ccblackbox/statusline.mjs by install-statusline.mjs.
 * Must stay fast and never fail: the status line renders on every turn.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".claude", "ccblackbox");

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function record(payload) {
  if (!payload?.rate_limits) return;
  try {
    mkdirSync(DIR, { recursive: true });
    const tmp = join(DIR, `limits.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify({ capturedAt: Date.now(), rate_limits: payload.rate_limits }));
    renameSync(tmp, join(DIR, "limits.json"));
  } catch {
    /* never break the status line */
  }
}

function previousCommand() {
  try {
    const cfg = JSON.parse(readFileSync(join(DIR, "statusline.json"), "utf8"));
    return typeof cfg.previous?.command === "string" ? cfg.previous.command : null;
  } catch {
    return null;
  }
}

function fallbackLine(payload) {
  const parts = [];
  if (payload?.model?.display_name) parts.push(payload.model.display_name);
  const rl = payload?.rate_limits;
  for (const [key, label] of [["five_hour", "5h"], ["seven_day", "7d"]]) {
    const pct = rl?.[key]?.used_percentage;
    if (typeof pct === "number") parts.push(`${label} ${Math.round(pct)}%`);
  }
  return parts.join(" · ");
}

const input = readStdin();
let payload = null;
try {
  payload = JSON.parse(input);
} catch {
  /* pass through untouched */
}
record(payload);

// The previous command can break (e.g. a plugin update moves its versioned
// path): if it fails or prints nothing, show our own line instead of a blank one.
const next = previousCommand();
if (next) {
  const child = spawn(next, { shell: true, stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    process.stdout.write(ok && out.trim() ? out : fallbackLine(payload));
    process.exit(0);
  };
  child.stdout.on("data", (c) => { out += c; });
  child.on("error", () => finish(false));
  child.on("close", (code) => finish(code === 0));
  child.stdin.on("error", () => {});
  child.stdin.end(input);
} else {
  process.stdout.write(fallbackLine(payload));
}
