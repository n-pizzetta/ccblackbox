#!/usr/bin/env node
/**
 * Parses Claude Code session data into the dashboard's Session objects.
 * Transcripts (~/.claude/projects/**) are the source of every number; live
 * state comes from ~/.claude/sessions/{pid}.json; /insights session-meta and
 * facets only enrich goal, summary, outcome and frictions. Read-only toward
 * Claude Code's files. See ARCHITECTURE.md.
 */
import { readdir, readFile, writeFile, mkdir, stat as fspStat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { dirname, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { costOf, DEFAULT_MODEL, isKnownModel, normalizeModel, priceFor, setModelOverrides } from "./models.mjs";

// `pnpm parse` dump. Never under public/ or dist/: it holds real prompts and paths.
const OUT = join(homedir(), ".claude", "ccblackbox", "sessions.json");
const CLAUDE = join(homedir(), ".claude");
const META_DIR = join(CLAUDE, "usage-data", "session-meta");
const FACETS_DIR = join(CLAUDE, "usage-data", "facets");
const LIVE_DIR = join(CLAUDE, "sessions");
const STALE_DIR = join(LIVE_DIR, ".stale");
const HISTORY = join(CLAUDE, "history.jsonl");
const PROJECTS_DIR = join(CLAUDE, "projects");
const TOKEN_OPT_DIR = join(CLAUDE, "token-optimizer");
const FILE_HISTORY_DIR = join(CLAUDE, "file-history");
const PLUGIN_CACHE_DIR = join(CLAUDE, "ccblackbox", "cache");

/** Tool name used for counts: MCP tools are grouped per server (`mcp__github__x` → `mcp:github`). */
const toolKey = (name) => (name.startsWith("mcp__") ? `mcp:${name.split("__")[1] || "unknown"}` : name);

/** Gaps longer than this between two transcript events count as idle, not active time. */
const IDLE_CAP_MS = 5 * 60_000;

/** User-role lines that are not prompts the user typed. */
const NON_PROMPT_RE = /^\s*(<(command-|local-command-|task-notification|system-reminder)|\[Request interrupted|Caveat:)/;

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

const costFor = costOf;
/** Priced per turn when available, so sessions that switch models cost right. */
const sessionCost = (model, tokens, turns) =>
  turns?.length ? turns.reduce((sum, tu) => sum + costOf(tu.model ?? model, tu.tokens), 0) : costFor(model, tokens);

/** Model that produced the most output tokens (sessions can switch models). */
const dominantModel = (turns, fallback) => {
  const out = new Map();
  for (const tu of turns ?? []) if (tu.model) out.set(tu.model, (out.get(tu.model) ?? 0) + (tu.tokens?.output ?? 0) + 1);
  let best = fallback;
  let max = -1;
  for (const [m, v] of out) if (v > max) { max = v; best = m; }
  return best;
};

const baselineCostFor = (model, tokens) => {
  const p = priceFor(model);
  const t = tokens || {};
  const allInput = (t.input ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0);
  return (allInput / 1e6) * p.in + ((t.output ?? 0) / 1e6) * p.out;
};

const mapOutcome = (o) =>
  ["fully_achieved", "mostly_achieved", "partially_achieved", "not_achieved", "in_progress"].includes(o)
    ? o
    : "unknown";

const projectName = (p) => (p ? basename(p) || p : "unknown");

function mapFrictionKind(k) {
  const allowed = ["wrong_approach", "buggy_code", "missing_context", "tool_error", "user_interruption"];
  if (allowed.includes(k)) return k;
  // Facet kinds seen in /insights output: tool_failure, user_rejected_action,
  // misunderstood_request, environment_issue, tooling_issue, excessive_changes…
  if (/interrupt|reject/.test(k)) return "user_interruption";
  if (/error|fail|tool|environment/.test(k)) return "tool_error";
  if (/context|misunderstood|unclear/.test(k)) return "missing_context";
  if (k.includes("bug")) return "buggy_code";
  return "wrong_approach";
}

function mapFrictions(facet) {
  if (!facet) return [];
  const out = [];
  const kinds = facet.friction_counts ?? {};
  const detail = (facet.friction_detail ?? "").trim();
  const kindKeys = Object.keys(kinds).filter((k) => kinds[k] > 0);
  if (kindKeys.length === 0) return [];
  kindKeys.forEach((kind, i) => {
    const n = kinds[kind] ?? 1;
    for (let j = 0; j < n; j++) {
      out.push({
        kind: mapFrictionKind(kind),
        at: Math.min(0.95, (i + j * 0.2 + 1) / (kindKeys.length * 2 + 1)),
        detail: j === 0 && detail ? detail : kind.replace(/_/g, " "),
      });
    }
  });
  return out.slice(0, 8);
}

/** Timeline for sessions whose transcript is gone: only the real prompt timestamps from session-meta. */
function metaTimeline(meta, startMs) {
  const stamps = Array.isArray(meta.user_message_timestamps) ? meta.user_message_timestamps : [];
  return stamps.map((iso, i) => ({
    t: Math.max(0, new Date(iso).getTime() - startMs),
    kind: "prompt",
    label: i === 0 ? "Initial prompt" : "User prompt",
  }));
}

async function readDirSafe(dir) {
  try { return await readdir(dir); } catch { return []; }
}
async function readJsonSafe(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

const QUALITY_SIGNAL_LABELS = {
  context_fill_degradation: "Context fill",
  stale_reads: "Stale file reads",
  bloated_results: "Bloated tool results",
  duplicates: "Duplicate reads",
  compaction_depth: "Compaction depth",
  decision_density: "Decision density",
  agent_efficiency: "Agent efficiency",
};

async function readFileHistory(sessionId, pathByHash) {
  const dir = join(FILE_HISTORY_DIR, sessionId);
  const files = await readDirSafe(dir);
  if (files.length === 0) return [];
  const byHash = new Map();
  for (const name of files) {
    const m = name.match(/^(.+)@v(\d+)$/);
    if (!m) continue;
    const [, hash, v] = m;
    const versions = byHash.get(hash) ?? [];
    versions.push(Number(v));
    byHash.set(hash, versions);
  }
  return Array.from(byHash.entries())
    .map(([hash, versions]) => {
      const entry = { hash, versions: versions.sort((a, b) => a - b) };
      const path = pathByHash?.get(hash);
      if (path) entry.path = path;
      return entry;
    })
    .sort((a, b) => {
      if (!!a.path !== !!b.path) return a.path ? -1 : 1;
      return b.versions.length - a.versions.length;
    });
}

async function readPluginCache(sessionId, startedAtMs) {
  const file = join(PLUGIN_CACHE_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) return { entries: [], lastTsMs: 0, stopTsMs: 0 };
  const entries = [];
  let lastTsMs = 0;
  let stopTsMs = 0;
  try {
    const stream = createReadStream(file, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (typeof j.t !== "number") continue;
      lastTsMs = Math.max(lastTsMs, j.t);
      if (j.kind === "stop") { stopTsMs = Math.max(stopTsMs, j.t); continue; }
      if (j.kind !== "tool" || !j.tool) continue;
      const t = startedAtMs ? Math.max(0, j.t - startedAtMs) : 0;
      const preview = (typeof j.inPreview === "string" ? j.inPreview : "").slice(0, 160);
      const out = typeof j.outPreview === "string" ? j.outPreview : "";
      const entry = { t, tool: j.tool, preview, source: "plugin" };
      if (out) {
        entry.result = {
          text: out.slice(0, 240),
          truncated: out.length > 240,
          isError: false,
          bytes: out.length,
        };
      }
      entries.push(entry);
    }
  } catch { /* skip */ }
  return { entries, lastTsMs, stopTsMs };
}

function mergeToolSequences(transcriptSeq, pluginSeq) {
  if (pluginSeq.length === 0) return transcriptSeq;
  if (transcriptSeq.length === 0) return pluginSeq;
  const tagged = [
    ...transcriptSeq.map((e) => ({ ...e, _src: e.source ?? "transcript" })),
    ...pluginSeq.map((e) => ({ ...e, _src: "plugin" })),
  ];
  tagged.sort((a, b) => a.t - b.t);
  const out = [];
  for (const e of tagged) {
    const prev = out[out.length - 1];
    if (prev && prev.tool === e.tool && Math.abs(prev.t - e.t) < 500) {
      // duplicate within 500ms — prefer transcript (richer fields)
      if (prev._src === "transcript" && e._src === "plugin") continue;
      if (prev._src === "plugin" && e._src === "transcript") {
        out[out.length - 1] = e;
        continue;
      }
    }
    out.push(e);
  }
  return out.map((e) => {
    // strip the internal tag, keep `source` only when it's "plugin"
    const { _src, ...rest } = e;
    if (_src === "plugin") rest.source = "plugin";
    return rest;
  });
}

async function readQualityCache(sessionId) {
  const p = join(TOKEN_OPT_DIR, `quality-cache-${sessionId}.json`);
  const data = await readJsonSafe(p);
  if (!data || typeof data.score !== "number") return null;
  const breakdown = data.breakdown ?? {};
  const signals = Object.entries(data.signals ?? {}).map(([kind, score]) => {
    const bd = breakdown[kind] ?? {};
    return {
      kind,
      label: QUALITY_SIGNAL_LABELS[kind] ?? kind,
      score: Math.round(score),
      detail: bd.detail ?? "",
      wasteTokens: bd.estimated_waste_tokens ?? 0,
    };
  });
  return {
    score: data.score,
    grade: data.grade ?? "?",
    fillPct: data.fill_pct ?? null,
    band: data.degradation_band ?? null,
    wasteTokens: breakdown.total_estimated_waste_tokens ?? signals.reduce((a, s) => a + s.wasteTokens, 0),
    signals,
  };
}

/** Read history.jsonl line-by-line, group user messages by sessionId. */
async function readHistoryBySession() {
  const bySession = new Map();
  if (!existsSync(HISTORY)) return bySession;
  const rl = createInterface({ input: createReadStream(HISTORY, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.sessionId) continue;
      const arr = bySession.get(entry.sessionId) ?? [];
      arr.push({
        display: entry.display ?? "",
        timestamp: entry.timestamp,
        project: entry.project,
      });
      bySession.set(entry.sessionId, arr);
    } catch { /* skip malformed line */ }
  }
  return bySession;
}

function firstLineSummary(s) {
  if (!s) return "";
  const trimmed = s.trim();
  const firstLine = trimmed.split("\n").find((l) => l.trim()) ?? trimmed;
  return firstLine.slice(0, 120);
}

const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

function addTokens(into, t) {
  for (const k of Object.keys(into)) into[k] += t[k] ?? 0;
  return into;
}

/** Parsed transcripts keyed by path, reused while the file's mtime and size are unchanged. */
const transcriptCache = new Map();

async function readTranscriptFile(path, { sidechain = false } = {}) {
  let st;
  try { st = await fspStat(path); } catch { return null; }
  const cached = transcriptCache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.data;
  const data = await parseTranscriptFile(path, sidechain);
  transcriptCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, data });
  return data;
}

/**
 * One pass over a Claude Code transcript (.jsonl).
 *
 * Claude Code writes one line per content block (thinking / text / tool_use),
 * each repeating the message id and its full `usage`. Lines are merged into a
 * single turn per API message (id, else requestId); the last line's usage wins
 * (it carries the final output_tokens). Summing lines would double-count.
 */
async function parseTranscriptFile(path, sidechain) {
  const toolCounts = {};
  const absEvents = [];
  const prompts = [];
  const toolSequence = [];
  const turns = [];
  const turnById = new Map();
  const seenToolUse = new Set();
  const pathByHash = new Map();
  const resultById = new Map();
  let userMessages = 0;
  let commits = 0;
  let model = null;
  let firstTs = null;
  let lastTs = null;
  let activeMs = 0;
  let cwd = null;
  let firstUserText = null;
  let customTitle = null;
  let pendingInBytes = 0;
  let pendingInPreview = "";

  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!cwd && j.cwd) cwd = j.cwd;
    if (!customTitle && j.type === "custom-title" && typeof j.customTitle === "string") {
      customTitle = j.customTitle;
    }
    const msg = j.message;
    if (!msg) continue;
    const tsMs = j.timestamp ? new Date(j.timestamp).getTime() : null;
    if (tsMs) {
      if (firstTs === null) firstTs = tsMs;
      if (lastTs !== null && tsMs > lastTs) activeMs += Math.min(tsMs - lastTs, IDLE_CAP_MS);
      lastTs = Math.max(lastTs ?? tsMs, tsMs);
    }

    if (msg.role === "assistant") {
      if (msg.model === "<synthetic>") continue;
      const key = msg.id || j.requestId || `line-${turns.length}-${tsMs}`;
      let turn = turnById.get(key);
      if (!turn) {
        const turnModel = normalizeModel(msg.model) ?? model;
        if (!model) model = turnModel;
        turn = {
          tsMs,
          model: turnModel,
          tokens: emptyTokens(),
          tools: [],
          inBytes: pendingInBytes,
          outBytes: 0,
          inPreview: pendingInPreview.slice(0, 240),
          outPreview: "",
          ...(sidechain ? { sidechain: true } : {}),
        };
        turnById.set(key, turn);
        turns.push(turn);
        pendingInBytes = 0;
        pendingInPreview = "";
      }
      const u = msg.usage;
      if (u) {
        turn.tokens = {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheWrite5m: u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
          cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
        };
      }
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const c of content) {
        if (c.type === "text" && typeof c.text === "string") {
          turn.outBytes += c.text.length;
          if (!turn.outPreview) turn.outPreview = c.text.slice(0, 240);
        }
        if (c.type !== "tool_use" || typeof c.name !== "string") continue;
        if (c.id) {
          if (seenToolUse.has(c.id)) continue;
          seenToolUse.add(c.id);
        }
        const name = toolKey(c.name);
        const input = c.input ?? {};
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
        turn.tools.push(name);
        absEvents.push({ tsMs, kind: SUBAGENT_TOOLS.has(c.name) ? "agent" : "tool", tool: name, label: name });
        if (c.name === "Bash" && typeof input.command === "string" && /\bgit\s+commit\b/.test(input.command)) {
          commits++;
          absEvents.push({ tsMs, kind: "commit", label: "git commit" });
        }
        if (typeof input.file_path === "string") {
          const hash = createHash("sha256").update(input.file_path).digest("hex").slice(0, 16);
          if (!pathByHash.has(hash)) pathByHash.set(hash, input.file_path);
        }
        if (!sidechain && toolSequence.length < 300) {
          let preview = "";
          let full = "";
          if (typeof input.file_path === "string") preview = input.file_path;
          else if (typeof input.command === "string") { preview = input.command; full = input.command; }
          else if (typeof input.pattern === "string") preview = input.pattern;
          else if (typeof input.prompt === "string") { preview = input.prompt; full = input.prompt; }
          else preview = Object.keys(input).join(", ");
          const entry = { tsMs, tool: c.name, preview: preview.slice(0, 160), id: c.id };
          if (full && full.length > 160) entry.full = full.slice(0, 8000);
          toolSequence.push(entry);
        }
      }
    } else if (msg.role === "user") {
      if (j.isMeta || j.isCompactSummary) continue;
      const content = msg.content;
      let text = null;
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        const toolResults = content.filter((c) => c && c.type === "tool_result");
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            if (!tr.tool_use_id) continue;
            let body = "";
            if (typeof tr.content === "string") body = tr.content;
            else if (Array.isArray(tr.content)) {
              body = tr.content
                .filter((b) => b && b.type === "text" && typeof b.text === "string")
                .map((b) => b.text)
                .join("\n");
            }
            if (!body) continue;
            resultById.set(tr.tool_use_id, {
              text: body.slice(0, 240),
              truncated: body.length > 240,
              isError: !!tr.is_error,
              bytes: body.length,
            });
            pendingInBytes += body.length;
            if (!pendingInPreview) pendingInPreview = `[tool_result] ${body.slice(0, 200)}`;
          }
          continue;
        }
        const textPart = content.find((c) => c && c.type === "text");
        if (textPart?.text) text = textPart.text;
      } else continue;
      // Sub-agent transcripts start with the parent's instructions, not a user prompt.
      if (sidechain || (text && NON_PROMPT_RE.test(text))) {
        if (text) pendingInBytes += text.length;
        continue;
      }
      userMessages++;
      if (!firstUserText && text) firstUserText = text;
      if (text) {
        pendingInBytes += text.length;
        pendingInPreview = text.slice(0, 200);
      }
      absEvents.push({ tsMs, kind: "prompt", label: userMessages === 1 ? "Initial prompt" : "User prompt" });
      if (prompts.length < 100 && text) {
        prompts.push({ tsMs, text: text.slice(0, 1500), preview: firstLineSummary(text) });
      }
    }
  }

  for (const entry of toolSequence) {
    if (entry.id && resultById.has(entry.id)) entry.result = resultById.get(entry.id);
  }
  // runningTool: latest tool_use in sequence without a result yet
  let runningTool = null;
  for (let i = toolSequence.length - 1; i >= 0; i--) {
    const entry = toolSequence[i];
    if (entry.id && !entry.result) {
      runningTool = { tool: entry.tool, preview: entry.preview, tsMs: entry.tsMs };
      break;
    }
    if (entry.result) break;
  }
  for (const entry of toolSequence) delete entry.id;

  const tokens = turns.reduce((acc, tu) => addTokens(acc, tu.tokens), emptyTokens());
  return {
    tokens,
    toolCounts,
    absEvents,
    prompts,
    toolSequence,
    turns,
    assistantMessages: turns.length,
    userMessages,
    commits,
    model,
    firstTs,
    lastTs,
    activeMs,
    cwd,
    firstUserText,
    pathByHash,
    runningTool,
    customTitle,
  };
}

