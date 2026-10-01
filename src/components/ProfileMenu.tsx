import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../types";
import { activityStreak, levelOf } from "../utils/gamify";
import { formatTokens } from "../utils/format";
import { LimitsSection } from "./LimitsSection";
import { UnitSetting } from "./UnitSetting";
import { openDashboardTab } from "../utils/openTab";

const BUG_URL = "https://github.com/n-pizzetta/ccblackbox/issues/new/choose";

interface Props {
  allSessions: Session[];
  source: "real" | "mock";
  /** "20s ago", or empty before the first parse. */
  parsedAgo: string;
  reportStatus: { exists: boolean };
  onHelp: () => void;
}

/**
 * Top-bar profile chip (level, streak, data status) and its menu: progress,
 * shortcuts to Health and Rankings, display settings, data status and help.
 * Replaces the settings gear, the live-data chip, the report link and the ? button.
 */
export function ProfileMenu({ allSessions, source, parsedAgo, reportStatus, onHelp }: Props) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const level = useMemo(() => levelOf(allSessions), [allSessions]);
  const streak = useMemo(() => activityStreak(allSessions), [allSessions]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't let App's Escape handler close the session view as well.
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const openTab = (tab: "rankings" | "health") => {
    openDashboardTab(tab);
    setOpen(false);
  };

  const statusTitle = source === "real" ? `Live data${parsedAgo ? ` · parsed ${parsedAgo}` : ""}` : "Mock data: the local API is unreachable";

  return (
    <div className="profile">
      <button
        ref={btnRef}
        className={`profile-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Profile and settings · level ${level.level} · ${streak} day streak · ${statusTitle}`}
        title={statusTitle}
      >
        <span className={`profile-status ${source}`} aria-hidden="true" />
        <span className="profile-level mono">Lv {level.level}</span>
        {streak > 0 && <span className="profile-streak mono tabular">🔥 {streak}</span>}
      </button>

      {open && (
        <div ref={popRef} className="settings-popover profile-popover" role="dialog" aria-label="Profile and settings">
          <div className="profile-head">
            <div className="profile-head-row">
              <span className="profile-head-level">Lv {level.level} <span className="dim">{level.title}</span></span>
              <span className="mono tabular dim">🔥 {streak} day{streak === 1 ? "" : "s"}</span>
            </div>
            <span className="hero-track profile-track" aria-hidden="true">
              <span style={{ width: `${Math.round(level.progress * 100)}%` }} />
            </span>
            <span className="mono tabular dim profile-xp">{formatTokens(level.total)} / {formatTokens(level.nextAt)}</span>
          </div>

          <div className="profile-links">
            <button className="profile-link" onClick={() => openTab("health")}>
              <span>Health check</span><span aria-hidden="true">→</span>
            </button>
            <button className="profile-link" onClick={() => openTab("rankings")}>
              <span>Badges and rankings</span><span aria-hidden="true">→</span>
            </button>
          </div>

          <UnitSetting />

          <div className="settings-section">
            <div className="settings-label mono caps dim">Data</div>
            <div className="mono dim limits-status">
              <span style={{ color: source === "real" ? "var(--c-green)" : "var(--c-amber)" }}>
                ● {source === "real" ? "live data" : "mock data"}
              </span>
              {parsedAgo && <> · parsed {parsedAgo}</>}
            </div>
            {reportStatus.exists ? (
              <a className="profile-link" href="/usage-report.html" target="_blank" rel="noreferrer">
                <span>Insights report</span><span aria-hidden="true">↗</span>
              </a>
            ) : (
              <div className="mono dim limits-status">Insights report: run <code>/insights</code> in Claude Code.</div>
            )}
          </div>

          <LimitsSection />

          <div className="profile-foot">
            <button
              className="profile-link"
              onClick={() => {
                setOpen(false);
                onHelp();
              }}
            >
              <span>Keyboard shortcuts</span><kbd className="mono">?</kbd>
            </button>
            <a className="profile-link" href={BUG_URL} target="_blank" rel="noreferrer">
              <span>Report a bug</span><span aria-hidden="true">↗</span>
            </a>
            <div className="mono dim profile-local">100% local · nothing leaves your machine</div>
          </div>
        </div>
      )}
    </div>
  );
}
