// Adds an empty session and a crashed one (dead pid 99991) to the demo data, for the ghost demo.
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const C = process.env.CLAUDE_CONFIG_DIR || fileURLToPath(new URL("../../.demo-claude", import.meta.url));
const p = (proj) => `${C}/projects/-Users-demo-dev-${proj}`;
const empty = randomUUID();
writeFileSync(`${p("docs-site")}/${empty}.jsonl`, JSON.stringify({ type: "summary", summary: "", sessionId: empty }) + "\n");
const dead = randomUUID(), t0 = Date.now() - 5 * 3600_000, cwd = "/Users/demo/dev/mobile-app";
const L = [
 { sessionId: dead, cwd, type: "user", timestamp: new Date(t0).toISOString(), message: { role: "user", content: "Bump the React Native version and fix the build" } },
 { sessionId: dead, cwd, type: "assistant", timestamp: new Date(t0 + 20000).toISOString(), requestId: "req_dead1", message: { id: "msg_dead1", role: "assistant", model: "claude-sonnet-5-5", usage: { input_tokens: 6, output_tokens: 900, cache_read_input_tokens: 9000, cache_creation_input_tokens: 7000 }, content: [{ type: "tool_use", id: "toolu_dead1", name: "Bash", input: { command: "pnpm ios" } }] } },
];
writeFileSync(`${p("mobile-app")}/${dead}.jsonl`, L.map(JSON.stringify).join("\n") + "\n");
mkdirSync(`${C}/sessions`, { recursive: true });
writeFileSync(`${C}/sessions/99991.json`, JSON.stringify({ pid: 99991, sessionId: dead, cwd, startedAt: t0 }));