function relativizeEvents(absEvents, startedAt) {
  return absEvents
    .map((e) => ({
      t: e.tsMs && startedAt ? Math.max(0, e.tsMs - startedAt) : 0,
      kind: e.kind,
      tool: e.tool,
      label: e.label,
    }))
    .sort((a, b) => a.t - b.t);
}

function relativizePrompts(prompts, startedAt) {
  return prompts.map((p) => ({
    t: p.tsMs && startedAt ? Math.max(0, p.tsMs - startedAt) : 0,
    text: p.text,
    preview: p.preview,
  }));
}

function relativizeToolSequence(seq, startedAt) {
  return seq.map((s) => ({
    t: s.tsMs && startedAt ? Math.max(0, s.tsMs - startedAt) : 0,
    tool: s.tool,
    preview: s.preview,
    ...(s.full ? { full: s.full } : {}),
    ...(s.result ? { result: s.result } : {}),
  }));
}

function relativizeTurns(turns, prompts, startedAt) {
  return turns.map((tu) => {
    const t = tu.tsMs && startedAt ? Math.max(0, tu.tsMs - startedAt) : 0;
    let promptIdx;
    for (let i = prompts.length - 1; i >= 0; i--) {
      const pt = prompts[i].tsMs ?? 0;
      if (pt <= (tu.tsMs ?? 0)) { promptIdx = i; break; }
    }
    return {
      t,
      ...(tu.model ? { model: tu.model } : {}),
      ...(tu.sidechain ? { sidechain: true } : {}),
      tokens: tu.tokens,
      tools: tu.tools,
      inBytes: tu.inBytes ?? 0,
      outBytes: tu.outBytes ?? 0,
      inPreview: tu.inPreview ?? "",
      outPreview: tu.outPreview ?? "",
      ...(promptIdx !== undefined ? { promptIdx } : {}),
    };
  });
}

function isClaudePidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const comm = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /claude/i.test(comm);
  } catch {
    return false;
  }
}

async function readCustomTitleFast(path) {
  // Scan first ~20 lines for a custom-title entry (cheap — don't load whole file).
  if (!existsSync(path)) return null;
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let i = 0;
  for await (const line of rl) {
    i++;
    if (i > 50) break;
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === "custom-title" && typeof j.customTitle === "string") {
        rl.close();
        return j.customTitle;
      }
    } catch { /* skip */ }
  }
  return null;
}

async function findClearedChain(primarySessionId, slugDir, primaryMtime) {
  // Return sibling session ids in the same project dir that share customTitle
  // with the primary session and were modified after it. Ordered by mtime asc.
  const primaryTitle = await readCustomTitleFast(join(slugDir, `${primarySessionId}.jsonl`));
  if (!primaryTitle) return [];
  const files = (await readDirSafe(slugDir)).filter((f) => f.endsWith(".jsonl"));
  const candidates = [];
  for (const f of files) {
    const id = basename(f, ".jsonl");
    if (id === primarySessionId) continue;
    const p = join(slugDir, f);
    let stat;
    try { stat = await fspStat(p); } catch { continue; }
    if (stat.mtimeMs <= primaryMtime) continue;
    if ((await readCustomTitleFast(p)) !== primaryTitle) continue;
    candidates.push({ id, mtime: stat.mtimeMs });
  }
  candidates.sort((a, b) => a.mtime - b.mtime);
  return candidates.map((c) => c.id);
}

