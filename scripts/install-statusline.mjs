#!/usr/bin/env node
/**
 * Installs (or removes) the ccblackbox status line wrapper.
 *
 *   node scripts/install-statusline.mjs              # install / refresh
 *   node scripts/install-statusline.mjs --uninstall  # restore previous status line
 *
 * Install copies statusline.mjs (and its helper context-advice.mjs) to a stable path (~/.claude/ccblackbox/, so
 * plugin updates don't break settings.json), saves the current `statusLine`
 * setting to ~/.claude/ccblackbox/statusline.json and points `statusLine` at
 * the wrapper, which keeps rendering the previous status line. It also sets
 * `statusLine.refreshInterval` (unless already set) so the line updates while idle.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Honors CLAUDE_CONFIG_DIR, like Claude Code.
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const DIR = join(CLAUDE, "ccblackbox");
const SETTINGS = join(CLAUDE, "settings.json");
const STATE = join(DIR, "statusline.json");
const TARGET = join(DIR, "statusline.mjs");
const ADVICE_TARGET = join(DIR, "context-advice.mjs");
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(SCRIPTS, "statusline.mjs");
const ADVICE_SOURCE = join(SCRIPTS, "context-advice.mjs");

function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  let settings;
  try {
    settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  } catch (err) {
    console.error(`[ccblackbox] cannot parse ${SETTINGS}: ${err.message}. Nothing changed.`);
    process.exit(1);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    console.error(`[ccblackbox] ${SETTINGS} is not a JSON object. Nothing changed.`);
    process.exit(1);
  }
  return settings;
}

/** Backup, then write through a temp file + rename so a concurrent reader never sees half a file. */
function writeSettings(settings) {
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.ccblackbox.bak`);
  const tmp = `${SETTINGS}.ccblackbox.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, SETTINGS);
}

function removeState() {
  rmSync(STATE, { force: true });
  rmSync(TARGET, { force: true });
  rmSync(ADVICE_TARGET, { force: true });
  rmSync(join(DIR, "limits.json"), { force: true });
  rmSync(join(DIR, "limits-history.jsonl"), { force: true });
  rmSync(join(DIR, "live"), { recursive: true, force: true });
}

/**
 * Claude Code only re-runs the status line on events (a message, a turn), so an idle session
 * would show a frozen cache countdown. Re-run it on a timer too; a value the user set is kept.
 */
const REFRESH_INTERVAL = 30;

const isOurs = (statusLine) => typeof statusLine?.command === "string" && statusLine.command.includes(TARGET);

function install() {
  mkdirSync(DIR, { recursive: true });
  copyFileSync(SOURCE, TARGET);
  copyFileSync(ADVICE_SOURCE, ADVICE_TARGET);

  const settings = readSettings();
  if (isOurs(settings.statusLine)) {
    if (settings.statusLine.refreshInterval === undefined) {
      settings.statusLine.refreshInterval = REFRESH_INTERVAL;
      writeSettings(settings);
      console.log(`[ccblackbox] status line now refreshes every ${REFRESH_INTERVAL}s, so the cache countdown keeps moving while idle.`);
    }
    console.log(`[ccblackbox] status line already installed; wrapper refreshed at ${TARGET}`);
    return;
  }
  const previous = settings.statusLine ?? null;
  writeFileSync(STATE, JSON.stringify({ previous }, null, 2) + "\n");
  settings.statusLine = {
    refreshInterval: REFRESH_INTERVAL,
    ...(previous ?? {}),
    type: "command",
    command: `node "${TARGET}"`,
  };
  writeSettings(settings);
  console.log(
    `[ccblackbox] status line installed. ` +
      (previous?.command ? `Your previous status line keeps rendering: ${previous.command}` : "No previous status line; a minimal one is shown."),
  );
  console.log("[ccblackbox] Usage limits appear in the dashboard after the next Claude Code turn.");
}

function uninstall() {
  const settings = readSettings();
  if (!isOurs(settings.statusLine)) {
    // The user may have replaced the status line since: leave it, clean up ours.
    removeState();
    console.log("[ccblackbox] status line not active; removed leftover ccblackbox files.");
    return;
  }
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(STATE, "utf8")).previous ?? null;
  } catch {
    /* no saved state: just remove ours */
  }
  if (previous) settings.statusLine = previous;
  else delete settings.statusLine;
  writeSettings(settings);
  removeState();
  console.log("[ccblackbox] status line removed" + (previous?.command ? `; restored: ${previous.command}` : "."));
}

if (process.argv.includes("--uninstall")) uninstall();
else install();
