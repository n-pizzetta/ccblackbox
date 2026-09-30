# Architecture

`ccblackbox` is a local dashboard for Claude Code sessions, shipped both as an npm package (`npx ccblackbox`) and as a Claude Code plugin (`/ccblackbox:replay`). A Node server parses the files Claude Code already writes under `~/.claude/`, keeps the result in memory and serves it to a React single-page app over a small local API.

There is no database, no network access beyond loopback, and no runtime dependency besides Node's standard library on the server side.

---

## 1. Overview

```
 ~/.claude/  (written by Claude Code)            ~/.claude/ccblackbox/  (written by ccblackbox)
 ├── projects/<slug>/<id>.jsonl                  ├── cache/<id>.jsonl      ◀── hooks/capture.mjs
 ├── projects/<slug>/<id>/subagents/*.jsonl      ├── limits.json           ◀── statusline.mjs
 ├── sessions/<pid>.json                         ├── models.json           (user, optional)
 ├── usage-data/session-meta/<id>.json           ├── statusline.mjs/.json  ◀── install-statusline.mjs
 ├── usage-data/facets/<id>.json                 └── sessions.json         ◀── `pnpm parse` only
 ├── usage-data/report.html
 ├── file-history/<id>/<hash>@v<n>
 ├── history.jsonl
 ├── token-optimizer/quality-cache-<id>.json
 └── ../.claude.json (profile)
                    │
                    ▼
      scripts/parse-sessions.mjs  ── parseAllSessions() / summarizeSession()
      scripts/models.mjs          ── pricing table, shared with the UI
                    │
                    ▼
      scripts/api.mjs   in-memory cache, fs watchers + periodic refresh,
                        /api/* routes, /usage-report.html, request guards
          │                                   │
          ▼                                   ▼
   scripts/serve.mjs                   vite.config.ts (dev middleware)
   static dist/ + API on 127.0.0.1     same API + HMR push after each parse
          │                                   │
          └──────────────┬────────────────────┘
                         ▼
      src/data/loadSessions.ts  (list, ETag-revalidated) · loadSessionDetail(id)
      src/utils/rateLimits.ts   (/api/limits)
                         │
                         ▼
      src/App.tsx ─┬─ Sidebar · TopBar/StatsRow · SessionList
                   ├─ FleetDashboard (fleet/*)  or  SessionCompare
                   └─ SessionDetail overlay (Overview · Tools · Tokens · Files)
```

---

## 2. Data sources

### Read (owned by Claude Code, never modified except where noted)

| Path under `~/.claude/` | Used for |
|---|---|
| `projects/<slug>/<id>.jsonl` | Primary source: every number (tokens, cost, turns, tools, prompts, timeline, durations, commits). |
| `projects/<slug>/<id>/subagents/*.jsonl` | Sub-agent transcripts, merged into the parent session. |
| `sessions/<pid>.json` | Which sessions are running (pid + sessionId + startedAt). |
| `sessions/.stale/<id>.json` | Legacy: files older dashboard versions moved there; treated as dead sessions. |
| `usage-data/session-meta/<id>.json`, `usage-data/facets/<id>.json` | Written by `/insights`. Used only for qualitative fields (goal, summary, outcome, satisfaction, frictions), and as a numeric fallback when the transcript is gone. |
| `usage-data/report.html` | The `/insights` report, proxied at `/usage-report.html`. |
| `file-history/<id>/<hash>@v<n>` | File snapshots for the Files tab and diffs. |
| `history.jsonl` | Fallback first prompt when neither transcript nor meta has one. |
| `token-optimizer/quality-cache-<id>.json` | Optional context-quality score from the token-optimizer plugin. |
| `~/.claude.json` (`oauthAccount`) | Display name and email for the profile menu. |

### Written