/**
 * Every transcript under ~/.claude/projects, keyed by session id. Claude Code's
 * project dir names are lossy (`.`, `_` and `/` all become `-`, and the meta's
 * project_path can be a subdirectory), so sessions are looked up by id only.
 */
async function indexTranscripts() {
  const index = new Map();
  for (const slug of await readDirSafe(PROJECTS_DIR)) {
    const dir = join(PROJECTS_DIR, slug);
    for (const f of await readDirSafe(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const id = basename(f, ".jsonl");
      if (!index.has(id)) index.set(id, { dir, path: join(dir, f) });
    }
  }
  return index;
}

/** Sub-agent transcripts: <project>/<sessionId>/subagents/agent-*.jsonl. */
async function readSubagents(entry, sessionId) {
  const dir = join(entry.dir, sessionId, "subagents");
  const files = (await readDirSafe(dir)).filter((f) => f.endsWith(".jsonl"));
  const out = [];
  for (const f of files) {
    const t = await readTranscriptFile(join(dir, f), { sidechain: true });
    if (t) out.push(t);
  }
  return out;
}

/** Alive pid files, expanded to their /clear chains. id → live info. */
async function collectLive(liveFiles, index) {
  const byId = new Map();
  for (const file of liveFiles) {
    const info = await readJsonSafe(join(LIVE_DIR, file));
    if (!info || !info.sessionId || !info.startedAt) continue;
    let chain = [info.sessionId];
    const entry = index.get(info.sessionId);
    if (entry) {
      let primaryMtime = info.startedAt;
      try { primaryMtime = (await fspStat(entry.path)).mtimeMs; } catch { /* ignore */ }
      chain = [info.sessionId, ...(await findClearedChain(info.sessionId, entry.dir, primaryMtime))];
    }
    const newest = chain[chain.length - 1];
    for (const id of chain) {
      byId.set(id, { pid: info.pid, name: info.name, cwd: info.cwd, startedAt: info.startedAt, isLive: id === newest });
    }
  }
  return byId;
}

function satisfactionOf(facet) {
  const counts = facet?.user_satisfaction_counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 0.5;
  return ((counts.likely_satisfied ?? 0) + (counts.neutral ?? 0) * 0.5) / total;
}

/**
 * One session. Numbers (tokens, cost, durations, counts, timeline) come from
 * the transcript and its sub-agent transcripts. session-meta and facets are
 * only written when /insights runs, so they only enrich the qualitative
 * fields (goal, summary, outcome, satisfaction, frictions).
 */
async function buildSession(id, { entry, meta, facet, live, dead, history, now }) {
  const t = entry ? await readTranscriptFile(entry.path) : null;
  if (!t && !meta && !live) return null;
  if (t && !t.firstTs && !meta && !live) return null;
  const subs = entry ? await readSubagents(entry, id) : [];

  const metaStart = meta?.start_time ? new Date(meta.start_time).getTime() : null;
  const startedAtMs = t?.firstTs ?? metaStart ?? live?.startedAt ?? now;
  const isLive = !!live?.isLive;
  const lastTs = Math.max(t?.lastTs ?? 0, ...subs.map((sub) => sub.lastTs ?? 0)) || null;

  const mainTurns = t?.turns ?? [];
  const allTurns = [...mainTurns, ...subs.flatMap((sub) => sub.turns)].sort((a, b) => (a.tsMs ?? 0) - (b.tsMs ?? 0));
  const turns = relativizeTurns(allTurns, t?.prompts ?? [], startedAtMs);

  const toolCounts = {};
  for (const src of [t, ...subs]) {
    for (const [k, v] of Object.entries(src?.toolCounts ?? {})) toolCounts[k] = (toolCounts[k] ?? 0) + v;
  }

  let tokens;
  if (t) {
    tokens = [t, ...subs].reduce((acc, src) => addTokens(acc, src.tokens), emptyTokens());
  } else {
    // Transcript deleted: session-meta only has input/output totals.
    tokens = { ...emptyTokens(), input: meta?.input_tokens ?? 0, output: meta?.output_tokens ?? 0 };
  }
  const model = dominantModel(allTurns, t?.model ?? DEFAULT_MODEL);

  const msgs = history.get(id) ?? [];
  const firstPrompt = t?.firstUserText ?? meta?.first_prompt ?? msgs[0]?.display ?? "";
  const customTitle = t?.customTitle ?? null;
  const fileHistory = await readFileHistory(id, t?.pathByHash);
  const pluginCache = await readPluginCache(id, startedAtMs);
  const totalTools = Object.values(toolCounts).reduce((a, b) => a + b, 0);
  const empty = !!t && t.userMessages === 0 && totalTools === 0;
  const ghostKind = isLive ? null : dead ? "crashed" : empty ? "empty" : null;
  const outcome = isLive ? "in_progress" : mapOutcome(facet?.outcome);

  return {
    id,
    project: projectName(t?.cwd ?? meta?.project_path ?? live?.cwd),
    cwd: t?.cwd ?? meta?.project_path ?? live?.cwd ?? "",
    startedAt: new Date(startedAtMs).toISOString(),
    // Active time: gaps over IDLE_CAP_MS between transcript events are idle.
    durationMs: t ? Math.max(1, t.activeMs) : Math.max(1, (meta?.duration_minutes ?? 0) * 60_000),
    wallMs: Math.max(1, (isLive ? now : lastTs ?? startedAtMs) - startedAtMs),
    model,
    outcome,
    satisfaction: satisfactionOf(facet),
    goal: (facet?.underlying_goal || customTitle || live?.name || firstPrompt.slice(0, 140) || "Session"),
    summary: facet?.brief_summary || (firstPrompt ? firstPrompt.slice(0, 220) : "No prompt captured."),
    customTitle,
    messages: t ? t.assistantMessages + t.userMessages : (meta?.user_message_count ?? 0) + (meta?.assistant_message_count ?? 0),
    toolCounts,
    tokens,
    costUsd: allTurns.length ? sessionCost(model, tokens, allTurns) : costOf(model, tokens),
    baselineCostUsd: baselineCostFor(model, tokens),
    frictions: isLive ? [] : mapFrictions(facet),
    timeline: t ? relativizeEvents(t.absEvents, startedAtMs) : meta ? metaTimeline(meta, startedAtMs) : [],
    subAgents: subs.length || (toolCounts.Agent ?? 0) + (toolCounts.Task ?? 0),
    filesChanged: fileHistory.length || meta?.files_modified || 0,
    commits: t ? t.commits : meta?.git_commits ?? 0,
    live: isLive,
    ...(live ? { pid: live.pid } : {}),
    ...(ghostKind ? { ghost: true, ghostKind } : {}),
    ...(!t ? { transcriptMissing: true } : {}),
    quality: await readQualityCache(id),
    fileHistory,
    prompts: relativizePrompts(t?.prompts ?? [], startedAtMs),
    toolSequence: mergeToolSequences(relativizeToolSequence(t?.toolSequence ?? [], startedAtMs), pluginCache.entries),
    turns,
    runningTool: isLive && t?.runningTool
      ? { tool: t.runningTool.tool, preview: t.runningTool.preview, t: Math.max(0, (t.runningTool.tsMs ?? startedAtMs) - startedAtMs) }
      : null,
    lastEventAt: lastTs ? new Date(lastTs).toISOString() : undefined,
    ...(pluginCache.entries.length
      ? {
          pluginCapture: {
            entries: pluginCache.entries.length,
            lastEventAt: new Date(pluginCache.lastTsMs).toISOString(),
            stoppedAt: pluginCache.stopTsMs ? new Date(pluginCache.stopTsMs).toISOString() : null,
          },
        }
      : {}),
  };
}

/**
 * Splits ~/.claude/sessions pid files into alive ones and the session ids of
 * dead ones (crashed / not cleaned up). Read-only: Claude Code owns that
 * directory, so the dashboard never moves or deletes its files.
 */
async function classifyLiveFiles() {
  const files = (await readDirSafe(LIVE_DIR)).filter((f) => f.endsWith(".json"));
  const alive = [];
  const deadIds = new Set();
  for (const file of files) {
    const info = await readJsonSafe(join(LIVE_DIR, file));
    if (!info || !info.sessionId) continue;
    if (isClaudePidAlive(info.pid)) alive.push(file);
    else deadIds.add(info.sessionId);
  }
  return { alive, deadIds };
}

function reassignLiveToChainTail(sessions) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  for (const s of sessions) {
    if (!s.live || !s.clearedInto) continue;
    const visited = new Set([s.id]);
    let walk = s;
    while (walk.clearedInto && !visited.has(walk.clearedInto)) {
      const next = byId.get(walk.clearedInto);
      if (!next) break;
      visited.add(next.id);
      walk = next;
    }
    if (walk.id === s.id) continue;
    walk.live = true;
    walk.outcome = "in_progress";
    walk.ghost = false;
    delete walk.ghostKind;
    s.live = false;
    s.outcome = "unknown";
  }
}

