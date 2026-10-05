// Finding the terminal of a live session (scripts/focus-terminal.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostOf, pickByTitle, processChain, sessionTitles } from "../scripts/focus-terminal.mjs";

const PS = [
  "    1     0 ??       /sbin/launchd",
  "  700     1 ??       /Applications/Ghostty.app/Contents/MacOS/ghostty",
  "  710   700 ttys003  /usr/bin/login",
  "  720   710 ttys003  -/bin/zsh",
  "  730   720 ttys003  claude",
  "  800     1 ??       /Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  "  810   800 ??       /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)",
  "  820   810 ttys007  /bin/zsh",
  "  830   820 ttys007  claude",
  "  900     1 ??       tmux",
  "  910   900 ttys009  -zsh",
  "  920   910 ttys009  claude",
].join("\n");

test("processChain walks from a pid up to launchd", () => {
  const chain = processChain(PS, 730);
  assert.deepEqual(chain.map((p) => p.pid), [730, 720, 710, 700]);
  assert.equal(chain[0].tty, "ttys003");
  assert.deepEqual(processChain(PS, 4242), []);
});

test("hostOf names the app bundle, or the multiplexer in between", () => {
  assert.deepEqual(hostOf(processChain(PS, 730)), { kind: "ghostty", app: "/Applications/Ghostty.app", name: "Ghostty" });
  // The outer bundle, not the helper app nested inside it.
  assert.deepEqual(hostOf(processChain(PS, 830)), { kind: "app", app: "/Applications/Visual Studio Code.app", name: "Visual Studio Code" });
  assert.deepEqual(hostOf(processChain(PS, 920)), { kind: "multiplexer", name: "tmux" });
  assert.deepEqual(hostOf([{ pid: 5, ppid: 1, tty: "??", comm: "claude" }]), { kind: "unknown" });
});

const TERMINALS = [
  { id: "A", cwd: "/repo", name: "✳ Fix the parser" },
  { id: "B", cwd: "/repo", name: "◐ Add a focus button" },
  { id: "C", cwd: "/other", name: "✳ Add a focus button" },
  { id: "D", cwd: "/repo", name: "caffeinate -is" },
];

test("pickByTitle ignores the status glyph and breaks ties on cwd", () => {
  assert.equal(pickByTitle(TERMINALS, ["Fix the parser"], "/repo")?.id, "A");
  assert.equal(pickByTitle(TERMINALS, ["Add a focus button"], "/other")?.id, "C");
  assert.equal(pickByTitle(TERMINALS, ["Add a focus button"], "/elsewhere"), null);
  assert.equal(pickByTitle(TERMINALS, [], "/repo"), null);
  // A /rename wins when the generated title is shown nowhere.
  assert.equal(pickByTitle(TERMINALS, ["Fix the parser", "Something older"], "/repo")?.id, "A");
});

test("sessionTitles keeps the latest /rename and the latest generated title", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marey-focus-"));
  const path = join(dir, "s.jsonl");
  writeFileSync(path, [
    JSON.stringify({ type: "ai-title", aiTitle: "First topic" }),
    JSON.stringify({ type: "user", message: { role: "user", content: 'mentions "ai-title" in text' } }),
    JSON.stringify({ type: "custom-title", customTitle: "my-name" }),
    "not json",
    JSON.stringify({ type: "ai-title", aiTitle: "Second topic" }),
  ].join("\n"));
  assert.deepEqual(await sessionTitles(path), ["my-name", "Second topic"]);
  assert.deepEqual(await sessionTitles(null), []);
});
