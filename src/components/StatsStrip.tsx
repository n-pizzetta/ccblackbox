import type { Session } from "../types";
import { estimateHint, formatCost, formatDuration, formatTokens } from "../utils/format";
import { API_VALUE_HINT, freshTokens } from "../utils/units";
import { LimitsPill } from "./LimitsGauge";
import { BrandMark } from "./BrandMark";
import { ParseErrors } from "./ParseErrors";
import { ProfileMenu } from "./ProfileMenu";
import { RANGE_OPTIONS, rangeLabel, type Range } from "../utils/range";

export interface ReportStatus {
  exists: boolean;
  mtime?: string;
}

interface TopBarProps {
  allSessions: Session[];
  range: Range;
  onRangeChange: (r: Range) => void;
  source: "real" | "mock";
  generatedAt?: string;
  activeFilterCount: number;
  onClearFilters: () => void;
  onHelp: () => void;
  reportStatus: ReportStatus;
  parseErrors?: string[];
}

interface StatsRowProps {
  sessions: Session[];
  totalInRange: number;
  range: Range;
  activeFilterCount: number;
}

function rangeSpanDays(sessions: Session[], range: Range): number {
  if (range === "today") return 1;
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  if (sessions.length === 0) return 1;
  const earliest = Math.min(...sessions.map((s) => new Date(s.startedAt).getTime()));
  return Math.max(1, Math.ceil((Date.now() - earliest) / 86_400_000));
}

function formatAge(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function TopBar({
  allSessions,
  range,
  onRangeChange,
  source,
  generatedAt,
  activeFilterCount,
  onClearFilters,
  onHelp,
  reportStatus,
  parseErrors,
}: TopBarProps) {
  return (
    <div className="topline">
      <div className="topline-title">
        <BrandMark size={40} />
        <div className="brand-words">
          <h1 className="brand-title"><span className="brand-cc">CC</span>blackbox</h1>
          <span className="brand-tag">flight recorder for Claude Code &amp; Codex</span>
        </div>
      </div>
      <div className="topline-right">
        <LimitsPill />
        {parseErrors && parseErrors.length > 0 && <ParseErrors errors={parseErrors} />}
        {activeFilterCount >= 2 && (
          <button
            className="clear-filters topline-chip"
            onClick={onClearFilters}
            aria-label="Clear all filters"
          >
            clear filters ({activeFilterCount})
          </button>
        )}
        <div className="range-picker" role="tablist" aria-label="Time range">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={range === r.id}
              className={`range-opt ${range === r.id ? "active" : ""}`}
              onClick={() => onRangeChange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <ProfileMenu
          allSessions={allSessions}
          source={source}
          parsedAgo={formatAge(generatedAt)}
          reportStatus={reportStatus}
          onHelp={onHelp}
        />
      </div>
    </div>
  );
}

export function StatsRow({ sessions, totalInRange, range, activeFilterCount }: StatsRowProps) {
  const total = sessions.length;
  const isFiltered = activeFilterCount > 0;

  const totalDuration = sessions.reduce((a, s) => a + s.durationMs, 0);
  const avgDuration = total > 0 ? totalDuration / total : 0;

  const totalCost = sessions.reduce((a, s) => a + s.costUsd, 0);
  const avgCost = total > 0 ? totalCost / total : 0;
  const unpriced = new Set(sessions.flatMap((s) => s.unpricedModels ?? []));

  const totalFresh = sessions.reduce((a, s) => a + freshTokens(s.tokens), 0);
  const totalCached = sessions.reduce((a, s) => a + s.tokens.cacheRead, 0);
  const avgFresh = total > 0 ? totalFresh / total : 0;

  const spanDays = Math.max(1, rangeSpanDays(sessions, range));
  const perDay = total > 0 ? (total / spanDays).toFixed(1) : "0";

  if (total === 0) {
    return (
      <div className="empty-range">
        No sessions <span className="mono dim">{rangeLabel(range)}</span>.
        Try a broader range.
      </div>
    );
  }

  return (
    <div className="stats-row">
      <div className="stats-cell">
        <span className="stats-num tabular">{total}</span>
        <span className="stats-label">sessions</span>
        <span className="stats-sub mono">
          {isFiltered ? `filtered · ${total} of ${totalInRange}` : `${perDay} / day`}
        </span>
      </div>
      <div className="stats-sep" />
      <div className="stats-cell">
        <span className="stats-num tabular">{formatDuration(totalDuration)}</span>
        <span className="stats-label">total time</span>
        <span className="stats-sub mono">{formatDuration(avgDuration)} avg / session</span>
      </div>
      <div className="stats-sep" />
      <div className="stats-cell">
        <span className="stats-num tabular" title={unpriced.size ? estimateHint(unpriced) : undefined}>
          {unpriced.size ? "~" : ""}{formatCost(totalCost)}
        </span>
        <span className="stats-label" title={API_VALUE_HINT}>API value</span>
        <span className="stats-sub mono">{formatCost(avgCost)} avg / session</span>
      </div>
      <div className="stats-sep" />
      <div className="stats-cell">
        <span className="stats-num tabular" title="Input + output + cache writes. Cached reads are counted apart: they weigh far less.">{formatTokens(totalFresh)}</span>
        <span className="stats-label">fresh tokens</span>
        <span className="stats-sub mono" title={`${formatTokens(avgFresh)} fresh tokens avg / session`}>+ {formatTokens(totalCached)} cached reads</span>
      </div>
    </div>
  );
}