- Everything ccblackbox writes by itself lives under `~/.claude/ccblackbox/`:
  - `cache/<id>.jsonl`: one line per tool call / stop, appended by the plugin hook (mode `0600`).
  - `limits.json`: latest `rate_limits` payload, written atomically by the status line wrapper.
  - `statusline.mjs`, `statusline.json`: installed wrapper and the saved previous `statusLine` setting.
  - `sessions.json`: full parse dump, only when `pnpm parse` is run by hand. The app never reads it.
  - `models.json`: never written; the user creates it to override prices.
- `~/.claude/settings.json` is modified only by `install-statusline.mjs` (i.e. when the user runs `/ccblackbox:limits`), with a backup at `settings.json.ccblackbox.bak`. `--uninstall` restores the previous `statusLine`.
- Deletions and moves of Claude Code files happen only on explicit user action in the UI:
  - **Ghost delete** (single or bulk): unlinks `projects/<slug>/<id>.jsonl` and `sessions/.stale/<id>.json`, and only for sessions the parser currently classifies as ghosts.
  - **Trash a parse error**: moves an unparseable `usage-data/session-meta/<file>.json` to the macOS Trash (via Finder/`osascript`), or on other platforms to `usage-data/session-meta/.trash/`.
- `sessions/<pid>.json` files are never moved or deleted (see `classifyLiveFiles`).

---

## 3. Parser (`scripts/parse-sessions.mjs`)

Used as a library by `scripts/api.mjs`, and as a CLI (`pnpm parse`) that writes `~/.claude/ccblackbox/sessions.json`.

### Pipeline (`parseAllSessions`)

1. `loadModelOverrides()` reads `~/.claude/ccblackbox/models.json` and applies it via `setModelOverrides` (invalid file → warning, built-in table).
2. `classifyLiveFiles()` splits `sessions/*.json` into alive pid files and dead session ids. A pid is alive if `process.kill(pid, 0)` succeeds **and** `ps -p <pid> -o comm=` matches `claude`. Read-only. Ids in `sessions/.stale/` are added to the dead set.
3. `readHistoryBySession()` groups `history.jsonl` by session id.
4. `indexTranscripts()` maps every `projects/*/<id>.jsonl` by session id. Project directory names are lossy (`.`, `_`, `/` all become `-`), so lookups are by id only, never by reconstructed path.
5. `collectLive()` expands each alive pid file to its `/clear` chain (sibling transcripts in the same project dir with the same `custom-title`, modified later); only the newest in the chain is marked live.
6. Meta files are read; one without `session_id` or `start_time` is reported in `errors` (surfaced in the sidebar with a Trash action).
7. `buildSession()` runs for the union of transcript ids, meta ids and live ids.
8. Post-passes: `linkClearedChains()` sets `clearedFrom` / `clearedInto` (same `cwd` + `customTitle`), `reassignLiveToChainTail()` moves the live flag to the chain tail, `markUnpriced()` lists models without a pricing row.

Sessions are returned sorted by `startedAt` descending.

### Transcript parsing (`parseTranscriptFile`)

- Claude Code writes one line per content block (thinking / text / tool_use), each repeating the message id and the full `usage`. Lines are merged into one **turn per API message** (`message.id`, else `requestId`); the last line's `usage` wins. Summing lines would double-count.
- `<synthetic>` assistant messages are skipped. Each turn keeps its own normalized model, so sessions that switch models are priced per turn.
- Token fields per turn: `input`, `output`, `cacheRead`, `cacheWrite`, and the `cacheWrite5m` / `cacheWrite1h` split from `usage.cache_creation`.
- `tool_use` blocks are deduplicated by id. MCP tools are counted per server (`mcp__github__x` → `mcp:github`). `Agent` / `Task` calls produce `agent` timeline events; Bash commands matching `git commit` count as commits.
- User lines: `tool_result` blocks attach a truncated result (text, bytes, `isError`) to their tool call; `isMeta`, compact summaries and command / system-reminder / interruption lines are not counted as prompts.
- Active time sums gaps between events, capping each gap at 5 minutes (`IDLE_CAP_MS`); `wallMs` is wall-clock.
- `runningTool` is the last `tool_use` without a result (shown only for live sessions).
- Caps: prompt texts (first 100, truncated), tool sequence (first 300 entries, previews truncated), result previews.
- File paths from tool inputs are hashed (`sha256(path)` first 16 hex chars) to label `file-history` entries; unmatched hashes are shown without a path.

