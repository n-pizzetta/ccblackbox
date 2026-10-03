import type { Session } from "../types";
import { PRODUCT_NAME } from "../utils/brand";
import { NAV_PAGES, type Page } from "../utils/pages";
import { LimitsPill } from "./LimitsGauge";
import { BrandMark } from "./BrandMark";
import { ParseErrors } from "./ParseErrors";
import { ProfileMenu } from "./ProfileMenu";

export interface ReportStatus {
  exists: boolean;
  mtime?: string;
}

interface Props {
  page: Page;
  onPageChange: (p: Page) => void;
  /** Sessions in the scope, shown on the Sessions tab. */
  sessionCount: number;
  /** Failing or warning health checks in the scope, shown on the Health tab. */
  healthIssues: number;
  allSessions: Session[];
  source: "real" | "mock";
  generatedAt?: string;
  reportStatus: ReportStatus;
  parseErrors?: string[];
  onHelp: () => void;
}

function formatAge(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

/** Brand, page navigation, usage limits and the profile menu: the one fixed bar of the app. */
export function AppHeader({
  page,
  onPageChange,
  sessionCount,
  healthIssues,
  allSessions,
  source,
  generatedAt,
  reportStatus,
  parseErrors,
  onHelp,
}: Props) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <BrandMark size={28} />
        <span className="app-brand-name">{PRODUCT_NAME}</span>
      </div>

      <nav className="app-nav" aria-label="Pages">
        {NAV_PAGES.map((p, i) => (
          <button
            key={p.id}
            className={`app-nav-item ${page === p.id ? "active" : ""}`}
            aria-current={page === p.id ? "page" : undefined}
            onClick={() => onPageChange(p.id)}
            title={`${p.label} (${i + 1})`}
          >
            {p.label}
            {p.id === "sessions" && <span className="app-nav-count mono tabular">{sessionCount}</span>}
            {p.id === "health" && healthIssues > 0 && (
              <span className="app-nav-count warn mono tabular" title={`${healthIssues} check${healthIssues > 1 ? "s" : ""} to look at`}>
                {healthIssues}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="app-header-right">
        <LimitsPill />
        {parseErrors && parseErrors.length > 0 && <ParseErrors errors={parseErrors} />}
        <ProfileMenu
          allSessions={allSessions}
          source={source}
          parsedAgo={formatAge(generatedAt)}
          reportStatus={reportStatus}
          onHelp={onHelp}
          onOpenPage={onPageChange}
        />
      </div>
    </header>
  );
}
