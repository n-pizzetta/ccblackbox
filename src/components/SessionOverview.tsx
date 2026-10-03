import type { Session } from "../types";
import { costOf } from "../../scripts/models.mjs";
import { formatCost, formatDuration, formatTokens } from "../utils/format";
import { API_VALUE_HINT, freshTokens, useUnit } from "../utils/units";
import { KpiRow, type KpiItem } from "./Kpi";

export type DetailTab = "overview" | "tools" | "tokens" | "files";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Headline figures of a session, above the prompts: always four tiles, smaller counts as context. */
export function SessionKpis({ session }: { session: Session }) {
  const unit = useUnit();
  const toolCalls = Object.values(session.toolCounts ?? {}).reduce((a, n) => a + n, 0);
  const fresh = freshTokens(session.tokens);
  const tokensTile: KpiItem = {
    label: "Fresh tokens",
    value: formatTokens(fresh),
    sub: `+ ${formatTokens(session.tokens.cacheRead)} cached reads`,
    title: "Input + output + cache writes. Cached reads weigh far less.",
  };
  const costTile: KpiItem = {
    label: "API value",
    value: formatCost(session.costUsd),
    sub: session.prompts?.length ? `${formatCost(session.costUsd / session.prompts.length)} / prompt` : undefined,
    title: API_VALUE_HINT,
  };
  const activity = [
    plural(session.messages, "message"),
    session.filesChanged > 0 && plural(session.filesChanged, "file"),
    session.commits > 0 && plural(session.commits, "commit"),
    session.subAgents > 0 && plural(session.subAgents, "sub-agent"),
  ].filter(Boolean).join(" · ");

  return (
    <KpiRow
      items={[
        {
          label: "Active time",
          value: formatDuration(session.durationMs),
          sub: session.wallMs && session.wallMs > session.durationMs * 1.2 ? `${formatDuration(session.wallMs)} wall-clock` : "idle gaps excluded",
          title: "Idle gaps over 5 minutes are excluded",
        },
        // the chosen unit comes first
        ...(unit === "tokens" ? [tokensTile, costTile] : [costTile, tokensTile]),
        { label: "Tool calls", value: toolCalls, sub: activity },
      ]}
    />
  );
}

function PreviewHead({ title, meta, tab, onOpenTab }: { title: string; meta: string; tab: DetailTab; onOpenTab: (t: DetailTab) => void }) {
  return (
    <div className="preview-head">
      <span className="preview-title">{title}</span>
      <span className="preview-meta mono tabular">{meta}</span>
      <button className="preview-more" onClick={() => onOpenTab(tab)}>See all →</button>
    </div>
  );
}

const KINDS: Array<{ key: "output" | "cacheWrite" | "cacheRead" | "input"; cls: string; label: string }> = [
  { key: "output", cls: "output", label: "output" },
  { key: "cacheWrite", cls: "cache-write", label: "cache write" },
  { key: "cacheRead", cls: "cache-read", label: "cache read" },
  { key: "input", cls: "input", label: "input" },
];

/** Where the API value went, by token kind (priced with the session's model). */
function kindShares(session: Session): Array<{ cls: string; label: string; pct: number }> {
  const t = session.tokens;
  const cost = {
    output: costOf(session.model, { output: t.output }),
    cacheWrite: costOf(session.model, { cacheWrite: t.cacheWrite, cacheWrite1h: t.cacheWrite1h }),
    cacheRead: costOf(session.model, { cacheRead: t.cacheRead }),
    input: costOf(session.model, { input: t.input }),
  };
  const total = Object.values(cost).reduce((a, n) => a + n, 0);
  if (total <= 0) return [];
  return KINDS.map((k) => ({ cls: k.cls, label: k.label, pct: (cost[k.key] / total) * 100 }));
}

/** Small previews of the Tools, Tokens and Files tabs, so what lives there is visible from the overview. */
export function TabPreviews({ session, onOpenTab }: { session: Session; onOpenTab: (t: DetailTab) => void }) {
  const tools = Object.entries(session.toolCounts ?? {}).sort((a, b) => b[1] - a[1]);
  const toolTotal = tools.reduce((a, [, n]) => a + n, 0);
  const topTools = tools.slice(0, 5);
  const maxTool = topTools[0]?.[1] ?? 1;
  const shares = kindShares(session);
  const files = [...(session.fileHistory ?? [])].sort((a, b) => b.versions.length - a.versions.length);

  return (
    <>
      {toolTotal > 0 && (
        <div className="d-panel preview">
          <PreviewHead title="Tools" meta={`${toolTotal} calls`} tab="tools" onOpenTab={onOpenTab} />
          <div className="preview-bars">
            {topTools.map(([name, n]) => (
              <div key={name} className="preview-bar-row">
                <span className="mono preview-bar-name">{name}</span>
                <span className="preview-bar-track"><span style={{ width: `${(n / maxTool) * 100}%` }} /></span>
                <span className="mono tabular preview-bar-n">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {shares.length > 0 && (
        <div className="d-panel preview">
          <PreviewHead title="Tokens" meta={`${formatTokens(freshTokens(session.tokens))} fresh`} tab="tokens" onOpenTab={onOpenTab} />
          <div className="preview-stack" role="img" aria-label="Share of API value by token kind">
            {shares.map((s) => (
              <span key={s.cls} className={`tokens-seg ${s.cls}`} style={{ width: `${s.pct}%` }} title={`${s.label} ${s.pct.toFixed(0)}%`} />
            ))}
          </div>
          <div className="preview-legend mono">
            {shares.filter((s) => s.pct >= 1).map((s) => (
              <span key={s.cls}><i className={`tokens-seg ${s.cls}`} />{s.label} {s.pct.toFixed(0)}%</span>
            ))}
          </div>
          <div className="preview-note mono dim">share of API value ({formatCost(session.costUsd)}) by token kind</div>
        </div>
      )}

      {(session.filesChanged > 0 || session.commits > 0 || files.length > 0) && (
        <div className="d-panel preview">
          <PreviewHead
            title="Files"
            meta={`${session.filesChanged} changed · ${session.commits} commit${session.commits === 1 ? "" : "s"}`}
            tab="files"
            onOpenTab={onOpenTab}
          />
          {files.length > 0 && (
            <ul className="preview-files mono">
              {files.slice(0, 3).map((f) => (
                <li key={f.hash} title={f.path}>
                  <span className="preview-file-name">{f.path ? f.path.split("/").slice(-2).join("/") : f.hash.slice(0, 8)}</span>
                  <span className="dim tabular">{f.versions.length} version{f.versions.length === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