`readTranscriptFile` caches parsed results in `transcriptCache`, keyed by path and invalidated when `mtime` or `size` changes, so periodic re-parses only re-read transcripts that grew.

### Sub-agents

`readSubagents()` parses `<project>/<sessionId>/subagents/*.jsonl` in sidechain mode: their turns (flagged `sidechain`), tokens and tool counts are merged into the parent session; they contribute no prompts and no tool-sequence rows.

### Session assembly (`buildSession`)

- Numbers come from the transcript + sub-agents. When the transcript is missing, the session is built from session-meta (`transcriptMissing: true`; tokens are only meta's input/output totals; timeline is meta's prompt timestamps).
- Qualitative fields from `/insights` facets: `outcome`, `satisfaction` (0.5 when absent), `goal`, `summary`, `frictions`. Without facets, goal falls back to custom title → live name → first prompt.
- `model` is the dominant model by output tokens.
- **Ghost** = not live and either dead-process (`ghostKind: "crashed"`: pid file exists but process gone, or id in `.stale/`) or empty (`"empty"`: transcript with no user prompt and no tool call).
- The plugin cache (`~/.claude/ccblackbox/cache/<id>.jsonl`) is merged into `toolSequence`, dropping plugin entries that duplicate a transcript entry within 500 ms; `pluginCapture` summarizes it.
- `summarizeSession()` strips heavy fields for the list endpoint but keeps lightweight `turns` and `prompts` (timestamps, tokens, previews) needed by fleet aggregations.

### Other exports

- `readLimits()` normalizes `limits.json` into `{ capturedAt, fiveHour, sevenDay }` with `usedPct` and `resetsAt` (ms). A window whose `resetsAt` is in the past is reported as 0% used.
- `readProfile()` returns `{ name, email }` from `~/.claude.json`, or `null` (logged out / API key).

---

## 4. Pricing and models (`scripts/models.mjs`)

A single table shared by the parser (Node) and the UI (imported by Vite; types in `scripts/models.d.mts`).

- `MODELS`: `label`, `in`, `out`, `cacheRead` in USD per million tokens (public API rates). Cache writes are derived: 1.25× input (5-minute TTL), 2× input (1-hour TTL).
- `normalizeModel()`: `claude-opus-5-5[1m]` → `opus-5.5`, date suffixes stripped, bare aliases (`opus`, `sonnet[1m]`) mapped to the family's latest model (`FAMILY_LATEST`), `<synthetic>` → `null`.
- `priceFor()`: unknown ids fall back to the family's latest price, then to `DEFAULT_MODEL`; `isKnownModel()` flags these as estimates (`unpricedModels` on the session, shown with a hint in the UI).
- `costOf()`: bills `cacheWrite1h` at the 1h rate and the remaining cache writes at the 5m rate.
- `setModelOverrides()`: rebuilds the table from the built-ins plus `~/.claude/ccblackbox/models.json` (keys raw or normalized; rows need numeric `in`, `out`, `cacheRead`; invalid rows skipped). The server sends the accepted overrides in `/api/sessions` (`models`), and `loadSessions()` applies them in the browser so UI-side costs match.
- `baselineCostUsd` (parser) is the same tokens priced without caching, used to show cache savings.

Costs are API-equivalent estimates; they are not what a subscription plan bills.

---

## 5. Usage limits and the 5-hour window

Claude Code exposes the real limits (`rate_limits.five_hour` / `seven_day`, as in `/usage`) only in the JSON it pipes to the status line command. So:

