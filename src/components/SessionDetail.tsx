import { Fragment, useEffect, useRef, useState } from "react";
import { createPatch } from "diff";
import type { Session, SessionQuality, ToolName } from "../types";
import { estimateHint, formatBytes, formatClockAt, formatCost, formatDuration, formatTokens, outcomeColor, outcomeLabel } from "../utils/format";
import { SESSION_IDLE_GAP_MS } from "../utils/fleetStats";
import { downloadSessionHtml } from "../utils/exportSession";
import { classifyPrompt, PROMPT_KIND_COLOR, PROMPT_KIND_LABEL } from "../utils/classifyPrompt";
import { costOf, modelLabel, priceFor, type CostTokens, type ModelPrice } from "../../scripts/models.mjs";
import { toastError } from "../utils/toast";

function gradeColor(grade: string): string {
  if (grade === "S" || grade === "A") return "var(--c-green)";
  if (grade === "B") return "var(--c-cyan)";
  if (grade === "C") return "var(--c-amber)";
  return "var(--c-red)";
}

function signalColor(score: number): string {
  if (score >= 90) return "var(--c-green)";
  if (score >= 70) return "var(--c-cyan)";
  if (score >= 50) return "var(--c-amber)";
  return "var(--c-red)";
}

function QualitySignalRow({ signal }: { signal: SessionQuality["signals"][number] }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const info = SIGNAL_INFO[signal.kind];
  const color = signalColor(signal.score);
  return (
    <div className="quality-pop-signal">
      <div className="quality-pop-signal-head">
        <span className="mono quality-pop-signal-label">
          {signal.label}
          {info && (
            <button
              type="button"
              className="signal-info-btn"
              onClick={(e) => { e.stopPropagation(); setInfoOpen((v) => !v); }}
              aria-label={infoOpen ? "Hide explanation" : "Show explanation"}
              aria-expanded={infoOpen}
            >ⓘ</button>
          )}
        </span>
        <span className="mono tabular" style={{ color }}>{signal.score}/100</span>
      </div>
      <div className="quality-pop-meter">
        <div className="quality-pop-meter-fill" style={{ width: `${signal.score}%`, background: color }} />
      </div>
      {infoOpen && info && (
        <div className="signal-info-text">{info}</div>
      )}
      {signal.detail && <div className="quality-pop-detail dim">{signal.detail}</div>}
      {signal.wasteTokens > 0 && (
        <div className="quality-pop-waste-line mono dim tabular">
          ~{signal.wasteTokens.toLocaleString()} waste tokens
        </div>
      )}
    </div>
  );
}

const SIGNAL_INFO: Record<string, string> = {
  context_fill_degradation: "How full the context window got. Past ~70% fill, Claude starts losing early context and repeating itself.",
  stale_reads: "Files re-read after they were already in context. Each duplicate Read wastes input tokens.",
  bloated_results: "Tool results longer than necessary (huge Bash output, oversized Read ranges). Truncate or narrow to save tokens.",
  duplicates: "Exact same tool call repeated back-to-back. Usually wasted work — result was already known.",
  compaction_depth: "Number of /compact operations. Each compaction loses detail irreversibly. Deep chains lose most of the original context.",
  decision_density: "Ratio of substantive assistant turns (tool calls, edits) vs filler. Low = lots of chit-chat per useful action.",
  agent_efficiency: "How effectively sub-agents were used. Zero agents in a long session often means work that could have been parallelized.",
};

