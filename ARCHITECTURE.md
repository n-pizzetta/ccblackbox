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
 ├── usage-data/facets/<id>.json                 ├── badges.json           ◀── api.mjs
 │                                               └── sessions.json         ◀── `pnpm parse` only
 ├── usage-data/report.html
 ├── file-history/<id>/<hash>@v<n>
 ├── history.jsonl
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
      src/App.tsx ─┬─ TopBar/StatsRow · SessionList (+ SessionFilters)
                   ├─ FleetDashboard (fleet/*)  or  SessionCompare
                   └─ SessionDetail overlay (Overview · Tools · Tokens · Files)
```

---

## 2. Data sources

All paths are relative to the Claude config dir: `~/.claude`, or `$CLAUDE_CONFIG_DIR` when set (as in Claude Code). `pnpm seed:demo` writes a synthetic one to `.demo-claude/` for development (`CLAUDE_CONFIG_DIR="$PWD/.demo-claude" pnpm dev`).

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

### Written

- Everything ccblackbox writes by itself lives under `~/.claude/ccblackbox/`:
  - `cache/<id>.jsonl`: one line per tool call / stop, appended by the plugin hook (mode `0600`).
  - `limits.json`: latest `rate_limits` payload, written atomically by the status line wrapper. `limits-history.jsonl`: one line per change of either window (`{t, five:{p,r}, seven:{p,r}}`, trimmed at 512 KB), kept to calibrate "% of window" later.
  - `badges.json`: `{ startedAt, unlocked }`. `startedAt` is written on the API's first parse (first launch); `unlocked` maps `<family>:<tier>` to the unlock date. See §5.
  - `live/<session_id>.json`: sanitized per-session snapshot (context size, prompt-cache state; no paths or prompts) written on every refresh; the API removes ones older than 3 days.
  - `statusline.mjs`, `context-advice.mjs`, `statusline.json`: installed wrapper, its shared helper, and the saved previous `statusLine` setting (plus `"verdict": false` to hide the terminal segment).
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
6. Meta files are read; one without `session_id` or `start_time` is reported in `errors` (surfaced as a badge in the top bar with a Trash action).
7. `buildSession()` runs for the union of transcript ids, meta ids and live ids.
8. Post-passes: `linkClearedChains()` sets `clearedFrom` / `clearedInto` (same `cwd` + `customTitle`), `reassignLiveToChainTail()` moves the live flag to the chain tail, `markUnpriced()` lists models without a pricing row.

Sessions are returned sorted by `startedAt` descending.

### Transcript parsing (`parseTranscriptFile`)

- Claude Code writes one line per content block (thinking / text / tool_use), each repeating the message id and the full `usage`. Lines are merged into one **turn per API message** (`message.id`, else `requestId`); the last line's `usage` wins. Summing lines would double-count.
- `<synthetic>` assistant messages are skipped. Each turn keeps its own normalized model, so sessions that switch models are priced per turn.
- Token fields per turn: `input`, `output`, `cacheRead`, `cacheWrite`, and the `cacheWrite5m` / `cacheWrite1h` split from `usage.cache_creation`.
- `tool_use` blocks are deduplicated by id. MCP tools are counted per server (`mcp__github__x` → `mcp:github`). `Agent` / `Task` calls produce `agent` timeline events; Bash commands matching `git commit` count as commits. Each Bash command is also split on `&& ; |` and newlines, and segment heads are classified into `shell: { prs, tests, lints, infra }` (`gh pr create`, test runners, lint / typecheck / build, docker / kubectl / terraform / gcloud…), counted once per command; `echo "npm test"` does not count.
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

### Context and prompt-cache advice

The same payload carries `context_window` (size, % used, last-turn usage) and `prompt_cache` (`warm`, `ttl`, `expires_at`, hit ratio, misses, `recache_tokens_if_cold`). [`scripts/context-advice.mjs`](scripts/context-advice.mjs) (pure, shared by the wrapper and the dashboard like `models.mjs`) turns it into a snapshot (`toSnapshot`) and a verdict (`adviseContext`): *keep going*, *wrap up before pausing*, *compact at the next break*, *compact now*, or *clear if the task is done*, each with its reasons. Thresholds are heuristics (`THRESHOLDS`): context ≥ 70% / 85% of the window; a cold cache matters from 40% of the window or 100k tokens to re-cache; a warm cache is "expiring" under 10 min. A cold cache is the case where `/compact` is no cheaper than a normal message (it re-reads everything at full price), so `/clear` is advised.

The wrapper appends a short segment to the status line (`ctx ━━━───── 33% │ cache warm 59m`, colored by level, plus a hint when it matters). The dashboard polls `/api/live-context` once (`useLiveContext`, a shared store) and shows the result where the session is: a third line on session rows in the list (`ContextLine`: fill bar, cache countdown computed from `expires_at`, the verdict when it is not "keep going"; rows with it are taller, which the virtualized list accounts for) and a banner in the session view (`ContextCard`: ring, cold-start cost, verdict, reasons on click).

The 5h window in the UI (`fleet/FiveHourSession.tsx`, `utils/fleetStats.ts`):

- With real limits: window start = `resetsAt − 5h`; the used % is real. Per-session / per-prompt shares of that % are attributed pro rata to estimated cost (an approximation).
- Without: the window is inferred locally. The first turn after the previous window expired anchors a new window, persisted in `localStorage` (`ccblackbox:window-start`, `utils/windowState.ts`); shares are by tokens.
- `utils/burnTracker.ts` samples the real 5h % every 5 s (1 h buffer) and raises a spike banner when it climbs 4+ points within 5 minutes (critical at 10). It is inactive until limits are connected. `SpikeAnalysisOverlay` + `SpikeHeuristics` explain the spike from sessions, prompts and tools in that interval.

### Badges (`scripts/badges.mjs`)

Computed server-side after every parse (`updateBadges` in the API), because they need full sessions (`shell`, `timeline`, `turns`) that the list payload omits. `fleet/Badges.tsx` fetches `/api/badges` whenever the session list changes.

- **Only sessions started after the first launch count** (`badges.json` `startedAt`). History stays in every other view; badges start from zero so they feel earned and don't depend on how much transcript history Claude Code kept (`cleanupPeriodDays`).
- **Unlocks are permanent**: stored with their date, so they survive transcript cleanup and 30-day windows sliding past them.
- **Families**: one metric per family, tiers only raise the target, so a lower tier can never be harder than a higher one. Some families have 2 or 3 tiers; `oneshot` starts at gold.
- **Calibration**: per-session records (Marathon, Orchestrator, File surgeon, Toolbox, Juggler) by rarity across real sessions; cumulative counters by time for a heavy user: bronze on day 1, silver in 1–2 weeks, gold in ~3 months, platinum in ~1 year.
- **Continuous work**: Marathon, Juggler and Hours use stretches of main-thread activity (turns and prompts) where no pause exceeds 15 minutes (`RUN_GAP_MS`), not `durationMs`, which accumulates capped gaps over sessions left open for days. Hours counts the union of stretches, so parallel sessions count once.
- **Streak** skips quiet Saturdays and Sundays.
- `sniper` and `comeback` need `/insights` facets; `hygiene` needs scored sessions (5+ turns). They are hidden (`available: false`) when no session has that data.
- The shell-based families only see commands run by Claude, not ones typed in another terminal.

### Context quality (`scripts/quality.mjs`)

Measured while parsing each main-thread transcript (sub-agents are not scored), so it needs no other plugin. Sessions under 5 assistant turns get no score. Five signals, each 0–100 (100 = no waste), weighted into the score; waste tokens are estimated as characters / 4:

| Signal | Weight | Measure |
|---|---|---|
| Context fill | 0.3 | Peak context (`input + cacheRead + cacheWrite` of a turn) vs the window: 100 up to 50%, 0 at 95%. The window isn't in the transcript: a peak over 200k implies 1M. |
| Stale reads | 0.2 | `Read` of the same file and range with no edit to that file in between (−10 each). |
| Bloated results | 0.2 | Tool results over 25k characters (−15 each). |
| Compaction depth | 0.2 | `isCompactSummary` lines: 0 → 100, 1 → 70, 2 → 40, more → 10. |
| Duplicates | 0.1 | Same command, pattern, URL or query repeated with no edit in between (−10 each). |

Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F. The list payload keeps the score, grade, fill, band, waste and compaction count; signal details are in the session payload.

### Health check (`src/utils/healthRules.ts`)

The **Health** tab is a checklist of rules over the sessions in the selected range (ghosts excluded, except for the housekeeping rule). Each rule passes, warns or fails against a threshold written next to it, explains why it matters and what to do, and links up to 5 sessions behind a miss. Rules without data (for example outcomes before `/insights` ran) show as n/a and don't count. The Rankings hero shows the result (`passed / total`).

Rules: context quality, context headroom, compactions, prompt cache, startup cost (median first-turn context: system prompt, CLAUDE.md, memory, skills and MCP tools), outcomes, friction, forgotten sessions (process running over 24h, from the pid file's `startedAt`) and housekeeping (ghosts). Adding one means appending a function to `RULES`.

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
| GET | `/api/badges` | Badge families with per-tier progress and unlock dates (§5). | `no-store`. |
| GET | `/api/limits` | `readLimits()` or `null`. | `no-store`. |
| GET | `/api/live-context` | `readLiveContext()`: context / prompt-cache snapshots per session, newest first. | `no-store`. |
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

- [`src/data/loadSessions.ts`](src/data/loadSessions.ts): `loadSessions()` fetches `/api/sessions` with `cache: "no-cache"` (ETag revalidation) and applies the `models` overrides; `loadSessionDetail(id)` fetches `/api/sessions/:id` when a session is opened. If the API is unreachable or returns no sessions, the app falls back to `src/data/mockSessions.ts` (shown as an amber status dot and "mock data" in the profile menu).
- **Polling / HMR.** In production `App.tsx` refreshes every 5 s (cheap thanks to 304s). In dev, polling is off and the app refetches on the `ccblackbox:sessions-updated` HMR event pushed after each server-side parse. `/api/report-status` is fetched on each refresh; `/api/limits` and `/api/live-context` are polled separately (5 s).

### State and routing (`App.tsx`)

- Selected session, range (`today` / `7d` / `30d` / `all`), list filter (`all`, `live`, `ghost`, `friction`, `failed`, `lowquality`), project and search are mirrored to the URL hash (`#session/<id>?range=…&filter=…&project=…&q=…`) and to `localStorage` (`ccblackbox:state`).
- The detail view merges the list summary with the fetched full session.
- Keyboard: `j`/`k` or arrows (next/previous), `Esc` (close / exit zoom), `Cmd/Ctrl+F` (zoom dashboard), `?` (help).

### Components

| Component | Role |
|---|---|
| `SessionFilters` | Filters button + popover (status filters with counts, ghosts split by crashed / empty; project list; outcome-bar legend) and the removable chips of the active filters. Clicking a project pill on a session row filters on that project. |
| `LimitsPill` | The 5h and 7-day usage windows (fill, elapsed-time tick, reset countdown); rendered in the top bar and in the session view so they are always on screen. |
| `units` (`utils/units.ts`, `UnitSetting`) | Display unit for usage: **tokens** (fresh = input + output + cache writes; cached reads are shown apart) or **API value** ($ at API prices, read as a relative weight, since a subscription is limited by the 5h / 7d windows rather than dollars). Persisted in `localStorage` (`ccblackbox:unit`), set from the profile menu. Rankings by weight (podium "Heaviest", project league) use API value. The podium "Longest" ranks by `longestRunMs` (longest main-thread stretch with no pause over 15 min), not `durationMs`, which adds up to 5 min per gap and so favors sessions left open for days. |
| `ParseErrors` / `ProfileMenu` | Top-bar badge listing unreadable session-meta files with a Trash action (only shown when there are some). Profile chip (data status dot, level, streak) opening a menu: level progress, links to the Health and Rankings tabs (`utils/openTab.ts` event, since `FleetDashboard` owns the tab), usage unit, data status and insights report, `LimitsSection`, keyboard shortcuts, bug report link. The top bar keeps only what is read constantly: limits, range and this chip. |
| `StatsStrip` (`TopBar`, `StatsRow`) | Brand, usage limits, range picker, data source + freshness, link to `/usage-report.html`, headline stats for the filtered set. |
| `SessionList` | Filtered list, search, compare-mode selection, bulk ghost delete bar. |
| `FleetDashboard` | Right pane when not comparing; composes `fleet/*`. |
| `SessionCompare` | Side-by-side metrics for selected sessions. |
| `SessionDetail` | Full-screen overlay: header (outcome, project, model, "Copy resume command", export), a context / cache banner (`ContextCard`), live / cleared-chain / ghost banners (reveal, delete), and four tabs: **Overview** (headline tiles from `SessionOverview`, then two columns: prompts timeline / list in the chosen usage unit on the left, frictions and small previews of the Tools, Tokens and Files tabs with "See all" links on the right; the summary is hidden when it repeats the goal), **Tools** (tool counts and sequence with results, can be focused on one prompt), **Tokens** (per-prompt and per-turn cost breakdown), **Files** (file-history versions with diffs via `diff`). |
| `HelpOverlay` | Keyboard shortcuts. |

`fleet/`: `FleetDashboard` has two tabs (**Rankings** and **Analysis**; the choice is kept in `localStorage`, `ccblackbox:fleet-tab`). Rankings: `HeroBanner`, `TopSessions` (podium, `FireCanvas`), `Badges`, `ProjectRollup`. Analysis: `LiveTicker` (one line of live burn) and `FiveHourSession` (current 5h window, per-session / prompt share; all sessions, ignoring filters), then `AnomalyFlags`, `ModelMix`, `ToolsHeatmap`, `HeavyPrompts`, `TokenTimeSeries` (in the selected range). `BurnSpikeBanner` + `SpikeAnalysisOverlay` + `SpikeHeuristics` sit above the tabs.

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
| `pnpm seed:demo` | Writes synthetic data to `.demo-claude/` (`scripts/seed-demo.mjs`). |

- `dist/` is committed (`!dist/` in `.gitignore`); rebuild and commit it with UI changes.
- npm `files`: `dist` (minus `sessions.json`), `scripts`, `hooks`, `commands`, `.claude-plugin`, `ARCHITECTURE.md`. Runtime dependencies are only needed for the bundle; the server uses the Node standard library. Node ≥ 20.

---

## 11. Known limitations

- **Live detection needs `ps`.** `isClaudePidAlive` shells out to `ps`, which does not exist on Windows; there, running sessions are not detected and their pid files make them look crashed.
- **Transcript changes are picked up by polling.** `projects/` is not watched; updates arrive through the 10 s refresh or through a change in a watched dir (the plugin hook's cache writes trigger one on every tool call).
- **`/clear` chains are heuristic.** They are linked by identical `custom-title` in the same project/cwd.
- **Qualitative fields depend on `/insights`.** Without it, outcome is `unknown`, satisfaction defaults to 0.5, frictions are empty. Friction positions (`at`) are synthetic, not timestamps.
- **Truncation.** Prompts, tool sequence and previews are capped; sub-agent tool calls appear in counts and turns but not in the tool sequence.
- **Costs are estimates** at public API prices; unknown models are priced at their family's latest model. The per-session share of the real 5h % is pro rata to cost, not Anthropic's actual weighting.
- **Commits** are counted by matching `git commit` in Bash commands.
- **Mock fallback.** An unreachable API shows bundled mock data; an empty `~/.claude` shows an empty dashboard.
