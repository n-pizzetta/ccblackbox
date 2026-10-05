// Moving the pre-rename data folder (scripts/data-dir.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir } from "../scripts/data-dir.mjs";

const claudeDir = () => mkdtempSync(join(tmpdir(), "marey-dir-"));

test("moves ccblackbox/ to marey/ and leaves a symlink at the old path", () => {
  const claude = claudeDir();
  mkdirSync(join(claude, "ccblackbox"));
  writeFileSync(join(claude, "ccblackbox", "badges.json"), '{"xp":{"s1":40}}');

  const dir = dataDir(claude);

  assert.equal(dir, join(claude, "marey"));
  assert.equal(readFileSync(join(dir, "badges.json"), "utf8"), '{"xp":{"s1":40}}');
  assert.ok(lstatSync(join(claude, "ccblackbox")).isSymbolicLink());
  // An old status line wrapper writing to the old path lands in the new folder.
  writeFileSync(join(claude, "ccblackbox", "limits.json"), "{}");
  assert.ok(existsSync(join(dir, "limits.json")));
});

test("leaves an existing marey/ alone", () => {
  const claude = claudeDir();
  mkdirSync(join(claude, "marey"));
  mkdirSync(join(claude, "ccblackbox"));
  writeFileSync(join(claude, "marey", "badges.json"), "new");
  writeFileSync(join(claude, "ccblackbox", "badges.json"), "old");

  dataDir(claude);

  assert.equal(readFileSync(join(claude, "marey", "badges.json"), "utf8"), "new");
  assert.ok(!lstatSync(join(claude, "ccblackbox")).isSymbolicLink());
});

test("a fresh install creates nothing until something is written", () => {
  const claude = claudeDir();
  assert.equal(dataDir(claude), join(claude, "marey"));
  assert.ok(!existsSync(join(claude, "marey")));
  assert.ok(!existsSync(join(claude, "ccblackbox")));
});

test("is idempotent once moved", () => {
  const claude = claudeDir();
  mkdirSync(join(claude, "ccblackbox"));
  writeFileSync(join(claude, "ccblackbox", "badges.json"), "x");
  dataDir(claude);
  dataDir(claude);
  assert.equal(readFileSync(join(claude, "marey", "badges.json"), "utf8"), "x");
  assert.ok(lstatSync(join(claude, "ccblackbox")).isSymbolicLink());
});
