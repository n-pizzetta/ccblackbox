export type Outcome = "fully_achieved" | "mostly_achieved" | "partially_achieved" | "not_achieved" | "in_progress" | "unknown";

export type GhostKind = "empty" | "crashed";

export type FrictionKind =
  | "wrong_approach"
  | "buggy_code"
  | "missing_context"
  | "tool_error"
  | "user_interruption";

export interface Friction {
  kind: FrictionKind;
  at: number;
  detail: string;
}

/** Any Claude Code tool name; MCP tools are grouped per server as `mcp:<server>`. */
export type ToolName = string;

export interface TimelineEvent {
  t: number;
  kind: "prompt" | "tool" | "friction" | "commit" | "agent";
  tool?: ToolName;
  label: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface QualitySignal {
  kind: string;
  label: string;
  score: number;
  detail: string;
  wasteTokens: number;
}

export interface SessionQuality {
  score: number;
  grade: string;
  fillPct: number | null;
  band: string | null;
  wasteTokens: number;
  signals: QualitySignal[];
}

export interface Session {
  id: string;
  project: string;
  cwd: string;
  startedAt: string;
  /** Active time: each gap between transcript events counts for at most 5 min. */
  durationMs: number;
  /** Wall-clock span from the first to the last event (or now, while live). */
  wallMs?: number;
  /** Normalized id, e.g. `opus-5.5` (see scripts/models.mjs). */
  model: string;
  /** Tokens and cost per model, set by scopeToRange for aggregate views. */
  modelUsage?: Record<string, { tokens: number; cost: number }>;
  /** Models used without a pricing row: cost is an estimate. */
  unpricedModels?: string[];
  outcome: Outcome;
  satisfaction: number;
  goal: string;
  summary: string;
  messages: number;
  toolCounts: Record<ToolName, number>;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite5m?: number;
    cacheWrite1h?: number;
  };
  costUsd: number;
  baselineCostUsd?: number;
  frictions: Friction[];
  timeline: TimelineEvent[];
  subAgents: number;
  filesChanged: number;
  commits: number;
  /** Bash commands by kind (main thread only); detail payload only, used for badges. */
  shell?: { prs: number; tests: number; lints: number; infra: number };
  live?: boolean;
  ghost?: boolean;
  ghostKind?: GhostKind;
  /** The transcript is gone: numbers come from /insights session-meta (no cache tokens). */
  transcriptMissing?: boolean;
  lastEventAt?: string;
  runningTool?: { tool: string; preview: string; t: number } | null;
  clearedFrom?: string;
  clearedInto?: string;
  quality?: SessionQuality | null;
  fileHistory?: Array<{ hash: string; versions: number[]; path?: string }>;
  prompts?: Array<{ t: number; text: string; preview: string }>;
  toolSequence?: Array<{
    t: number;
    tool: string;
    preview: string;
    full?: string;
    result?: { text: string; truncated: boolean; isError: boolean; bytes?: number };
    source?: "plugin";
  }>;
  pluginCapture?: {
    entries: number;
    lastEventAt: string;
    stoppedAt: string | null;
  } | null;
  turns?: Array<{
    t: number;
    /** Model of this turn (sessions can switch models). */
    model?: string;
    /** Turn made by a sub-agent (from <session>/subagents/*.jsonl). */
    sidechain?: boolean;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      cacheWrite5m?: number;
      cacheWrite1h?: number;
    };
    tools: string[];
    promptIdx?: number;
    inBytes?: number;
    outBytes?: number;
    inPreview?: string;
    outPreview?: string;
  }>;
}
