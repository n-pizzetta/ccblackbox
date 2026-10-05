import type { Burn, WindowBreakdown } from "../../utils/windowBreakdown";
import { projectColor } from "../../utils/fleetStats";
import { formatCost, formatTokens } from "../../utils/format";

interface Props {
  /** Ranked by API value with a known limit, else by tokens: the same order as the lists below. */
  data: WindowBreakdown;
  /** "window": the current 5h window; "today": since midnight, shown while the window is idle. */
  scope: "window" | "today";
  /** Used share of the 5h limit (0-1) when the status line reports it. */
  limitPct: number | null;
  onSelectSession: (id: string) => void;
}

const pctText = (part: number) => {
  const p = part * 100;
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
};

/**
 * Concentration among several sessions: amber when one takes half, red (and
 * the alert line) when it takes three quarters of three or more. A lone
 * session is normal focused work and stays neutral.
 */
function heat(part: number, count: number): "mild" | "warm" | "hot" {
  if (count >= 3 && part >= 0.75) return "hot";
  if (count >= 2 && part >= 0.5) return "warm";
  return "mild";
}

/**
 * The biggest consumers at a glance: the heaviest session as a hero card with
 * the next two under it, then the leading prompt, project and tool. Shares use
 * the lists' unit: of the 5h limit (estimated by API value) when known, else
 * of the scope's tokens. The prompt and tool cards are in API value, like
 * their lists.
 */
export function HotSpots({ data, scope, limitPct, onSelectSession }: Props) {
  const limit = scope === "window" ? limitPct : null;
  const weight = (b: Burn) => (limit !== null ? b.cost : b.tokens);
  const total = weight(data.total);
  if (total <= 0 || data.sessions.length === 0) return null;
  /** Part of what the scope burned (0-1). */
  const part = (b: Burn) => weight(b) / total;
  /** What the numbers show: part of the 5h limit when known, else part of the scope. */
  const share = (b: Burn) => part(b) * (limit ?? 1);

  const [lead, ...rest] = data.sessions;
  const leadPart = part(lead);
  const level = heat(leadPart, data.sessions.length);
  const project = data.projects[0];
  const prompt = data.prompts[0];
  const tool = data.tools.reduce<(typeof data.tools)[number] | undefined>((best, t) => (!best || t.cost > best.cost ? t : best), undefined);
  const of = scope === "window" ? "of this window" : "of today";
  const unit = limit !== null ? "of the 5h limit (est.)" : of;
  const costPart = (cost: number) => (data.total.cost > 0 ? cost / data.total.cost : 0);
  const name = (s: typeof lead.s) => s.goal || s.project;
  const promptText = prompt ? prompt.session.prompts?.[prompt.stat.promptIdx]?.preview : undefined;

  return (
    <div className="hot-spots">
      <div className="hot-head">
        <span className="hot-title">{scope === "window" ? "What's eating the window" : "Today's biggest consumers"}</span>
        {level === "hot" && <span className="hot-alert">⚠ One session is using {pctText(leadPart)} {of}</span>}
      </div>
      <div className="hot-grid">
        <div className={`hot-hero heat-${level}`}>
          <button className="hot-hero-main" onClick={() => onSelectSession(lead.s.id)} title={name(lead.s)}>
            <span className="hot-label">#1 session</span>
            <span className="hot-hero-name">{name(lead.s)}</span>
            <span className="hot-meta mono tabular">
              {lead.s.project} · {formatTokens(lead.tokens)} · {formatCost(lead.cost)}
            </span>
            <span className="hot-share mono tabular">
              <b>{pctText(share(lead))}</b> {unit}
              {limit !== null && <span className="dim"> · {pctText(leadPart)} {of}</span>}
            </span>
            <span className="hot-bar" aria-hidden="true"><span style={{ width: `${share(lead) * 100}%` }} /></span>
          </button>
          {rest.length > 0 && (
            <span className="hot-runners mono tabular">
              {rest.slice(0, 2).map((r, i) => (
                <button key={r.s.id} onClick={() => onSelectSession(r.s.id)} title={name(r.s)}>
                  <span className="dim">#{i + 2}</span> <span className="hot-runner-name">{name(r.s)}</span> {pctText(share(r))}
                </button>
              ))}
            </span>
          )}
        </div>

        {prompt && (
          <button className="hot-card" onClick={() => onSelectSession(prompt.session.id)} title={promptText}>
            <span className="hot-label">Prompt</span>
            <span className="hot-card-name">{promptText || "—"}</span>
            <span className="hot-meta mono tabular">{formatCost(prompt.stat.cost)} · {prompt.stat.turnCount} turns</span>
            <span className="hot-bar" aria-hidden="true"><span style={{ width: `${costPart(prompt.stat.cost) * 100}%` }} /></span>
          </button>
        )}

        {project && (
          <div className="hot-card">
            <span className="hot-label">Project</span>
            <span className="hot-card-name">
              <span className="hot-swatch" style={{ background: projectColor(project.project) }} />
              {project.project}
            </span>
            <span className="hot-meta mono tabular">{pctText(share(project))} {unit}</span>
            <span className="hot-bar" aria-hidden="true"><span style={{ width: `${share(project) * 100}%` }} /></span>
          </div>
        )}

        {tool && (
          <div className="hot-card">
            <span className="hot-label">Tool</span>
            <span className="hot-card-name mono">{tool.tool}</span>
            <span className="hot-meta mono tabular">{formatCost(tool.cost)} · {tool.calls} calls</span>
            <span className="hot-bar" aria-hidden="true"><span style={{ width: `${costPart(tool.cost) * 100}%` }} /></span>
          </div>
        )}
      </div>
    </div>
  );
}