function linkClearedChains(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    if (!s.customTitle || !s.cwd) continue;
    const key = `${s.cwd}::${s.customTitle}`;
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    for (let i = 0; i < arr.length; i++) {
      const prev = arr[i - 1];
      const next = arr[i + 1];
      if (prev) arr[i].clearedFrom = prev.id;
      if (next) arr[i].clearedInto = next.id;
    }
  }
}

function toMs(v) {
  if (typeof v === "number" && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return toMs(n);
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function normalizeWindow(w, now) {
  if (!w || typeof w.used_percentage !== "number") return null;
  const resetsAt = toMs(w.resets_at);
  // Captured before a reset that has since happened: the window is fresh.
  if (resetsAt !== null && resetsAt <= now) return { usedPct: 0, resetsAt: null };
  return { usedPct: w.used_percentage, resetsAt };
}

/**
 * Real usage limits recorded by the ccblackbox status line wrapper
 * (scripts/statusline.mjs), or null when it isn't installed yet.
 */
export async function readLimits(now = Date.now()) {
  try {
    const raw = JSON.parse(await readFile(join(homedir(), ".claude", "ccblackbox", "limits.json"), "utf8"));
    const rl = raw.rate_limits ?? {};
    return {
      capturedAt: raw.capturedAt ?? null,
      fiveHour: normalizeWindow(rl.five_hour, now),
      sevenDay: normalizeWindow(rl.seven_day, now),
    };
  } catch {
    return null;
  }
}

const MODEL_OVERRIDES_FILE = join(homedir(), ".claude", "ccblackbox", "models.json");

/** User pricing overrides; see setModelOverrides in models.mjs. */
async function loadModelOverrides() {
  let raw = null;
  try {
    raw = JSON.parse(await readFile(MODEL_OVERRIDES_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[ccblackbox] ignoring ${MODEL_OVERRIDES_FILE}: ${err.message}`);
  }
  return setModelOverrides(raw);
}

/** Models a session used that have no pricing row (their cost is an estimate). */
function markUnpriced(s) {
  const used = new Set([s.model, ...(s.turns ?? []).map((t) => t.model)].filter(Boolean));
  const unpriced = [...used].filter((m) => !isKnownModel(m));
  if (unpriced.length) s.unpricedModels = unpriced;
}

/**
 * Parses every Claude Code session reachable from ~/.claude/. Returns
 * { sessions (newest first), errors (unreadable session-meta files),
 * modelOverrides }. Used by scripts/api.mjs and by `pnpm parse`.
 */
export async function parseAllSessions() {
  const modelOverrides = await loadModelOverrides();
  if (!existsSync(PROJECTS_DIR) && !existsSync(META_DIR) && !existsSync(LIVE_DIR)) {
    return { sessions: [], errors: [], modelOverrides };
  }

  const { alive: liveFiles, deadIds } = await classifyLiveFiles();
  // Ids older dashboard versions moved to ~/.claude/sessions/.stale/ were dead too.
  for (const f of await readDirSafe(STALE_DIR)) if (f.endsWith(".json")) deadIds.add(basename(f, ".json"));
  const facetsSet = new Set((await readDirSafe(FACETS_DIR)).filter((f) => f.endsWith(".json")));
  const history = await readHistoryBySession();
  const index = await indexTranscripts();
  const liveById = await collectLive(liveFiles, index);

  const metaById = new Map();
  const errorList = [];
  for (const file of (await readDirSafe(META_DIR)).filter((f) => f.endsWith(".json"))) {
    const meta = await readJsonSafe(join(META_DIR, file));
    if (!meta || !meta.session_id || !meta.start_time) { errorList.push(file); continue; }
    const facet = facetsSet.has(file) ? await readJsonSafe(join(FACETS_DIR, file)) : null;
    metaById.set(meta.session_id, { meta, facet });
  }

  const now = Date.now();
  const all = [];
  for (const id of new Set([...index.keys(), ...metaById.keys(), ...liveById.keys()])) {
    const s = await buildSession(id, {
      entry: index.get(id),
      meta: metaById.get(id)?.meta,
      facet: metaById.get(id)?.facet,
      live: liveById.get(id),
      dead: deadIds.has(id),
      history,
      now,
    });
    if (s) all.push(s);
  }
  all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  linkClearedChains(all);
  reassignLiveToChainTail(all);
  for (const s of all) markUnpriced(s);

  return { sessions: all, errors: errorList, modelOverrides };
}

/**
 * Strip heavy fields from a Session to produce a lightweight summary suitable
 * for the session list / sidebar. Detail views (`getSessionById`) hand back the
 * full object.
 */
export function summarizeSession(s) {
  return {
    id: s.id,
    project: s.project,
    cwd: s.cwd,
    startedAt: s.startedAt,
    durationMs: s.durationMs,
    model: s.model,
    outcome: s.outcome,
    satisfaction: s.satisfaction,
    goal: s.goal,
    summary: s.summary,
    customTitle: s.customTitle ?? null,
    messages: s.messages,
    toolCounts: s.toolCounts,
    tokens: s.tokens,
    costUsd: s.costUsd,
    baselineCostUsd: s.baselineCostUsd,
    unpricedModels: s.unpricedModels,
    frictions: s.frictions,
    subAgents: s.subAgents,
    filesChanged: s.filesChanged,
    commits: s.commits,
    live: s.live,
    ghost: s.ghost,
    ghostKind: s.ghostKind,
    clearedFrom: s.clearedFrom,
    clearedInto: s.clearedInto,
    lastEventAt: s.lastEventAt,
    runningTool: s.runningTool ?? null,
    quality: s.quality
      ? { score: s.quality.score, grade: s.quality.grade, fillPct: s.quality.fillPct, band: s.quality.band, wasteTokens: s.quality.wasteTokens, signals: [] }
      : null,
    pluginCapture: s.pluginCapture ?? null,
    // Lightweight time-series fields needed by fleet aggregations
    // (5h-session detection, token-burn buckets, sparklines). Heavy text
    // fields (inPreview/outPreview, prompts.text) stay in the detail payload.
    turns: Array.isArray(s.turns)
      ? s.turns.map((t) => ({ t: t.t, model: t.model, tokens: t.tokens, promptIdx: t.promptIdx, tools: t.tools }))
      : undefined,
    prompts: Array.isArray(s.prompts)
      ? s.prompts.map((p) => ({ t: p.t, preview: p.preview }))
      : undefined,
  };
}

async function main() {
  const { sessions, errors } = await parseAllSessions();
  if (sessions.length === 0 && !existsSync(META_DIR) && !existsSync(LIVE_DIR)) {
    console.error(`[parse-sessions] no Claude data at ${CLAUDE}`);
    process.exit(1);
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sessions,
    errors,
  }));

  const liveCount = sessions.filter((s) => s.live).length;
  const ghostCount = sessions.filter((s) => s.ghost).length;
  console.log(
    `[parse-sessions] wrote ${sessions.length} sessions (${liveCount} live, ${ghostCount} ghost) to ${OUT}` +
      (errors.length ? ` (${errors.length} parse errors)` : ""),
  );
}

// Run as CLI only when invoked directly (not when imported as a module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[parse-sessions] fatal:", err);
    process.exit(1);
  });
}
