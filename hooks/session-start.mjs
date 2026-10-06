#!/usr/bin/env node
/**
 * Marey SessionStart hook: when a newer Marey is published, says so as the session starts
 * (scripts/update-check.mjs; at most one request a day, cached otherwise).
 */
import { fileURLToPath } from "node:url";
import { dataDir } from "../scripts/data-dir.mjs";
import { availableUpdate, currentVersion, latestVersion, recordInstalled, updateMessage } from "../scripts/update-check.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

try {
  const dir = dataDir();
  const current = currentVersion(ROOT);
  recordInstalled(dir, current);
  const update = availableUpdate(current, await latestVersion(dir));
  if (update) process.stdout.write(JSON.stringify({ systemMessage: updateMessage(update) }));
} catch {
  /* never get in the way of starting a session */
}
