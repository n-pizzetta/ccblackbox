import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

test("Codex's packaged skill roots and entrypoint resolve inside the distributed plugin", () => {
  const pkg = json(join(root, "package.json"));
  const codex = json(join(root, ".codex-plugin/plugin.json"));
  const claude = json(join(root, ".claude-plugin/plugin.json"));
  const marketplace = json(join(root, ".claude-plugin/marketplace.json"));
  assert.equal(codex.name, pkg.name);
  assert.equal(codex.version, pkg.version);
  assert.equal(codex.version, claude.version);
  // Override auto-discovery of Claude's hooks/hooks.json.
  assert.deepEqual(codex.hooks, { hooks: {} });
  const entry = marketplace.plugins.find((plugin) => plugin.name === codex.name);
  assert.equal(resolve(root, entry.source), resolve(root));
  assert.ok(pkg.files.includes(".codex-plugin"));
  assert.ok(pkg.files.includes(codex.skills.replace(/^\.\//, "").replace(/\/$/, "")));
  for (const name of ["replay", "update"]) {
    const skill = readFileSync(join(root, codex.skills, name, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp(`^---\nname: ${name}\ndescription: .+\n---\n`));
    assert.doesNotMatch(skill, /CLAUDE_PLUGIN_ROOT|\$ARGUMENTS|claude plugin|\/reload-plugins/);
  }
  const skillDir = join(root, codex.skills, "replay");
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const entrypoint = skill.match(/`([^`]+launch\.mjs)`/)[1];
  assert.equal(resolve(skillDir, entrypoint), join(root, "scripts/launch.mjs"));
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "marey plugin test "));
  const plugin = join(dir, "installed plugin");
  const cwd = join(dir, "unrelated project");
  mkdirSync(cwd);
  // Copy only shipped runtime files: no source checkout, node_modules or build step.
  for (const file of ["package.json", ".codex-plugin", ".claude-plugin", "codex-skills", "scripts", "dist"]) {
    cpSync(join(root, file), join(plugin, file), { recursive: true });
  }
  const claude = join(dir, "claude");
  const codex = join(dir, "codex");
  mkdirSync(claude);
  mkdirSync(codex);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", TMPDIR: dir, TMP: dir, TEMP: dir };
  const manifest = json(join(plugin, ".codex-plugin/plugin.json"));
  const skillPath = join(plugin, manifest.skills, "replay/SKILL.md");
  const entrypoint = readFileSync(skillPath, "utf8").match(/`([^`]+launch\.mjs)`/)[1];
  return { dir, env, cwd, launcher: resolve(dirname(skillPath), entrypoint) };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

const close = (server) => new Promise((resolve) => server.close(resolve));

test("installed launcher serves the dashboard, survives its parent, and reuses an existing server", async (t) => {
  const f = fixture(t);
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  const run = (...args) => exec(process.execPath, [f.launcher, "--port", String(port), ...args],
    { cwd: f.cwd, env: f.env, timeout: 15_000 });
  let pid;
  t.after(() => { if (pid) { try { process.kill(pid); } catch { /* already stopped */ } } });
  const first = await run("--no-open");
  assert.match(first.stdout, /listening on http:\/\/localhost:/);
  const base = `http://127.0.0.1:${port}`;
  const version = await fetch(`${base}/api/version`).then((r) => r.json());
  pid = version.pid;
  assert.equal(version.name, "marey");
  assert.equal(version.version, json(join(root, "package.json")).version);
  assert.match(await fetch(base).then((r) => r.text()), /<title>Marey<\/title>/);

  const second = await run("--no-open");
  assert.match(second.stdout, /is already running at/);
  assert.equal((await fetch(`${base}/api/version`).then((r) => r.json())).pid, pid);
  assert.notEqual(first.stdout.split("\n")[0], second.stdout.split("\n")[0]);

  // Intercept the OS opener to check default browser behavior without opening a real window.
  if (process.platform !== "win32") {
    const bin = join(f.dir, "bin");
    const opened = join(f.dir, "opened-url");
    mkdirSync(bin);
    writeFileSync(join(bin, process.platform === "darwin" ? "open" : "xdg-open"),
      '#!/bin/sh\nprintf "%s" "$1" > "$MAREY_TEST_OPENED"\n', { mode: 0o755 });
    f.env.PATH = `${bin}:${f.env.PATH}`;
    f.env.MAREY_TEST_OPENED = opened;
    await run();
    for (let i = 0; i < 20 && !existsSync(opened); i++) await setTimeout(100);
    assert.equal(readFileSync(opened, "utf8"), `http://localhost:${port}`);
  }
});

test("launcher reports invalid ports and unrelated occupied ports as failures", async (t) => {
  const f = fixture(t);
  const run = (...args) => exec(process.execPath, [f.launcher, ...args],
    { cwd: f.cwd, env: f.env, timeout: 15_000 });
  await assert.rejects(run("--port", "invalid", "--no-open"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /invalid --port/);
    return true;
  });
  const other = createServer((req, res) => { res.end("another application"); });
  const port = await listen(other);
  t.after(() => close(other));
  await assert.rejects(run("--port", String(port), "--no-open"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /already in use/);
    return true;
  });
  assert.equal(await fetch(`http://127.0.0.1:${port}`).then((r) => r.text()), "another application");
});
