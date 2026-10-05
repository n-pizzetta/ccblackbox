// Replacing an older server and refreshing the status line wrapper (scripts/takeover.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOlder, refreshStatusline, runningServer } from "../scripts/takeover.mjs";

test("isOlder compares x.y.z and treats a missing version as older", () => {
  assert.equal(isOlder("0.4.0", "0.5.0"), true);
  assert.equal(isOlder("0.5.0", "0.5.0"), false);
  assert.equal(isOlder("0.10.0", "0.9.9"), false);
  assert.equal(isOlder("1.0.0", "0.9.0"), false);
  assert.equal(isOlder(null, "0.5.0"), true);
});

test("runningServer ignores a server that isn't Marey", async () => {
  const server = createServer((_req, res) => res.end("<title>Something else</title>"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    assert.equal(await runningServer(server.address().port), null);
  } finally {
    server.close();
  }
});

test("runningServer reads a current server's version", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/api/version" ? { name: "marey", version: "0.5.0", pid: 4242 } : {}));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    assert.deepEqual(await runningServer(server.address().port), { version: "0.5.0", pid: 4242 });
  } finally {
    server.close();
  }
});

test("refreshStatusline only touches an installed, outdated wrapper", () => {
  const scripts = mkdtempSync(join(tmpdir(), "marey-src-"));
  writeFileSync(join(scripts, "statusline.mjs"), "new wrapper");
  writeFileSync(join(scripts, "context-advice.mjs"), "new advice");

  const notInstalled = mkdtempSync(join(tmpdir(), "marey-data-"));
  assert.equal(refreshStatusline(notInstalled, scripts), false);

  const installed = mkdtempSync(join(tmpdir(), "marey-data-"));
  writeFileSync(join(installed, "statusline.mjs"), "old wrapper");
  assert.equal(refreshStatusline(installed, scripts), true);
  assert.equal(readFileSync(join(installed, "statusline.mjs"), "utf8"), "new wrapper");
  assert.equal(readFileSync(join(installed, "context-advice.mjs"), "utf8"), "new advice");
  assert.equal(refreshStatusline(installed, scripts), false);
});