function QualityChip({ quality }: { quality: SessionQuality }) {
  const c = gradeColor(quality.grade);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const btn = wrapRef.current?.querySelector(".quality-chip") as HTMLElement | null;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPos({ top: r.bottom + 8, left: r.left });
    };
    updatePos();
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sortedSignals = [...quality.signals].sort((a, b) => a.score - b.score);

  return (
    <div className="quality-chip-wrap" ref={wrapRef}>
      <button
        type="button"
        className="quality-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Quality score details"
        style={{
          "--badge-bg": `${c}14`,
          "--badge-c": c,
          "--badge-border": `${c}40`,
        } as React.CSSProperties}
      >
        <span className="quality-label">QUALITY</span>
        <span className="quality-grade">{quality.grade}</span>
        <span className="quality-score tabular">{quality.score.toFixed(1)}</span>
        <span className="badge-info" aria-hidden>ⓘ</span>
      </button>
      {open && pos && (
        <div
          ref={popRef}
          className="quality-popover"
          role="dialog"
          aria-label="Quality breakdown"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="quality-pop-head">
            <span className="mono dim">Measured by token-optimizer</span>
          </div>
          <div className="quality-pop-top">
            <div>
              <div className="dim mono caps">Grade</div>
              <div className="quality-pop-grade" style={{ color: c }}>{quality.grade}</div>
            </div>
            <div>
              <div className="dim mono caps">Score</div>
              <div className="quality-pop-score tabular">{quality.score.toFixed(1)} <span className="dim">/ 100</span></div>
            </div>
            {quality.band && (
              <div>
                <div className="dim mono caps">Band</div>
                <div className="mono">{quality.band}</div>
              </div>
            )}
            {quality.fillPct !== null && (
              <div>
                <div className="dim mono caps">Context fill</div>
                <div className="mono tabular">{Math.round(quality.fillPct)}%</div>
              </div>
            )}
          </div>
          {quality.wasteTokens > 0 && (
            <div className="quality-pop-waste mono">
              ~ <strong className="tabular">{quality.wasteTokens.toLocaleString()}</strong> tokens estimated wasted
            </div>
          )}
          <div className="quality-pop-signals">
            <div className="dim mono caps quality-pop-signals-head">Signals</div>
            {sortedSignals.length === 0 ? (
              <div className="placeholder">No signals recorded.</div>
            ) : (
              sortedSignals.map((s) => <QualitySignalRow key={s.kind} signal={s} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  session: Session;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onClose?: () => void;
  onNavigate?: (dir: "prev" | "next") => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  position?: number;
  total?: number;
}

type Tab = "overview" | "tools" | "tokens" | "files";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tools", label: "Tools" },
  { id: "tokens", label: "Tokens" },
  { id: "files", label: "Files" },
];

export function SessionDetail({
  session,
  fullscreen = false,
  onToggleFullscreen,
  onClose,
  onNavigate,
  hasPrev = false,
  hasNext = false,
  position,
  total,
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [toolFocus, setToolFocus] = useState<{ promptIdx: number; start: number; end: number } | null>(null);
  const [resumeCopied, setResumeCopied] = useState(false);
  const c = outcomeColor(session.outcome);

  const shellEscape = (s: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
  const resumeCmd = session.cwd
    ? `cd ${shellEscape(session.cwd)} && claude --resume ${session.id}`
    : `claude --resume ${session.id}`;
  const copyResume = async () => {
    try {
      await navigator.clipboard.writeText(resumeCmd);
      setResumeCopied(true);
      setTimeout(() => setResumeCopied(false), 1800);
    } catch {
      alert("Clipboard unavailable — command:\n" + resumeCmd);
    }
  };

  const focusToolsForPrompt = (promptIdx: number, start: number, end: number) => {
    setToolFocus({ promptIdx, start, end });
    setTab("tools");
  };

  return (
    <div className={`detail ${fullscreen ? "fullscreen" : ""}`} key={session.id}>
      <div className="detail-sticky">
        <div className="detail-toolbar">
          <div className="detail-nav">
            <button
              className="toolbar-btn"
              onClick={() => onNavigate?.("prev")}
              disabled={!hasPrev}
              title="Previous (↑ / k)"
              aria-label="Previous session"
            >↑</button>
            <button
              className="toolbar-btn"
              onClick={() => onNavigate?.("next")}
              disabled={!hasNext}
              title="Next (↓ / j)"
              aria-label="Next session"
            >↓</button>
            {position && total ? (
              <span className="mono dim toolbar-pos tabular">{position} / {total}</span>
            ) : null}
          </div>
          <div className="detail-toolbar-right">
            <button
              className="toolbar-btn"
              onClick={() => downloadSessionHtml(session)}
              title="Export session as HTML"
              aria-label="Export session"
            >
              ↓
            </button>
            {onClose ? (
              <button
                className="toolbar-btn"
                onClick={onClose}
                title="Close (Esc)"
                aria-label="Close session"
              >
                ✕
              </button>
            ) : onToggleFullscreen ? (
              <button
                className="toolbar-btn"
                onClick={onToggleFullscreen}
                title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (⌘F)"}
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? "⊗" : "⤢"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="detail-header">
          <div className="badge-row">
            <div
              className="outcome-badge"
              style={
                {
                  "--badge-bg": `${c}14`,
                  "--badge-c": c,
                  "--badge-border": `${c}40`,
                } as React.CSSProperties
              }
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: c,
                  boxShadow: `0 0 8px ${c}`,
                }}
              />
              {outcomeLabel(session.outcome)}
              <InfoDot
                title={
                  session.outcome === "in_progress"
                    ? "Session is currently running. Outcome is set to 'in progress' while live; an outcome is assessed later when /insights analyzes it."
                    : session.outcome === "unknown"
                    ? "Outcome unknown: /insights hasn't analyzed this session yet (it assesses sessions in batch). Run /insights in Claude Code to fill it in."
                    : "Outcome assessed by /insights from the transcript. Subjective: 'fully / mostly / partially / not' achieved. Not a hard metric — useful as a rough signal."
                }
              />
            </div>
            {session.quality && <QualityChip quality={session.quality} />}
          </div>
          <div className="goal">{session.goal}</div>
        </div>

        {session.live && <LiveStatus session={session} />}
        {(session.clearedFrom || session.clearedInto) && (
          <ClearedBanner session={session} />
        )}
        {session.ghost && <GhostBanner session={session} />}

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "overview" && session.frictions.length > 0 && (
                <span className="tab-badge">{session.frictions.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="detail-body scrollbar">
        {tab === "overview" && (
          <OverviewTab session={session} onFocusTools={focusToolsForPrompt} />
        )}
        {tab === "tools" && (
          <ToolsTab session={session} focus={toolFocus} onClearFocus={() => setToolFocus(null)} />
        )}
        {tab === "tokens" && <TokensTab session={session} />}
        {tab === "files" && <FilesTab session={session} />}
      </div>

      <div className="detail-footer">
        <span className="mono">
          {modelLabel(session.model)} ·{" "}
          <button
            className="footer-id-copy"
            onClick={copyResume}
            title={resumeCopied ? "Copied!" : `Copy resume command\n${resumeCmd}`}
            aria-label="Copy claude --resume command"
          >
            {resumeCopied ? "✓ copied" : session.id}
          </button>{" "}
          · {new Date(session.startedAt).toLocaleString()}
        </span>
        <span className="cost tabular">{formatCost(session.costUsd)}</span>
      </div>
    </div>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${String(rem).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

function LiveStatus({ session }: { session: Session }) {
  const now = useNow(1000);
  const lastTs = session.lastEventAt ? Date.parse(session.lastEventAt) : now;
  const elapsed = Math.max(0, now - lastTs);
  const running = session.runningTool;
  const prompts = session.prompts ?? [];
  const turns = session.turns ?? [];
  const lastPromptIdx = prompts.length > 0 ? prompts.length - 1 : -1;
  const lastPrompt = lastPromptIdx >= 0 ? prompts[lastPromptIdx] : null;
  const turnsOnLast = lastPromptIdx >= 0
    ? turns.filter((t) => t.promptIdx === lastPromptIdx).length
    : 0;

  // state classification
  let kind: "tool" | "thinking" | "idle" | "done";
  let label: string;
  if (running) {
    kind = "tool";
    label = `Running ${running.tool}`;
  } else if (elapsed < 5_000) {
    kind = "thinking";
    label = "Claude is thinking";
  } else if (elapsed < 30_000) {
    kind = "done";
    label = "Turn complete";
  } else {
    kind = "idle";
    label = "Idle — waiting for input";
  }

  return (
    <div className={`live-status live-status-${kind}`}>
      <div className="live-status-head">
        <span className="live-dot" aria-hidden />
        <strong className="live-status-label">{label}</strong>
        <span className="mono dim tabular live-status-elapsed">· {formatElapsed(elapsed)} since last event</span>
      </div>
      {running && (
        <div className="live-status-body mono">
          <span className="dim">input:</span>
          <span className="live-status-preview">{running.preview.slice(0, 140)}</span>
        </div>
      )}
      {lastPrompt && (
        <div className="live-status-prompt mono">
          <span className="dim">on prompt </span>
          <strong>#{lastPromptIdx + 1}</strong>
          <span className="dim"> · {turnsOnLast} turn{turnsOnLast === 1 ? "" : "s"} so far · </span>
          <span className="dim live-status-prompt-preview">{lastPrompt.preview.slice(0, 100)}</span>
        </div>
      )}
    </div>
  );
}

function ClearedBanner({ session }: { session: Session }) {
  const jump = (id: string) => {
    window.location.hash = `session/${id}`;
  };
  return (
    <div className="cleared-banner mono">
      <span className="cleared-banner-icon">⟲</span>
      <span className="cleared-banner-text">
        {session.clearedFrom && (
          <>
            Context cleared from{" "}
            <button className="cleared-link" onClick={() => jump(session.clearedFrom!)}>
              prev session
            </button>
            .
          </>
        )}
        {session.clearedInto && (
          <>
            {session.clearedFrom ? " · " : ""}
            Context cleared. Continues in{" "}
            <button className="cleared-link" onClick={() => jump(session.clearedInto!)}>
              next session →
            </button>
          </>
        )}
      </span>
    </div>
  );
}

const GHOST_KIND_COPY: Record<string, { label: string; desc: string }> = {
  empty: {
    label: "Ghost · empty",
    desc: "This session was aborted before any prompt was sent (startup canceled). Usually safe to delete.",
  },
  crashed: {
    label: "Ghost · crashed",
    desc: "Claude Code was killed while running (kill -9, reboot, or force-quit). Resume to pick up where it stopped.",
  },
};


function GhostBanner({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const kind = session.ghostKind ?? "empty";
  const copy = GHOST_KIND_COPY[kind];
  const cwd = session.cwd || "";
  const shellEscape = (s: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
  const resumeCmd = cwd
    ? `cd ${shellEscape(cwd)} && claude --resume ${session.id}`
    : `claude --resume ${session.id}`;

  const openTranscript = async () => {
    try {
      const res = await fetch(`/api/ghost/${session.id}/reveal`, { method: "POST" });
      if (!res.ok) toastError("Could not open the transcript file.");
    } catch (e) {
      toastError("Request failed: " + e);
    }
  };

  const copyResume = async () => {
    try {
      await navigator.clipboard.writeText(resumeCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError("Clipboard unavailable. Run manually: " + resumeCmd);
    }
  };

  const deletePermanently = async () => {
    if (!confirm(
      "Delete this ghost session permanently?\n\n" +
        "This removes the transcript jsonl and its stale live file. Cannot be undone.",
    )) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ghost/${session.id}/delete`, { method: "POST" });
      if (!res.ok) {
        const err = await res.text();
        toastError("Delete failed: " + err);
        return;
      }
      location.reload();
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <button className={`ghost-chip ghost-kind-${kind}`} onClick={() => setExpanded(true)} title={copy.desc}>
        <span className="ghost-chip-icon">⚠</span>
        <span className="ghost-chip-text">{copy.label}</span>
        <span className="ghost-chip-more mono dim">details ▸</span>
      </button>
    );
  }

  return (
    <div className={`ghost-banner ghost-kind-${kind}`}>
      <div className="ghost-banner-head">
        <span className="ghost-banner-icon">⚠</span>
        <div className="ghost-banner-title">{copy.label}</div>
        <button className="ghost-banner-toggle" onClick={() => setExpanded(false)}>
          Hide
        </button>
      </div>
      <div className="ghost-banner-body">
        <p>
          This session is flagged as a ghost. Its transcript is still in{" "}
          <code>~/.claude/projects/</code>.
        </p>
        <p className="mono dim">{copy.desc}</p>
      </div>
      {kind !== "empty" && (
        <div className="ghost-resume-block">
          <div className="ghost-resume-label mono dim caps">Resume command</div>
          <div className="ghost-resume-row">
            <code className="ghost-resume-code mono">{resumeCmd}</code>
            <button className="ghost-action primary" onClick={copyResume} disabled={busy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div className="mono dim ghost-resume-hint">
            Run in a terminal. <code>cd</code> matters — Claude CLI looks up sessions by current project slug.
          </div>
        </div>
      )}
      <div className="ghost-banner-actions">
        <button className="ghost-action" onClick={openTranscript} disabled={busy}>
          Reveal transcript
        </button>
        <button className="ghost-action danger" onClick={deletePermanently} disabled={busy}>
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </div>
  );
}

function OverviewTab({
  session,
  onFocusTools,
}: {
  session: Session;
  onFocusTools: (promptIdx: number, start: number, end: number) => void;
}) {
  const liveEmpty = session.live && (session.timeline?.length ?? 0) === 0;
  const [selectedPrompt, setSelectedPrompt] = useState<number | null>(null);
  const [promptView, setPromptView] = useState<"timeline" | "list">("timeline");
  const prompts = session.prompts ?? [];
  const toolSeq = session.toolSequence ?? [];
  const stats: PromptStats[] = session.turns && prompts.length > 0
    ? aggregateByPrompt(session.turns, session.model, prompts)
    : [];
  const totalCost = stats.reduce((a, s) => a + s.cost, 0);
  const rewriteFlagged = stats.filter((s) => s.cacheRewriteFlag);
  const rewriteCost = rewriteFlagged.reduce((a, s) => a + (s.cacheRewriteFlag?.cacheWriteCost ?? 0), 0);
  const maxPromptT = prompts.reduce((a, p) => Math.max(a, p.t), 0);
  const effDurationMs = Math.max(session.durationMs, maxPromptT, 1);
  const durationMin = effDurationMs / 60_000;

  const promptKinds = prompts.map((p) => classifyPrompt(p.text));
  const promptTools = prompts.map((p, i) => {
    const nextT = prompts[i + 1]?.t ?? Infinity;
    return toolSeq.filter((t) => t.t >= p.t && t.t < nextT).length;
  });

  if (liveEmpty) {
    return (
      <div className="live-empty">
        <div className="live-empty-dot"><span className="live-dot" /></div>
        <div className="live-empty-title">Session in progress</div>
        <div className="live-empty-text mono dim">
          Running for {Math.max(1, Math.round(durationMin))}m · summary and timeline populate on exit.
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <div className="section-title">
          <span>
            Summary <InfoDot title="Short description of what the session was about. Comes from /insights when it has analyzed the session; otherwise the first user prompt." />
          </span>
        </div>
        <p className="summary">{session.summary}</p>
      </div>

      <div>
        <div className="section-title">
          <span>User prompts</span>
          <div className="prompt-view-toggle">
            <button
              className={`tool-view-btn ${promptView === "timeline" ? "active" : ""}`}
              onClick={() => setPromptView("timeline")}
            >
              Timeline
            </button>
            <button
              className={`tool-view-btn ${promptView === "list" ? "active" : ""}`}
              onClick={() => setPromptView("list")}
            >
              List
            </button>
            <span className="dim mono tabular" style={{ marginLeft: 10 }}>
              {prompts.length} prompts
              {totalCost > 0 && ` · ${formatCost(totalCost)} total`}
              {rewriteFlagged.length > 0 && (
                <span style={{ color: "var(--c-amber)" }}>
                  {" · "}
                  {rewriteFlagged.length} idle-rewrite{rewriteFlagged.length > 1 ? "s" : ""} = {formatCost(rewriteCost)}
                </span>
              )}
            </span>
          </div>
        </div>
        {promptView === "timeline" && (
          stats.length === 0 ? (
            <div className="placeholder">No cost data captured.</div>
          ) : (() => {
            const maxCost = Math.max(0.0001, ...stats.map((s) => s.cost));
            return (
              <>
                <div className="prompt-chart-wrap">
                  <div className="prompt-chart-axis">
                    <span className="mono dim tabular">{formatCost(maxCost)}</span>
                    <span className="mono dim tabular">{formatCost(0)}</span>
                  </div>
                  <div className="prompt-chart">
                    {stats.map((s, i) => {
                      const heightPct = (s.cost / maxCost) * 100;
                      const isSelected = selectedPrompt === i;
                      const showGap = i > 0 && s.gapBeforeMs >= SESSION_IDLE_GAP_MS;
                      const tc = promptTools[i];
                      return (
                        <div key={i} className="prompt-bar-slot">
                          {showGap && (
                            <span
                              className={`prompt-gap-marker ${s.cacheRewriteFlag ? "warn" : ""}`}
                              title={`${formatDuration(s.gapBeforeMs)} idle gap before #${i + 1}`}
                              aria-hidden="true"
                            />
                          )}
                          <button
                            className={`prompt-bar kind-${KIND_CLS[s.dominantKind]} ${isSelected ? "pinned" : ""}`}
                            style={{ height: `${Math.max(1.5, heightPct)}%` }}
                            onClick={() => setSelectedPrompt((p) => (p === i ? null : i))}
                            aria-label={`Prompt ${i + 1}`}
                            aria-pressed={isSelected}
                            title={`#${i + 1} · ${formatCost(s.cost)}${showGap ? ` · ${formatDuration(s.gapBeforeMs)} idle before` : ""} · ${tc} tool${tc === 1 ? "" : "s"}`}
                          >
                            {tc > 0 && (
                              <span className="prompt-bar-turn-badge tabular">{tc}</span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="prompt-chart-x mono dim tabular">
                    <span>{stats[0] ? formatClockAt(session.startedAt, stats[0].t, { seconds: false }) : ""}</span>
                    <span>{stats[Math.floor(stats.length / 2)] ? formatClockAt(session.startedAt, stats[Math.floor(stats.length / 2)].t, { seconds: false }) : ""}</span>
                    <span>{stats[stats.length - 1] ? formatClockAt(session.startedAt, stats[stats.length - 1].t, { seconds: false }) : ""}</span>
                  </div>
                </div>
                <div className="prompt-legend mono dim" style={{ marginTop: 10 }}>
                  <span className="dim">dominant cost kind:</span>
                  <span className="prompt-legend-item"><span className="prompt-legend-swatch tokens-seg output" /> output</span>
                  <span className="prompt-legend-item"><span className="prompt-legend-swatch tokens-seg cache-read" /> cache read</span>
                  <span className="prompt-legend-item"><span className="prompt-legend-swatch tokens-seg cache-write" /> cache write</span>
                  <span className="prompt-legend-item"><span className="prompt-legend-swatch tokens-seg input" /> input</span>
                </div>
              </>
            );
          })()
        )}
        {promptView === "timeline" && selectedPrompt !== null && prompts[selectedPrompt] && (() => {
          const i = selectedPrompt;
          const p = prompts[i];
          const kind = promptKinds[i];
          const tc = promptTools[i];
          return (
            <div className="prompt-panel" style={{ marginTop: 12, border: "1px solid var(--c-hairline)", borderRadius: "var(--radius)" }}>
              <div className="prompt-panel-head">
                <span className="mono dim">
                  prompt #{i + 1} @ {formatClockAt(session.startedAt, p.t)}
                  {" · "}
                  <span style={{ color: PROMPT_KIND_COLOR[kind] }}>
                    {PROMPT_KIND_LABEL[kind]}
                  </span>
                  {tc > 0 && ` · ${tc} tools after`}
                  {stats[i] && (
                    <>
                      {" · "}
                      <span style={{ color: "var(--c-amber)" }}>{formatCost(stats[i].cost)}</span>
                      {totalCost > 0 && ` · ${((stats[i].cost / totalCost) * 100).toFixed(1)}% of session`}
                    </>
                  )}
                </span>
                <button className="prompt-panel-close" onClick={() => setSelectedPrompt(null)}>✕</button>
              </div>
              {stats[i] && (
                <PromptCostBreakdown s={stats[i]} model={session.model} />
              )}
              <pre className="prompt-panel-body">{p.text}</pre>
            </div>
          );
        })()}
        {promptView === "list" && (
          prompts.length === 0 ? (
            <div className="placeholder">No prompts captured.</div>
          ) : (
            <div className="prompt-list">
              <div className="prompt-row prompt-row-head mono dim caps">
                <span>#</span>
                <span>t</span>
                <span>cat</span>
                <span className="right">tools</span>
                <span className="right">$</span>
                <span />
                <span>preview</span>
                <span className="right">len</span>
              </div>
              {prompts.map((_, revIdx) => {
                const i = prompts.length - 1 - revIdx;
                const p = prompts[i];
                const kind = promptKinds[i];
                const tc = promptTools[i];
                const nextT = prompts[i + 1]?.t ?? Infinity;
                const selected = selectedPrompt === i;
                return (
                  <Fragment key={i}>
                  <div
                    className={`prompt-row ${selected ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    title={PROMPT_KIND_LABEL[kind]}
                    onClick={() => setSelectedPrompt(selected ? null : i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedPrompt(selected ? null : i);
                      }
                    }}
                  >
                    <span className="mono dim tabular">{String(i + 1).padStart(2, "0")}</span>
                    <span className="mono dim tabular">{formatClockAt(session.startedAt, p.t)}</span>
                    <span
                      className="prompt-row-cat"
                      style={{ background: PROMPT_KIND_COLOR[kind] }}
                      title={PROMPT_KIND_LABEL[kind]}
                    />
                    {tc > 0 ? (
                      <button
                        type="button"
                        className="mono tabular right prompt-row-tools-link"
                        title={`Jump to ${tc} tool call${tc === 1 ? "" : "s"} after this prompt`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onFocusTools(i, p.t, nextT);
                        }}
                      >
                        {tc} →
                      </button>
                    ) : (
                      <span className="mono tabular right dim">—</span>
                    )}
                    <span
                      className="mono tabular right"
                      style={{
                        color: stats[i] && stats[i].cost >= 0.5 ? "var(--c-amber)" : "var(--c-text-faint)",
                      }}
                    >
                      {stats[i] ? formatCost(stats[i].cost) : "—"}
                    </span>
                    <span
                      className="prompt-row-warn"
                      title={
                        stats[i]?.cacheRewriteFlag
                          ? `${formatDuration(stats[i].cacheRewriteFlag!.gapMs)} idle — cacheW ${formatCost(stats[i].cacheRewriteFlag!.cacheWriteCost)}`
                          : ""
                      }
                    >
                      {stats[i]?.cacheRewriteFlag ? "⚠" : ""}
                    </span>
                    <span className="prompt-row-preview mono">{p.preview}</span>
                    <span className="mono dim tabular right">{p.text.length}</span>
                  </div>
                  {selected && (
                    <div className="prompt-panel">
                      <div className="prompt-panel-head">
                        <span className="mono dim">
                          prompt #{i + 1} @ {formatClockAt(session.startedAt, p.t)}
                          {" · "}
                          <span style={{ color: PROMPT_KIND_COLOR[kind] }}>
                            {PROMPT_KIND_LABEL[kind]}
                          </span>
                          {tc > 0 && ` · ${tc} tools after`}
                          {stats[i] && (
                            <>
                              {" · "}
                              <span style={{ color: "var(--c-amber)" }}>{formatCost(stats[i].cost)}</span>
                              {totalCost > 0 && ` · ${((stats[i].cost / totalCost) * 100).toFixed(1)}% of session`}
                            </>
                          )}
                        </span>
                        <button className="prompt-panel-close" onClick={() => setSelectedPrompt(null)}>✕</button>
                      </div>
                      {stats[i] && (
                        <PromptCostBreakdown s={stats[i]} model={session.model} />
                      )}
                      <pre className="prompt-panel-body">{p.text}</pre>
                    </div>
                  )}
                  </Fragment>
                );
              })}
            </div>
          )
        )}
      </div>

      {session.frictions.length > 0 ? (
        <div>
          <div className="section-title">
            <span>Frictions</span>
            <span className="dim mono" title="LLM-flagged friction points. Count is real; on-timeline positions are approximate.">
              {session.frictions.length} · ⓘ LLM
            </span>
          </div>
          <div className="friction-list">
            {session.frictions.map((f, i) => (
              <div key={i} className="friction-item">
                <span className="dot" />
                <div>
                  <div className="kind">{f.kind.replace(/_/g, " ")}</div>
                  <div className="detail-text">{f.detail}</div>
                </div>
                <span className="at tabular">{(f.at * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        session.outcome === "unknown" || session.outcome === "in_progress" ? (
          <div className="clean-row dim">Frictions not analyzed yet · run /insights in Claude Code</div>
        ) : (
          <div className="clean-row">
            <span style={{ color: "var(--c-green)" }}>✓</span> Clean session · no friction detected
          </div>
        )
      )}
    </>
  );
}

function ToolsTab({
  session,
  focus,
  onClearFocus,
}: {
  session: Session;
  focus: { promptIdx: number; start: number; end: number } | null;
  onClearFocus: () => void;
}) {
  const [view, setView] = useState<"sequence" | "summary">("sequence");
  const sortedTools = (Object.entries(session.toolCounts) as Array<[ToolName, number]>)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  const maxTool = Math.max(...sortedTools.map(([, v]) => v), 1);
  const total = sortedTools.reduce((a, [, v]) => a + v, 0);
  const allSequence = session.toolSequence ?? [];
  const filtered = focus
    ? allSequence.filter((s) => s.t >= focus.start && s.t < focus.end)
    : allSequence;
  const sequence = [...filtered].reverse();

  return (
    <div className="tools-tab">
      <div className="section-title">
        <span>
          Tool calls <InfoDot title="Every tool Claude invoked during the session (Read, Edit, Bash, Grep, Glob, Write, Agent, etc.). Sequence view shows chronological calls with their result size; Summary view shows aggregate counts per tool. Click a row to expand the result preview." />
        </span>
        <div className="tool-view-toggle">
          <button
            className={`tool-view-btn ${view === "sequence" ? "active" : ""}`}
            onClick={() => setView("sequence")}
          >
            Sequence
          </button>
          <button
            className={`tool-view-btn ${view === "summary" ? "active" : ""}`}
            onClick={() => setView("summary")}
          >
            Summary
          </button>
          <span className="dim mono tabular" style={{ marginLeft: 10 }}>
            {focus ? `${sequence.length} of ${total}` : `${total} total`}
          </span>
        </div>
      </div>
      {focus && (
        <div className="tools-focus-chip mono">
          <span>
            Showing tools after prompt <strong>#{focus.promptIdx + 1}</strong>
            <span className="dim">
              {" "}· {formatClockAt(session.startedAt, focus.start)}
              {focus.end !== Infinity && ` → ${formatClockAt(session.startedAt, focus.end)}`}
            </span>
          </span>
          <button className="tools-focus-clear" onClick={onClearFocus} aria-label="Show all tools">
            show all ✕
          </button>
        </div>
      )}
      {view === "summary" && (
        <div className="tool-list">
          {sortedTools.map(([name, count]) => (
            <div key={name} className="tool-row">
              <span className="tool-name mono" title={name}>{name}</span>
              <div className="tool-meter">
                <div className="tool-meter-fill" style={{ width: `${(count / maxTool) * 100}%` }} />
              </div>
              <span className="tool-count tabular mono">{count}</span>
            </div>
          ))}
        </div>
      )}
      {view === "sequence" && (
        sequence.length === 0 ? (
          <div className="placeholder">
            No tool sequence available. Summary view shows aggregated counts.
          </div>
        ) : (
          <div className="tool-sequence">
            {sequence.map((s, i) => {
              const isLastPending =
                session.live &&
                i === 0 &&
                !s.result;
              return (
                <ToolSeqRow
                  key={i}
                  entry={s}
                  startedAt={session.startedAt}
                  pending={isLastPending}
                />
              );
            })}
            {sequence.length >= 300 && (
              <div className="mono dim" style={{ padding: "8px 10px", fontSize: 11 }}>
                (older tool calls truncated — showing first 300 captured)
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function ToolSeqRow({
  entry,
  startedAt,
  pending,
}: {
  entry: NonNullable<Session["toolSequence"]>[number];
  startedAt: string;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasResult = !!entry.result;
  const hasFull = !!entry.full;
  const expandable = hasResult || hasFull;
  const resultOneLine = entry.result?.text.replace(/\s+/g, " ").trim() ?? "";
  return (
    <div className={`tool-seq-row ${expandable ? "has-result" : ""} ${open ? "open" : ""} ${pending ? "pending" : ""}`}>
      <button
        className="tool-seq-main"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        aria-label={expandable ? (open ? "Collapse tool details" : "Expand tool details") : undefined}
      >
        <span className="tool-seq-time mono dim tabular">{formatClockAt(startedAt, entry.t)}</span>
        <span className="tool-seq-name mono">
          {entry.tool}
          {entry.result?.bytes != null && entry.result.bytes > 0 && (
            <span className={`result-size-chip mono tabular ${
              entry.result.bytes > 30_000 ? "hot" : entry.result.bytes > 8_000 ? "warm" : ""
            }`}>
              {formatBytes(entry.result.bytes)}
            </span>
          )}
        </span>
        <span className="tool-seq-preview mono dim">{entry.preview}</span>
        {pending && <span className="tool-seq-pending mono" aria-label="Running">▶ running</span>}
        {expandable && <span className="tool-seq-toggle mono dim">{open ? "▾" : "▸"}</span>}
      </button>
      {open && (
        <pre className="tool-seq-command mono">{entry.full ?? entry.preview}</pre>
      )}
      {hasResult && open && (
        <pre className={`tool-seq-result mono ${entry.result!.isError ? "is-error" : ""}`}>
          {entry.result!.text}
          {entry.result!.truncated && <span className="dim"> …</span>}
        </pre>
      )}
      {hasResult && !open && (
        <div className="tool-seq-result-hint mono dim">
          → {resultOneLine.slice(0, 100)}{resultOneLine.length > 100 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

/** Cache writes at the 5-minute rate, except the 1-hour share (2x input) when known. */
function cacheWriteCost(p: ModelPrice, t: { cacheWrite: number; cacheWrite1h?: number }) {
  const oneHour = Math.min(t.cacheWrite, t.cacheWrite1h ?? 0);
  return ((t.cacheWrite - oneHour) * p.cacheWrite + oneHour * p.cacheWrite1h) / 1e6;
}

function costPerKind(model: string, tokens: Session["tokens"]) {
  const p = priceFor(model);
  return {
    input: (tokens.input / 1e6) * p.in,
    output: (tokens.output / 1e6) * p.out,
    cacheRead: (tokens.cacheRead / 1e6) * p.cacheRead,
    cacheWrite: cacheWriteCost(p, tokens),
  };
}

/** Per-kind cost priced turn by turn with each turn's model, so it adds up to costUsd. */
function sessionCostPerKind(session: Session) {
  if (!session.turns?.length) return costPerKind(session.model, session.tokens);
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const t of session.turns) {
    const c = costPerKind(t.model ?? session.model, t.tokens);
    out.input += c.input;
    out.output += c.output;
    out.cacheRead += c.cacheRead;
    out.cacheWrite += c.cacheWrite;
  }
  return out;
}

function hitColor(ratio: number): string {
  if (ratio >= 0.9) return "var(--c-green)";
  if (ratio >= 0.7) return "var(--c-cyan)";
  if (ratio >= 0.4) return "var(--c-amber)";
  return "var(--c-red)";
}

const ratio = (n: number) => `${Number(n.toFixed(3))}×`;

/** Token-kind explanations with this model's actual price ratios (scripts/models.mjs). */
function tokenInfo(model: string): Record<string, string> {
  const p = priceFor(model);
  const name = modelLabel(model);
  return {
    input: `Fresh input tokens billed at the full input rate ($${p.in}/MTok on ${name}): new prompts, context not yet cached.`,
    output: `Tokens Claude generates, billed at ${ratio(p.out / p.in)} the input rate on ${name}. Long assistant turns inflate this.`,
    cacheRead: `Tokens served from the prompt cache, billed at ${ratio(p.cacheRead / p.in)} the input rate on ${name}. High cache read = prior context reused efficiently.`,
    cacheWrite: `Tokens written to the prompt cache: ${ratio(p.cacheWrite / p.in)} the input rate for the 5-minute cache, ${ratio(p.cacheWrite1h / p.in)} for the 1-hour cache. Pays off on later cache reads.`,
  };
}

function InfoDot({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const POP_W = 300;
      let left = r.left;
      if (left + POP_W > window.innerWidth - 16) left = window.innerWidth - POP_W - 16;
      setPos({ top: r.bottom + 6, left });
    };
    updatePos();
    const onClick = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="info-dot"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-label="Show explanation"
      >ⓘ</button>
      {open && pos && (
        <div
          ref={popRef}
          className="info-popover"
          role="dialog"
          style={{ top: pos.top, left: pos.left }}
        >
          {title}
        </div>
      )}
    </>
  );
}

function TokensTab({ session }: { session: Session }) {
  const totalTokens =
    session.tokens.input +
    session.tokens.output +
    session.tokens.cacheRead +
    session.tokens.cacheWrite;

  const costs = sessionCostPerKind(session);
  const totalCost = session.costUsd;
  const baseline = session.baselineCostUsd ?? totalCost;
  const savings = Math.max(0, baseline - totalCost);
  const savingsPct = baseline > 0 ? (savings / baseline) * 100 : 0;

  const cacheHit = session.tokens.input + session.tokens.cacheRead > 0
    ? session.tokens.cacheRead / (session.tokens.input + session.tokens.cacheRead)
    : 0;
  const promptCount = session.prompts?.length ?? 0;
  const costPerPrompt = promptCount > 0 ? totalCost / promptCount : 0;

  type Kind = "input" | "output" | "cacheRead" | "cacheWrite";
  const rows: Array<{ key: Kind; label: string; cls: string; tokens: number; cost: number }> = [
    { key: "input", label: "input", cls: "input", tokens: session.tokens.input, cost: costs.input },
    { key: "output", label: "output", cls: "output", tokens: session.tokens.output, cost: costs.output },
    { key: "cacheRead", label: "cache read", cls: "cache-read", tokens: session.tokens.cacheRead, cost: costs.cacheRead },
    { key: "cacheWrite", label: "cache write", cls: "cache-write", tokens: session.tokens.cacheWrite, cost: costs.cacheWrite },
  ];

  const pct = (v: number, t: number) => (t > 0 ? (v / t) * 100 : 0);

  return (
    <>
      <div>
        <div className="section-title">
          <span>
            Tokens <InfoDot title="Raw token volume from assistant.usage in the transcript. Volume ≠ cost — cache tokens are cheap, output tokens cost several times input. See cost bar below." />
          </span>
          <span className="dim mono tabular">{formatTokens(totalTokens)} total</span>
        </div>
        <div className="tokens-bar" aria-label="Token volume">
          {rows.map((r) => (
            <div
              key={r.key}
              className={`tokens-seg ${r.cls}`}
              style={{ flex: r.tokens || 0.0001 }}
              title={`${r.label}: ${formatTokens(r.tokens)} (${pct(r.tokens, totalTokens).toFixed(1)}%)`}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">
          <span>
            Cost <InfoDot title="Anthropic public per-model pricing applied to each token kind. This bar shows where the money went — often dominated by output and cacheWrite even when cache reads dominate volume." />
          </span>
          <span className="dim mono tabular">{formatCost(totalCost)} actual</span>
        </div>
        <div className="tokens-bar" aria-label="Cost share">
          {rows.map((r) => (
            <div
              key={r.key}
              className={`tokens-seg ${r.cls}`}
              style={{ flex: r.cost || 0.0001 }}
              title={`${r.label}: ${formatCost(r.cost)} (${pct(r.cost, totalCost).toFixed(1)}%)`}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Breakdown</div>
        <div className="tokens-table">
          <div className="tokens-table-head mono dim caps">
            <span />
            <span>kind</span>
            <span className="tabular right">tokens</span>
            <span className="tabular right">vol %</span>
            <span className="tabular right">cost</span>
            <span className="tabular right">cost %</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="tokens-table-row">
              <span className={`swatch ${r.cls}`} />
              <span>
                {r.label} <InfoDot title={tokenInfo(session.model)[r.key]} />
              </span>
              <span className="tabular mono right">{formatTokens(r.tokens)}</span>
              <span className="tabular mono dim right">{pct(r.tokens, totalTokens).toFixed(1)}%</span>
              <span className="tabular mono right">{formatCost(r.cost)}</span>
              <span className="tabular mono dim right">{pct(r.cost, totalCost).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Efficiency</div>
        <div className="tokens-metrics">
          <div className="tokens-metric">
            <div className="tokens-metric-label mono caps dim">
              Cache hit <InfoDot title="cacheRead / (cacheRead + input). Higher = more of the input tokens were served from Anthropic's prompt cache rather than being billed fresh. Aim ≥ 90% for repeat-heavy sessions." />
            </div>
            <div className="tokens-metric-val tabular" style={{ color: hitColor(cacheHit) }}>
              {(cacheHit * 100).toFixed(1)}%
            </div>
            <div className="tokens-metric-sub mono dim">
              {formatTokens(session.tokens.cacheRead)} cached / {formatTokens(session.tokens.input + session.tokens.cacheRead)} total input
            </div>
          </div>
          <div className="tokens-metric">
            <div className="tokens-metric-label mono caps dim">
              Cache savings <InfoDot title="Delta between actual cost and a hypothetical baseline where every cached token had been billed as fresh input. Tells you what the prompt cache is worth for this session." />
            </div>
            <div className="tokens-metric-val tabular" style={{ color: savings > 0 ? "var(--c-green)" : "var(--c-text-faint)" }}>
              {formatCost(savings)}
            </div>
            <div className="tokens-metric-sub mono dim">
              {savingsPct.toFixed(0)}% off {formatCost(baseline)} baseline
            </div>
          </div>
          <div className="tokens-metric">
            <div className="tokens-metric-label mono caps dim">
              Per prompt <InfoDot title="Total session cost ÷ number of user prompts. Rough proxy for how heavy each user turn was. Inflated by tool-heavy turns and long assistant replies." />
            </div>
            <div className="tokens-metric-val tabular">
              {promptCount > 0 ? formatCost(costPerPrompt) : "—"}
            </div>
            <div className="tokens-metric-sub mono dim">
              {promptCount > 0 ? `${promptCount} user prompts` : "no prompts captured"}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="section-title">
          <span>
            Cost total <InfoDot title="Estimated cost computed from per-token public pricing for this session's model. Excludes batch-API discounts and any account-level negotiated rates." />
          </span>
        </div>
        <div className="cost-line">
          <span className="dim">estimated cost</span>
          <span
            className="tabular"
            style={{ color: "var(--c-amber)", fontWeight: 600 }}
            title={session.unpricedModels?.length ? estimateHint(session.unpricedModels) : undefined}
          >
            {session.unpricedModels?.length ? "~" : ""}{formatCost(totalCost)}
          </span>
        </div>
        {baseline > totalCost && (
          <div className="cost-line cost-line-sub">
            <span className="dim mono">
              without cache <InfoDot title="What this session would have cost if no prompt caching had applied — every cached token billed at full input rate." />
            </span>
            <span className="tabular mono dim" style={{ textDecoration: "line-through" }}>
              {formatCost(baseline)}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function turnCost(model: string, tokens: CostTokens) {
  return costOf(model, tokens);
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_TTL_EXTENDED_MS = 60 * 60_000;
const CACHE_REWRITE_SHARE_MIN = 0.4;
const CACHE_REWRITE_COST_MIN = 1.0;

type PromptStats = {
  promptIdx: number;
  t: number;
  endT: number;
  turnCount: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite5m: number; cacheWrite1h: number };
  cost: number;
  tools: string[];
  dominantKind: "input" | "output" | "cacheRead" | "cacheWrite";
  gapBeforeMs: number;
  turnDetails: Array<{
    t: number;
    gapBeforeMs: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
    tools: string[];
    inBytes: number;
    outBytes: number;
    inPreview: string;
    outPreview: string;
  }>;
  cacheRewriteFlag?: {
    severity: "warn" | "info";
    gapMs: number;
    cacheWriteCost: number;
    cacheWriteShare: number;
  };
};

function aggregateByPrompt(
  turns: NonNullable<Session["turns"]>,
  model: string,
  prompts: NonNullable<Session["prompts"]>,
): PromptStats[] {
  const stats: PromptStats[] = prompts.map((p, i) => ({
    promptIdx: i,
    t: p.t,
    endT: prompts[i + 1]?.t ?? Infinity,
    turnCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cost: 0,
    tools: [],
    dominantKind: "input",
    gapBeforeMs: 0,
    turnDetails: [],
  }));
  const lastTurnTByPrompt: number[] = prompts.map((p) => p.t);
  const prevTurnTByPrompt: number[] = prompts.map(() => -1);
  for (const tn of turns) {
    if (tn.promptIdx === undefined) continue;
    const s = stats[tn.promptIdx];
    if (!s) continue;
    s.turnCount++;
    s.tokens.input += tn.tokens.input;
    s.tokens.output += tn.tokens.output;
    s.tokens.cacheRead += tn.tokens.cacheRead;
    s.tokens.cacheWrite += tn.tokens.cacheWrite;
    s.tokens.cacheWrite5m += tn.tokens.cacheWrite5m ?? 0;
    s.tokens.cacheWrite1h += tn.tokens.cacheWrite1h ?? 0;
    s.cost += turnCost(tn.model ?? model, tn.tokens);
    for (const t of tn.tools) s.tools.push(t);
    const prevT = prevTurnTByPrompt[tn.promptIdx] >= 0 ? prevTurnTByPrompt[tn.promptIdx] : s.t;
    s.turnDetails.push({
      t: tn.t,
      gapBeforeMs: Math.max(0, tn.t - prevT),
      input: tn.tokens.input,
      output: tn.tokens.output,
      cacheRead: tn.tokens.cacheRead,
      cacheWrite: tn.tokens.cacheWrite,
      cacheWrite5m: tn.tokens.cacheWrite5m ?? 0,
      cacheWrite1h: tn.tokens.cacheWrite1h ?? 0,
      tools: tn.tools,
      inBytes: tn.inBytes ?? 0,
      outBytes: tn.outBytes ?? 0,
      inPreview: tn.inPreview ?? "",
      outPreview: tn.outPreview ?? "",
    });
    prevTurnTByPrompt[tn.promptIdx] = tn.t;
    if (tn.t > lastTurnTByPrompt[tn.promptIdx]) lastTurnTByPrompt[tn.promptIdx] = tn.t;
  }
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    const p = priceFor(model);
    const contrib = {
      input: (s.tokens.input / 1e6) * p.in,
      output: (s.tokens.output / 1e6) * p.out,
      cacheRead: (s.tokens.cacheRead / 1e6) * p.cacheRead,
      cacheWrite: cacheWriteCost(p, s.tokens),
    } as const;
    let max: PromptStats["dominantKind"] = "output";
    let maxV = -1;
    for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (contrib[k] > maxV) { maxV = contrib[k]; max = k; }
    }
    s.dominantKind = max;

    if (i > 0) {
      s.gapBeforeMs = Math.max(0, s.t - lastTurnTByPrompt[i - 1]);
      const cwShare = s.cost > 0 ? contrib.cacheWrite / s.cost : 0;
      if (
        s.gapBeforeMs >= CACHE_TTL_MS &&
        cwShare >= CACHE_REWRITE_SHARE_MIN &&
        s.cost >= CACHE_REWRITE_COST_MIN
      ) {
        s.cacheRewriteFlag = {
          severity: s.gapBeforeMs >= CACHE_TTL_EXTENDED_MS ? "warn" : "info",
          gapMs: s.gapBeforeMs,
          cacheWriteCost: contrib.cacheWrite,
          cacheWriteShare: cwShare,
        };
      }
    }
  }
  return stats;
}


const KIND_CLS: Record<PromptStats["dominantKind"], string> = {
  input: "input",
  output: "output",
  cacheRead: "cache-read",
  cacheWrite: "cache-write",
};

function PromptCostBreakdown({ s, model }: { s: PromptStats; model: string }) {
  const pr = priceFor(model);
  const rows: Array<{ key: "input" | "output" | "cacheRead" | "cacheWrite"; label: string; cls: string; val: number; cost: number }> = [
    { key: "input",      label: "input",  cls: "input",       val: s.tokens.input,      cost: (s.tokens.input / 1e6) * pr.in },
    { key: "output",     label: "output", cls: "output",      val: s.tokens.output,     cost: (s.tokens.output / 1e6) * pr.out },
    { key: "cacheRead",  label: "cacheR", cls: "cache-read",  val: s.tokens.cacheRead,  cost: (s.tokens.cacheRead / 1e6) * pr.cacheRead },
    { key: "cacheWrite", label: "cacheW", cls: "cache-write", val: s.tokens.cacheWrite, cost: cacheWriteCost(pr, s.tokens) },
  ];
  return (
    <div className="prompt-cost-panel-body">
      <div className="prompt-cost-panel-grid">
        {rows.map((r) => {
          const isDom = r.key === s.dominantKind;
          return (
            <div key={r.key} className={`prompt-cost-panel-cell ${isDom ? "dominant" : ""}`}>
              <span className={`swatch ${r.cls}`} />
              <span className="dim">{r.label}</span>
              <span className="tabular mono">{formatTokens(r.val)}</span>
              <span className="tabular mono prompt-cost-panel-cell-usd" title={`$${r.cost.toFixed(4)}`}>
                {formatCost(r.cost)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="prompt-cost-panel-note mono dim">
        dominant = highest $ cost, not highest token count (on {modelLabel(model)}, a cache write costs{" "}
        {ratio(pr.cacheWrite / pr.cacheRead)} a cache read).
      </div>
      {s.cacheRewriteFlag && (
        <div className={`prompt-cost-warn kind-${s.cacheRewriteFlag.severity}`}>
          <span className="prompt-cost-warn-icon">{s.cacheRewriteFlag.severity === "warn" ? "⚠" : "ℹ"}</span>
          <div>
            <div className="prompt-cost-warn-title">
              Cache rewritten after {formatDuration(s.cacheRewriteFlag.gapMs)} idle
              {" — cacheW cost "}
              <strong className="tabular">{formatCost(s.cacheRewriteFlag.cacheWriteCost)}</strong>
              {" ("}{(s.cacheRewriteFlag.cacheWriteShare * 100).toFixed(0)}% of this prompt).
            </div>
            <div className="prompt-cost-warn-detail">
              The prompt cache expires (5 min, or 1 h for the extended cache). Resuming after that re-uploads the context as a fresh
              cache write, {ratio(pr.cacheWrite / pr.cacheRead)} the price of a cache read on {modelLabel(model)}.
            </div>
            <div className="prompt-cost-warn-recommend">
              Avoid: <code>/clear</code> before unrelated work, or start a new session when prior context isn't needed.
            </div>
          </div>
        </div>
      )}
      {s.tokens.cacheWrite > 0 && (
        <div className="prompt-cost-cw-split mono dim">
          cacheW split:
          {" "}
          <span className="tabular">{formatTokens(s.tokens.cacheWrite1h)}</span> in 1h block
          {" · "}
          <span className="tabular">{formatTokens(s.tokens.cacheWrite5m)}</span> in 5m block
          {" "}
          <InfoDot title="Anthropic prompt cache has two TTL tiers. 1h block = system prompt, tools, memory (the long-lived prefix). 5m block = recent conversation. Writes to the 1h block usually mean the system block changed (new tool, hook, env var) or the 1h TTL expired. Writes to the 5m block are normal when conversation extends past the previous breakpoint or 5m idle elapsed." />
        </div>
      )}
      {s.turnDetails.length > 1 && (
        <TurnBreakdown details={s.turnDetails} />
      )}
    </div>
  );
}

function TurnBreakdown({ details }: { details: PromptStats["turnDetails"] }) {
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const cacheWTurns = details.filter((t) => t.cacheWrite > 0).length;
  const totalIn = details.reduce((a, d) => a + d.inBytes, 0);
  const totalOut = details.reduce((a, d) => a + d.outBytes, 0);
  return (
    <div className="turn-breakdown">
      <button
        type="button"
        className="turn-breakdown-toggle mono dim"
        onClick={() => setOpen((p) => !p)}
      >
        {open ? "▾" : "▸"} per-turn breakdown · {details.length} turns
        {cacheWTurns > 0 && `, ${cacheWTurns} with cacheW`}
        {totalIn + totalOut > 0 && ` · added ${formatBytes(totalIn)} in / ${formatBytes(totalOut)} out`}
      </button>
      {open && (
        <div className="turn-breakdown-table">
          <div className="turn-breakdown-head mono dim caps">
            <span>#</span>
            <span className="right">gap</span>
            <span className="right">inB</span>
            <span className="right">outB</span>
            <span className="right">cacheR</span>
            <span className="right">cacheW</span>
            <span className="right">1h</span>
            <span className="right">5m</span>
            <span>tools</span>
          </div>
          {details.map((d, i) => {
            const hasCw = d.cacheWrite > 0;
            const has1h = d.cacheWrite1h > 0;
            const isOpen = expandedIdx === i;
            return (
              <div key={i} className={`turn-breakdown-row-wrap ${isOpen ? "open" : ""}`}>
                <button
                  type="button"
                  className={`turn-breakdown-row mono ${hasCw ? "has-cw" : ""} ${isOpen ? "open" : ""}`}
                  title={has1h ? "1h block rewritten — system/tools/memory changed or 1h TTL expired" : "Click to see what was added this turn"}
                  onClick={() => setExpandedIdx((p) => (p === i ? null : i))}
                >
                  <span className="dim tabular">#{i + 1}</span>
                  <span className="dim tabular right">{d.gapBeforeMs > 0 ? formatDuration(d.gapBeforeMs) : "—"}</span>
                  <span className="tabular right">{formatBytes(d.inBytes)}</span>
                  <span className="tabular right">{formatBytes(d.outBytes)}</span>
                  <span className="tabular right">{formatTokens(d.cacheRead)}</span>
                  <span className={`tabular right ${hasCw ? "turn-cw-hot" : "dim"}`}>{formatTokens(d.cacheWrite)}</span>
                  <span className={`tabular right ${has1h ? "turn-cw-hot" : "dim"}`}>{formatTokens(d.cacheWrite1h)}</span>
                  <span className="tabular right dim">{formatTokens(d.cacheWrite5m)}</span>
                  <span className="dim turn-breakdown-tools">{d.tools.join(", ") || "—"}</span>
                </button>
                {isOpen && (
                  <div className="turn-breakdown-expand mono">
                    {d.inPreview && (
                      <div className="turn-expand-block">
                        <div className="turn-expand-label caps dim">added to context · {formatBytes(d.inBytes)}</div>
                        <div className="turn-expand-body">{d.inPreview}{d.inBytes > 200 ? "…" : ""}</div>
                      </div>
                    )}
                    {d.outPreview && (
                      <div className="turn-expand-block">
                        <div className="turn-expand-label caps dim">assistant output · {formatBytes(d.outBytes)} · in: {formatTokens(d.input)} tokens / out: {formatTokens(d.output)} tokens</div>
                        <div className="turn-expand-body">{d.outPreview}{d.outBytes > 240 ? "…" : ""}</div>
                      </div>
                    )}
                    {!d.inPreview && !d.outPreview && (
                      <div className="dim">No preview captured.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function FilesTab({ session }: { session: Session }) {
  const history = session.fileHistory ?? [];
  const [openHash, setOpenHash] = useState<string | null>(null);

  if (history.length === 0) {
    return (
      <div>
        <div className="section-title">
          <span>Files</span>
          <span className="dim mono tabular">{session.filesChanged} tracked · {session.commits} commits</span>
        </div>
        <div className="placeholder">
          No file history recorded for this session.
          <div className="mono dim" style={{ marginTop: 6 }}>
            Claude Code writes versions to <code>~/.claude/file-history/{"{sessionId}"}/</code> only when it edits files.
          </div>
        </div>
      </div>
    );
  }

  const totalVersions = history.reduce((a, f) => a + f.versions.length, 0);

  return (
    <div>
      <div className="section-title">
        <span>Files</span>
        <span className="dim mono tabular">{history.length} files · {totalVersions} versions</span>
      </div>
      <div className="file-list">
        {history.map((f) => (
          <FileEntry
            key={f.hash}
            sessionId={session.id}
            hash={f.hash}
            versions={f.versions}
            path={f.path}
            open={openHash === f.hash}
            onToggle={() => setOpenHash(openHash === f.hash ? null : f.hash)}
          />
        ))}
      </div>
    </div>
  );
}

function FileEntry({
  sessionId,
  hash,
  versions,
  path,
  open,
  onToggle,
}: {
  sessionId: string;
  hash: string;
  versions: number[];
  path?: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [contents, setContents] = useState<Record<number, string> | null>(null);
  const loading = open && contents === null;

  useEffect(() => {
    if (!open || contents) return;
    let cancel = false;
    (async () => {
      const out: Record<number, string> = {};
      for (const v of versions) {
        try {
          const r = await fetch(`/api/file-history/${sessionId}/${hash}@v${v}`);
          if (r.ok) out[v] = await r.text();
        } catch {
          /* skip */
        }
      }
      if (!cancel) {
        setContents(out);
      }
    })();
    return () => { cancel = true; };
  }, [open, sessionId, hash, versions, contents]);

  const firstPreview = contents?.[versions[0]]?.split("\n").find((l) => l.trim()) ?? "";

  const basename = path ? path.split("/").pop() ?? path : null;
  const dirPath = path && basename ? path.slice(0, -basename.length).replace(/\/$/, "") : null;

  return (
    <div className={`file-entry ${open ? "open" : ""}`}>
      <button className="file-head" onClick={onToggle} title={path ?? hash}>
        <span className="file-toggle mono dim">{open ? "▾" : "▸"}</span>
        {basename ? (
          <span className="file-name mono">{basename}</span>
        ) : (
          <span className="file-hash mono">{hash.slice(0, 12)}</span>
        )}
        <span className="file-versions mono dim">{versions.length} version{versions.length > 1 ? "s" : ""}</span>
        <span className="file-preview dim">
          {dirPath ? <span className="mono">{dirPath}</span> : firstPreview.slice(0, 80)}
        </span>
      </button>
      {open && (
        <div className="file-body">
          {loading && <div className="mono dim" style={{ padding: 10 }}>loading…</div>}
          {!loading && versions.length === 1 && (
            <div className="mono dim" style={{ padding: 10 }}>
              Single version. No diff to render.
              <pre className="file-raw">{(contents?.[versions[0]] ?? "").slice(0, 4000)}</pre>
            </div>
          )}
          {!loading && versions.length > 1 &&
            versions.slice(0, -1).map((v, i) => {
              const next = versions[i + 1];
              const a = contents?.[v] ?? "";
              const b = contents?.[next] ?? "";
              const patch = createPatch(`${hash}@v${next}`, a, b, `v${v}`, `v${next}`, { context: 2 });
              return <DiffBlock key={`${v}-${next}`} patch={patch} label={`v${v} → v${next}`} />;
            })}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ patch, label }: { patch: string; label: string }) {
  const lines = patch.split("\n").slice(4);
  return (
    <div className="diff-block">
      <div className="diff-label mono dim">{label}</div>
      <pre className="diff-body">
        {lines.map((l, i) => {
          const cls = l.startsWith("+") && !l.startsWith("+++") ? "add"
            : l.startsWith("-") && !l.startsWith("---") ? "del"
            : l.startsWith("@@") ? "hunk"
            : "ctx";
          return <span key={i} className={`diff-line ${cls}`}>{l + "\n"}</span>;
        })}
      </pre>
    </div>
  );
}