1. `/ccblackbox:limits` runs [`scripts/install-statusline.mjs`](scripts/install-statusline.mjs): copies [`scripts/statusline.mjs`](scripts/statusline.mjs) to `~/.claude/ccblackbox/statusline.mjs` (stable path across plugin updates), saves the current `statusLine` to `statusline.json`, and points `settings.json` at the wrapper.
2. On every status line refresh the wrapper writes `limits.json`, then pipes the untouched payload to the user's previous status line command, or prints a minimal `model · 5h n% · 7d n%` line if there was none.
3. `/api/limits` serves `readLimits()`; [`src/utils/rateLimits.ts`](src/utils/rateLimits.ts) polls it every 5 s (`useRateLimits`).

The 5h window in the UI (`fleet/FiveHourSession.tsx`, `utils/fleetStats.ts`):

- With real limits: window start = `resetsAt − 5h`; the used % is real. Per-session / per-prompt shares of that % are attributed pro rata to estimated cost (an approximation).
- Without: the window is inferred locally. The first turn after the previous window expired anchors a new window, persisted in `localStorage` (`ccblackbox:window-start`, `utils/windowState.ts`); shares are by tokens.
- `utils/burnTracker.ts` samples the real 5h % every 5 s (1 h buffer) and raises a spike banner when it climbs 4+ points within 5 minutes (critical at 10). It is inactive until limits are connected. `SpikeAnalysisOverlay` + `SpikeHeuristics` explain the spike from sessions, prompts and tools in that interval.

---

## 6. API (`scripts/api.mjs`)

Shared by the production server and the Vite dev server, so both expose the same routes with the same checks.

**Cache and refresh.** `startApi()` parses once, then keeps the in-memory cache (`sessions`, `byId`, `errors`, serialized list + ETag) fresh:
- `fs.watch` on `sessions/`, `usage-data/session-meta/`, `usage-data/facets/`, `ccblackbox/cache/` (missing dirs are skipped with a warning);
- a 10 s interval (transcripts under `projects/` are not watched);
- events are coalesced: at most one parse every 5 s (minimum 600 ms delay), and a parse requested during a parse runs right after it.
- An `onParsed` callback runs after each parse (the dev server uses it for HMR).

| Method | Path | Purpose | Guards |
|---|---|---|---|
| GET | `/api/sessions` | Session summaries + `errors` + `models` overrides + `generatedAt`. | `ETag` / `If-None-Match` → 304; `cache-control: no-cache`. |
| GET | `/api/sessions/:id` | Full session from the cache. | id must be a 36-char UUID; 404 if unknown. |
| GET | `/api/file-history/:id/:hash@v:n` | Raw snapshot from `file-history/`. | id and file name regex-validated (no path traversal). |
| GET | `/api/limits` | `readLimits()` or `null`. | `no-store`. |
| GET | `/api/profile` | `readProfile()` or `null`. | `no-store`. |
| GET | `/api/report-status` | Whether `usage-data/report.html` exists, and its mtime. | `no-store`. |
| POST | `/api/ghost/:id/reveal` | Reveal the transcript in the OS file manager (`open -R`, `explorer /select`, `xdg-open` on the folder). | UUID check; POST only. |
| POST | `/api/ghost/:id/delete` | Delete one ghost's transcript (+ `.stale` file), then re-parse. | UUID check; 409 unless currently classified ghost. |
| POST | `/api/ghost/bulk-delete` | Body `{ ids: [...] }`; same as above for each id. | Ids filtered to valid UUIDs that are ghosts; 400 if none remain. |
| POST | `/api/parse-error/:file/trash` | Trash an unparseable session-meta file, then re-parse. | File name must be `<uuid>.json`; POST only. |
| GET | `/usage-report.html` | Proxies the `/insights` report (placeholder page with 404 if missing). | `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:`. |

Any other `/api/*` path returns 404; non-API paths fall through to static files (prod) or Vite (dev).

---

## 7. Security model

The API serves prompts, file snapshots and account info, and can delete files, so it is local-only and defends against other web pages in the same browser:

- **Loopback bind.** `serve.mjs` listens on `127.0.0.1` only.
- **DNS rebinding.** Every request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` (any port) gets 403, in prod and dev.
- **Cross-site writes.** Non-GET/HEAD requests are rejected when `Sec-Fetch-Site` is present and not `same-origin`, or when `Origin` does not match `Host`. Local non-browser clients (curl) send neither header and are allowed. Cross-origin GETs cannot read responses since no CORS headers are sent.
- **Input validation.** Session ids, snapshot names and meta file names are regex-checked before touching the filesystem; the static server normalizes paths and refuses anything outside `dist/`.
- **Destructive actions are narrow.** Deletes only apply to sessions the parser currently classifies as ghosts; parse-error cleanup moves to a trash rather than unlinking.
- **Generated HTML is sandboxed.** `/usage-report.html` is served with a CSP `sandbox` so it cannot run scripts on the API origin.
- **Hook output is private.** Plugin cache files are created with mode `0600` (previews can contain secrets from tool I/O).
- **No personal data in the repo or package.** `pnpm parse` writes to `~/.claude/ccblackbox/`, and `public/sessions.json` / `dist/sessions.json` are gitignored and excluded from the npm `files`.

---

## 8. Front end (`src/`)

React 19 + TypeScript, bundled by Vite. No router or state library.

### Data loading

- [`src/data/loadSessions.ts`](src/data/loadSessions.ts): `loadSessions()` fetches `/api/sessions` with `cache: "no-cache"` (ETag revalidation) and applies the `models` overrides; `loadSessionDetail(id)` fetches `/api/sessions/:id` when a session is opened. If the API is unreachable or returns no sessions, the app falls back to `src/data/mockSessions.ts` (shown as mock source in the top bar).
- **Polling / HMR.** In production `App.tsx` refreshes every 5 s (cheap thanks to 304s). In dev, polling is off and the app refetches on the `ccblackbox:sessions-updated` HMR event pushed after each server-side parse. `/api/report-status` is fetched on each refresh; `/api/limits` is polled separately (5 s); `/api/profile` once.

### State and routing (`App.tsx`)

- Selected session, range (`today` / `7d` / `30d` / `all`), sidebar filter (`all`, `live`, `ghost`, `friction`, `failed`, `lowquality`), project and search are mirrored to the URL hash (`#session/<id>?range=…&filter=…&project=…&q=…`) and to `localStorage` (`ccblackbox:state`).
- The detail view merges the list summary with the fetched full session.
- Keyboard: `j`/`k` or arrows (next/previous), `Esc` (close / exit zoom), `Cmd/Ctrl+F` (zoom dashboard), `?` (help).

### Components

| Component | Role |
|---|---|
| `Sidebar` | Filters with counts (ghosts split by crashed / empty), project list, parse errors with Trash action, `UserProfile` menu (profile + `LimitsSection` connection status). |
| `StatsStrip` (`TopBar`, `StatsRow`) | Range picker, data source + freshness, link to `/usage-report.html`, headline stats for the filtered set. |
| `SessionList` | Filtered list, search, compare-mode selection, bulk ghost delete bar. |
| `FleetDashboard` | Right pane when not comparing; composes `fleet/*`. |
| `SessionCompare` | Side-by-side metrics for selected sessions. |
| `SessionDetail` | Full-screen overlay: header (outcome, cost, resume command, export), live / cleared-chain / ghost banners (reveal, delete), and four tabs: **Overview** (summary, prompts, frictions; friction badge), **Tools** (tool counts and sequence with results, can be focused on one prompt), **Tokens** (per-prompt and per-turn cost breakdown), **Files** (file-history versions with diffs via `diff`). |
| `HelpOverlay` | Keyboard shortcuts. |

