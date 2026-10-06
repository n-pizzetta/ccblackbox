// The daily update check and its notices (scripts/update-check.mjs, scripts/statusline.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { availableUpdate, latestVersion, updateCheckEnabled, updateMessage } from "../scripts/update-check.mjs";

const HOUR = 3600_000;
const dir = () => mkdtempSync(join(tmpdir(), "marey-update-"));

test("the check is on by default and off by config or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", () => {
  const d = dir();
  assert.equal(updateCheckEnabled(d, {}), true);
  assert.equal(updateCheckEnabled(d, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }), false);
  writeFileSync(join(d, "config.json"), '{"updateCheck": false}');
  assert.equal(updateCheckEnabled(d, {}), false);
});

test("asks GitHub at most once a day and keeps the last answer when offline", async () => {
  const d = dir();
  let calls = 0;
  const online = async () => { calls++; return "0.6.0"; };
  const offline = async () => { calls++; throw new Error("offline"); };
  const t0 = Date.parse("2026-10-06T08:00:00Z");

  assert.equal(await latestVersion(d, { now: t0, fetchLatest: online }), "0.6.0");
  assert.equal(await latestVersion(d, { now: t0 + 23 * HOUR, fetchLatest: online }), "0.6.0");
  assert.equal(calls, 1);

  assert.equal(await latestVersion(d, { now: t0 + 25 * HOUR, fetchLatest: offline }), "0.6.0");
  assert.equal(calls, 2);
  assert.equal(JSON.parse(readFileSync(join(d, "update-check.json"), "utf8")).latest, "0.6.0");
});

test("no request at all when the check is off", async () => {
  const d = dir();
  writeFileSync(join(d, "config.json"), '{"updateCheck": false}');
  let calls = 0;
  assert.equal(await latestVersion(d, { fetchLatest: async () => { calls++; return "9.9.9"; } }), null);
  assert.equal(calls, 0);
});

test("an update is only offered for a newer version", () => {
  assert.deepEqual(availableUpdate("0.5.1", "0.6.0"), { current: "0.5.1", latest: "0.6.0" });
  assert.equal(availableUpdate("0.6.0", "0.6.0"), null);
  assert.equal(availableUpdate("0.6.1", "0.6.0"), null);
  assert.equal(availableUpdate("0.5.1", null), null);
  assert.equal(updateMessage({ current: "0.5.1", latest: "0.6.0" }), "Marey 0.6.0 is available (you have 0.5.1) · run /marey:update");
});

test("the status line shows the notice until the newer version is installed", () => {
  const claude = dir();
  const data = join(claude, "marey");
  mkdirSync(data);
  const render = () =>
    execFileSync("node", ["scripts/statusline.mjs"], {
      input: JSON.stringify({ session_id: "s", model: { display_name: "Opus" } }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: claude },
      encoding: "utf8",
    });

  writeFileSync(join(data, "update-check.json"), JSON.stringify({ installed: "0.5.1", latest: "0.6.0" }));
  assert.match(render(), /↑ Marey 0\.6\.0 · \/marey:update/);

  writeFileSync(join(data, "update-check.json"), JSON.stringify({ installed: "0.6.0", latest: "0.6.0" }));
  assert.doesNotMatch(render(), /Marey 0\.6\.0/);

  writeFileSync(join(data, "update-check.json"), JSON.stringify({ installed: "0.5.1", latest: "0.6.0" }));
  writeFileSync(join(data, "config.json"), '{"updateCheck": false}');
  assert.doesNotMatch(render(), /Marey 0\.6\.0/);
});
