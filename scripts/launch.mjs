#!/usr/bin/env node
// A short-lived launcher for hosts that cannot keep a foreground server attached.
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const serverPath = fileURLToPath(new URL("./serve.mjs", import.meta.url));
// One log per launch, as with /marey:replay: earlier ones go first.
for (const name of readdirSync(tmpdir())) {
  if (/^marey.*\.log$/.test(name)) {
    try { rmSync(join(tmpdir(), name)); } catch { /* still open (Windows) */ }
  }
}
const logPath = join(tmpdir(), `marey-${process.pid}-${Date.now()}.log`);
const log = openSync(logPath, "wx", 0o600);
const child = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
  detached: true,
  stdio: ["ignore", log, log],
});
closeSync(log);
let spawnError;
child.on("error", (err) => { spawnError = err; });
child.unref();

console.log(`[marey] log: ${logPath}`);
const deadline = Date.now() + 10_000;
while (true) {
  const output = readFileSync(logPath, "utf8");
  if (spawnError) {
    console.error(`[marey] could not start server: ${spawnError.message}`);
    process.exitCode = 1;
    break;
  }
  if (/listening on|is already running at/.test(output)) {
    process.stdout.write(output);
    break;
  }
  if (/port \d+ is already in use/.test(output)) {
    process.stdout.write(output);
    process.exitCode = 1;
    break;
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    process.stdout.write(output);
    process.exitCode = child.exitCode ?? 1;
    break;
  }
  if (Date.now() >= deadline) {
    process.stdout.write(output);
    console.error(`[marey] startup timed out; see ${logPath}`);
    child.kill();
    process.exitCode = 1;
    break;
  }
  await setTimeout(100);
}