`fleet/`: `LiveTicker` (live burn and limits), `FiveHourSession` (current 5h window, 7d bar, per-session/prompt share), `LiveSessions` (running sessions with sparklines), `TopSessions`, `AnomalyFlags`, `ProjectRollup`, `ModelMix`, `ToolsHeatmap`, `HeavyPrompts`, `TokenTimeSeries` (in the selected range), `BurnSpikeBanner` + `SpikeAnalysisOverlay` + `SpikeHeuristics`.

`utils/`: `fleetStats` (window/bucket aggregations, costs via `models.mjs`), `aggregateByPrompt`, `classifyPrompt`, `burnTracker`, `rateLimits`, `windowState`, `range`, `format`, `exportSession` (standalone HTML export of a session).

---

## 9. Plugin packaging

- [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) and [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json): plugin `ccblackbox`, source `./` (the repo root is the plugin).
- [`hooks/hooks.json`](hooks/hooks.json): runs [`hooks/capture.mjs`](hooks/capture.mjs) on `PostToolUse` (tool name + truncated input/output previews) and on `Stop` (`--stop` marker). The hook validates the session id, reads stdin with a timeout, never writes to stdout and swallows every error so it cannot break Claude Code.
- [`commands/replay.md`](commands/replay.md) → `/ccblackbox:replay`: starts `scripts/serve.mjs` (flags forwarded: `--port <n>`, `--no-open`).
- [`commands/limits.md`](commands/limits.md) → `/ccblackbox:limits`: runs `install-statusline.mjs` (`--uninstall` forwarded).
- The server needs the prebuilt `dist/`, which is why it is committed (plugins install from the repo, with no build step).

---

## 10. Build and release

| Script | Does |
|---|---|
| `pnpm dev` | Vite dev server with the API middleware (`vite.config.ts`) and HMR push. |
| `pnpm build` | `tsc -b && vite build` → `dist/`. |
| `pnpm serve` | `node scripts/serve.mjs` (default port 3333; `--port`, `--no-open`). Also the `ccblackbox` bin. If the port is taken it assumes an instance is running, opens it and exits. |
| `pnpm parse` | One-off parse to `~/.claude/ccblackbox/sessions.json`. |
| `pnpm lint`, `pnpm typecheck` | ESLint, `tsc -b --noEmit`. |

- `dist/` is committed (`!dist/` in `.gitignore`); rebuild and commit it with UI changes.
- npm `files`: `dist` (minus `sessions.json`), `scripts`, `hooks`, `commands`, `.claude-plugin`, `ARCHITECTURE.md`. Runtime dependencies are only needed for the bundle; the server uses the Node standard library. Node ≥ 20.

---

## 11. Known limitations

- **Live detection needs `ps`.** `isClaudePidAlive` shells out to `ps`, which does not exist on Windows; there, running sessions are not detected and their pid files make them look crashed.
- **No data without `sessions/` or `usage-data/session-meta/`.** `parseAllSessions` returns nothing if neither directory exists, even when transcripts exist under `projects/`.
- **Transcript changes are picked up by polling.** `projects/` is not watched; updates arrive through the 10 s refresh or through a change in a watched dir (the plugin hook's cache writes trigger one on every tool call).
- **`/clear` chains are heuristic.** They are linked by identical `custom-title` in the same project/cwd.
- **Qualitative fields depend on `/insights`.** Without it, outcome is `unknown`, satisfaction defaults to 0.5, frictions are empty. Friction positions (`at`) are synthetic, not timestamps.
- **Truncation.** Prompts, tool sequence and previews are capped; sub-agent tool calls appear in counts and turns but not in the tool sequence.
- **Costs are estimates** at public API prices; unknown models are priced at their family's latest model. The per-session share of the real 5h % is pro rata to cost, not Anthropic's actual weighting.
- **Commits** are counted by matching `git commit` in Bash commands.
- **Mock fallback.** An unreachable API or an empty session list shows bundled mock data.
- **Unused components.** `src/components/Heatmap.tsx` and `src/components/FrictionPanel.tsx` are not rendered anywhere.
