/**
 * Tells the user when a newer Marey is published. At most once a day it reads the version in
 * the repository's plugin.json on GitHub (a plain GET: nothing about the user is sent) and keeps
 * the answer in <data>/update-check.json, read by the session-start hook, the status line and
 * the dashboard. Off with {"updateCheck": false} in <data>/config.json, or when
 * CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isOlder } from "./takeover.mjs";

export const LATEST_URL = "https://raw.githubusercontent.com/n-pizzetta/marey/main/.claude-plugin/plugin.json";
const DAY_MS = 24 * 3600_000;
const STATE = "update-check.json";

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** The version of the Marey install rooted at `root` (its package.json). */
export const currentVersion = (root) => readJson(join(root, "package.json"))?.version ?? null;

export function updateCheckEnabled(dir, env = process.env) {
  if (env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) return false;
  return readJson(join(dir, "config.json"))?.updateCheck !== false;
}

function writeState(dir, patch) {
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, STATE);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...readJson(path), ...patch }, null, 2) + "\n");
    renameSync(tmp, path);
  } catch {
    /* the check is a convenience: never fail because of it */
  }
}

/** Records the version now running, so the status line drops the notice once it is installed. */
export const recordInstalled = (dir, version) => writeState(dir, { installed: version });

async function fetchPublished() {
  const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { version } = await res.json();
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("no version");
  return version;
}

/**
 * The latest published version: the cached answer while it is under a day old, otherwise
 * fetched again (offline: the last answer is kept and retried the next day). Null when off.
 */
export async function latestVersion(dir, { now = Date.now(), fetchLatest = fetchPublished } = {}) {
  if (!updateCheckEnabled(dir)) return null;
  const state = readJson(join(dir, STATE));
  const checkedAt = Date.parse(state?.checkedAt ?? "");
  if (now - checkedAt < DAY_MS) return state.latest ?? null;
  let latest = state?.latest ?? null;
  try {
    latest = await fetchLatest();
  } catch {
    /* keep the last answer */
  }
  writeState(dir, { checkedAt: new Date(now).toISOString(), latest });
  return latest;
}

/** { current, latest } when `latest` is newer than `current`, else null. */
export const availableUpdate = (current, latest) => (current && latest && isOlder(current, latest) ? { current, latest } : null);

export const updateMessage = ({ current, latest }) => `Marey ${latest} is available (you have ${current}) · run /marey:update`;
