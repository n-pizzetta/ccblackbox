#!/usr/bin/env node
/**
 * Marey status line wrapper.
 *
 * Claude Code pipes a JSON payload to the status line command on every
 * refresh. It is the only place the real usage limits (`rate_limits`: 5-hour
 * and 7-day windows, as shown by `/usage`) are exposed, so this wrapper:
 *   1. records `rate_limits` to ~/.claude/marey/limits.json (and, when they
 *      change, appends them to limits-history.jsonl, used to calibrate "% of window"),
 *   2. writes a sanitized per-session snapshot (context size, prompt-cache state) to
 *      ~/.claude/marey/live/<session_id>.json for the dashboard,
 *   3. hands the untouched payload to the user's previous status line command
 *      (saved by install-statusline.mjs), or prints a minimal line if none, and appends
 *      a short context / cache segment with a "compact? clear?" hint. Turn that segment
 *      off with {"verdict": false} in ~/.claude/marey/statusline.json.
 *
 * Installed to ~/.claude/marey/statusline.mjs by install-statusline.mjs.
 * Must stay fast and never fail: the status line renders on every turn.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// Honors CLAUDE_CONFIG_DIR, like Claude Code.
const DIR = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "marey");
const LIMITS = join(DIR, "limits.json");
const HISTORY = join(DIR, "limits-history.jsonl");
const LIVE = join(DIR, "live");
const HISTORY_MAX_BYTES = 512 * 1024;

// Shared with the dashboard. Installed next to this file; if it is missing (older install),
// the context features are skipped and the rest keeps working.
let advice = null;
try {
  advice = await import("./context-advice.mjs");
} catch {
  /* no context advice */
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const win = (w) => (w && typeof w.used_percentage === "number" ? { p: w.used_percentage, r: w.resets_at ?? null } : null);

/** One line per change of either window (not per refresh), so the file stays small. */
function appendHistory(rl) {
  const cur = { five: win(rl.five_hour), seven: win(rl.seven_day) };
  try {
    const old = JSON.parse(readFileSync(LIMITS, "utf8")).rate_limits ?? {};
    if (JSON.stringify({ five: win(old.five_hour), seven: win(old.seven_day) }) === JSON.stringify(cur)) return;
  } catch {
    /* no previous capture: first line */
  }
  appendFileSync(HISTORY, JSON.stringify({ t: Date.now(), ...cur }) + "\n");
  if (statSync(HISTORY).size > HISTORY_MAX_BYTES) {
    const lines = readFileSync(HISTORY, "utf8").split("\n").filter(Boolean);
    writeFileSync(HISTORY, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
  }
}

function record(payload) {
  if (!payload?.rate_limits) return;
  try {
    mkdirSync(DIR, { recursive: true });
    appendHistory(payload.rate_limits);
    const tmp = join(DIR, `limits.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify({ capturedAt: Date.now(), rate_limits: payload.rate_limits }));
    renameSync(tmp, LIMITS);
  } catch {
    /* never break the status line */
  }
}

function writeSnapshot(snap) {
  if (!snap) return;
  try {
    mkdirSync(LIVE, { recursive: true });
    const tmp = join(LIVE, `${snap.sessionId}.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(snap));
    renameSync(tmp, join(LIVE, `${snap.sessionId}.json`));
  } catch {
    /* never break the status line */
  }
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(join(DIR, "statusline.json"), "utf8"));
  } catch {
    return {};
  }
}

/** Append the context / cache segment to the last line of what the previous status line printed. */
function withVerdict(out, snap) {
  if (!advice || !snap || readConfig().verdict === false) return out;
  const seg = advice.statusSegment(snap);
  if (!seg) return out;
  const body = out.replace(/\n+$/, "");
  return body ? `${body}${advice.SEP ?? " "}${seg}${out.endsWith("\n") ? "\n" : ""}` : seg;
}

function previousCommand() {
  const cmd = readConfig().previous?.command;
  return typeof cmd === "string" ? cmd : null;
}

const paint = (color, s) => `\x1b[${color}m${s}\x1b[0m`;
/** Green under 50%, yellow under 80%, red above. */
const usageColor = (pct) => (pct >= 80 ? 31 : pct >= 50 ? 33 : 32);

function fmtLeft(secs) {
  const m = Math.max(1, Math.ceil(secs / 60));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.round(m / 1440)}d`;
}

/** Show the weekly window only when it is close enough to matter. */
const WEEKLY_FROM = 80;

/** e.g. "Opus 5.5 │ 5h 10% reset 1h20", plus "7d 85% reset 2d" once the weekly window is nearly used. */
function fallbackLine(payload) {
  const groups = [];
  if (payload?.model?.display_name) groups.push(`\x1b[1m${payload.model.display_name}\x1b[0m`);
  const rl = payload?.rate_limits;
  const now = Date.now() / 1000;
  for (const [key, label] of [["five_hour", "5h"], ["seven_day", "7d"]]) {
    const w = rl?.[key];
    if (typeof w?.used_percentage !== "number") continue;
    const pct = Math.round(w.used_percentage);
    if (key === "seven_day" && pct < WEEKLY_FROM) continue;
    const reset = typeof w.resets_at === "number" && w.resets_at > now ? ` reset ${fmtLeft(w.resets_at - now)}` : "";
    groups.push(`${label} ${paint(usageColor(pct), `${pct}%`)}${reset}`);
  }
  return groups.join(advice?.SEP ?? " · ");
}

const input = readStdin();
let payload = null;
try {
  payload = JSON.parse(input);
} catch {
  /* pass through untouched */
}
record(payload);
const snap = advice ? advice.toSnapshot(payload) : null;
writeSnapshot(snap);

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
    process.stdout.write(withVerdict(ok && out.trim() ? out : fallbackLine(payload), snap));
    process.exit(0);
  };
  child.stdout.on("data", (c) => { out += c; });
  child.on("error", () => finish(false));
  child.on("close", (code) => finish(code === 0));
  child.stdin.on("error", () => {});
  child.stdin.end(input);
} else {
  process.stdout.write(withVerdict(fallbackLine(payload), snap));
}
