import { adviseContext, fmtLeft, THRESHOLDS, type ContextAdvice, type ContextSnapshot } from "../../scripts/context-advice.mjs";
import { formatTokens } from "../utils/format";
import { useSnapshotMap } from "../utils/liveContext";
import { useNow } from "../utils/useNow";
import "../context.css";

const LEVEL_COLOR = { ok: "var(--c-green)", watch: "var(--c-amber)", act: "var(--c-red)" } as const;

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
  const r = 17;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, (pct ?? 0) / 100);
  return (
    <span className="ctx-ring">
      <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
        <circle cx="23" cy="23" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="5" />
        <circle
          cx="23" cy="23" r={r} fill="none" stroke={fillColor(pct)} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 23 23)"
        />
      </svg>
      <span className="ctx-ring-num tabular">{pct === null ? "—" : `${pct}%`}</span>
    </span>
  );
}

/** Full detail for one session: fill, cache state and countdown, cold-start cost, verdict and its reasons (always shown). */
export function ContextCard({ snap }: { snap: ContextSnapshot }) {
  const now = useNow(15_000);
  const a = adviseContext(snap, now);
  const idleMs = now - snap.capturedAt;
  const text = cacheText(a);
  return (
    <div className={`ctx-card level-${a.level}`}>
      <Ring pct={a.context.usedPct} />
      <div className="ctx-main">
        <div className="ctx-facts mono tabular">
          <span>
            Context {formatTokens(a.context.tokens)}
            {a.context.size ? ` / ${formatTokens(a.context.size)}` : ""} tokens
          </span>
          {text && (
            <span className={`ctx-cache mono tabular ${cacheTone(a)}`} title={a.cache.ttl ? `Prompt cache ttl ${a.cache.ttl}` : undefined}>
              <i />
              {text}
            </span>
          )}
          {a.cache.recacheTokens !== null && a.cache.state !== "unknown" && (
            <span className="dim" title="Tokens re-cached by the next message if the cache is cold">
              cold start ≈ {formatTokens(a.cache.recacheTokens)}
            </span>
          )}
          {idleMs > 60_000 && <span className="dim">updated {fmtLeft(idleMs / 1000)} ago</span>}
        </div>
        <ul className="ctx-reasons">
          {a.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
      <div className="ctx-verdict" style={{ "--vc": LEVEL_COLOR[a.level] } as React.CSSProperties}>
        <span className="ctx-verdict-dot" />
        <span className="ctx-verdict-label">{a.label}</span>
      </div>
    </div>
  );
}

/** Banner for the session view: renders nothing when the wrapper has no fresh snapshot for it. */
export function SessionContext({ sessionId }: { sessionId: string }) {
  const snap = useSnapshotMap().get(sessionId);
  return snap ? <ContextCard snap={snap} /> : null;
}
