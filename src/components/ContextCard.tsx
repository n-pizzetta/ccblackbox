import { useId, useState } from "react";
import { adviseContext, fmtLeft, THRESHOLDS, type ContextAdvice, type ContextSnapshot } from "../../scripts/context-advice.mjs";
import { formatTokens } from "../utils/format";
import { useNow } from "../utils/useNow";
import "../context.css";

function fillColor(usedPct: number | null): string {
  if (usedPct === null) return "var(--c-text-faint)";
  if (usedPct >= THRESHOLDS.act) return "var(--c-red)";
  if (usedPct >= THRESHOLDS.watch) return "var(--c-amber)";
  return "var(--c-cyan)";
}

function cacheText(a: ContextAdvice): string | null {
  if (a.cache.state === "warm") return a.cache.secsLeft !== null ? `cache ${fmtLeft(a.cache.secsLeft)}` : "cache warm";
  if (a.cache.state === "cold") return "cache cold";
  return null;
}

function cacheTone(a: ContextAdvice): "warm" | "soon" | "cold" | "unknown" {
  if (a.cache.state === "warm") return a.cache.secsLeft !== null && a.cache.secsLeft < THRESHOLDS.expiringSoon ? "soon" : "warm";
  return a.cache.state;
}

/** Third line of a session row: context fill, cache countdown, and the verdict when it is not "keep going". */
export function ContextLine({ snap, now }: { snap: ContextSnapshot; now: number }) {
  const a = adviseContext(snap, now);
  const used = a.context.usedPct;
  const text = cacheText(a);
  return (
    <div className={`ctx-line level-${a.level}`} title={`${a.label}\n${a.reasons.join("\n")}`}>
      <span className="ctx-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, used ?? 0)}%`, background: fillColor(used) }} />
      </span>
      <span className="ctx-line-pct mono tabular">ctx {used === null ? "—" : `${used}%`}</span>
      {text && (
        <span className={`ctx-cache mono tabular ${cacheTone(a)}`}>
          <i />
          {text}
        </span>
      )}
      {a.level !== "ok" && <span className="ctx-line-hint">{a.label}</span>}
    </div>
  );
}

function Ring({ pct }: { pct: number | null }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, (pct ?? 0) / 100);
  return (
    <svg className="ctx-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="2.5" />
      <circle
        cx="9" cy="9" r={r} fill="none" stroke={fillColor(pct)} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

/**
 * Context part of the session view's status strip: fill, cache state and countdown, and the verdict.
 * The verdict pill discloses its reasons, the cold-start cost and the snapshot's age (also in its tooltip).
 * Renders the row and, when open, the reasons line, as siblings for the strip to lay out.
 */
export function ContextSummary({ snap }: { snap: ContextSnapshot }) {
  const now = useNow(15_000);
  const [open, setOpen] = useState(false);
  const reasonsId = useId();
  const a = adviseContext(snap, now);
  const idleMs = now - snap.capturedAt;
  const used = a.context.usedPct;
  const text = cacheText(a);
  const recache = a.cache.recacheTokens !== null && a.cache.state !== "unknown" ? formatTokens(a.cache.recacheTokens) : null;
  // once the cache is cold or about to expire, a reason already says what the next message re-caches
  const coldStart = recache && cacheTone(a) === "warm" ?`Cold start ≈ ${recache} tokens: what the next message re-caches once the cache is cold.` : null;
  const updated = idleMs > 60_000 ? `Updated ${fmtLeft(idleMs / 1000)} ago.` : null;
  const details = [...a.reasons, coldStart, updated].filter((s): s is string => !!s);
  const fill = `${formatTokens(a.context.tokens)}${a.context.size ? ` / ${formatTokens(a.context.size)}` : ""}`;
  return (
    <>
      <div className="status-context">
        <span className="status-fill tabular" title={`Context window used by the last turn: ${fill} tokens`}>
          <Ring pct={used} />
          <span className="status-fill-label">Context</span>
          <b>{used === null ? "—" : `${used}%`}</b>
          <span className="status-fill-tokens">{fill}</span>
        </span>
        {text && (
          <span
            className={`ctx-cache tabular ${cacheTone(a)}`}
            title={[a.cache.ttl ? `Prompt cache ttl ${a.cache.ttl}` : null, recache ? `Cold start ≈ ${recache} tokens` : null].filter(Boolean).join("\n") || undefined}
          >
            <i />
            {text}
          </span>
        )}
        <button
          className={`status-verdict level-${a.level}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={open ? reasonsId : undefined}
          title={`${a.label}\n${details.join("\n")}`}
        >
          <span className="status-verdict-dot" aria-hidden="true" />
          <span className="status-verdict-label">{a.label}</span>
          <svg className="status-verdict-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9.5l6 6 6-6" />
          </svg>
        </button>
      </div>
      {open && (
        <p className="status-reasons" id={reasonsId}>
          {/* the pill can be cut short on phones: the verdict is spelled out here */}
          <strong className="status-reasons-label">{a.label}. </strong>
          {details.map((r, i) => (
            <span key={r}>{i > 0 && <span className="status-sep"> · </span>}{r}</span>
          ))}
        </p>
      )}
    </>
  );
}
