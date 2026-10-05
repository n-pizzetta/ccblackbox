import { useEffect, useRef, useState } from "react";
import type { Level, Streak } from "../utils/gamify";
import { useDocumentVisible } from "../utils/visibility";
import { LimitsSection } from "./LimitsSection";
import { UnitSetting } from "./UnitSetting";
import type { Page } from "../utils/pages";

const BUG_URL = "https://github.com/n-pizzetta/marey/issues/new/choose";

interface Props {
  /** Null without the local API (static export, mock data). */
  level: Level | null;
  streak: Streak | null;
  source: "real" | "mock";
  /** "20s ago", or empty before the first parse. */
  parsedAgo: string;
  reportStatus: { exists: boolean };
  onHelp: () => void;
  onOpenPage: (page: Page) => void;
}

/**
 * Top-bar profile chip (level, XP bar, streak, data status) and its menu:
 * progress, Health, display settings, data status and help. A "+N" floats
 * under the chip whenever XP comes in while the dashboard is open.
 */
export function ProfileMenu({ level, streak, source, parsedAgo, reportStatus, onHelp, onOpenPage }: Props) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const gain = useXpGain(level?.xp ?? null);

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

  const openPage = (page: Page) => {
    onOpenPage(page);
    setOpen(false);
  };

  const statusTitle = source === "real" ? `Live data${parsedAgo ? ` · parsed ${parsedAgo}` : ""}` : "Mock data: the local API is unreachable";
  const progress = level ? Math.round(((level.xp - level.from) / (level.next - level.from)) * 100) : 0;
  const streakText = streak && streak.current > 0
    ? `${streak.current}-day streak${streak.atRisk ? " · work today to keep it" : " · quiet weekends don't break it"}`
    : "";
  const label = [
    "Profile and settings",
    level ? `level ${level.level}, ${progress}% to the next` : "",
    streakText,
    statusTitle,
  ].filter(Boolean).join(" · ");

  return (
    <div className="profile">
      <button
        ref={btnRef}
        className={`profile-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={statusTitle}
      >
        <span className={`profile-status ${source}`} aria-hidden="true" />
        {level && (
          <>
            <span className="profile-level mono">Lv {level.level}</span>
            <span className="profile-xpbar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
          </>
        )}
        {streak && streak.current > 0 && (
          <span className={`profile-streak mono tabular ${streak.atRisk ? "at-risk" : ""}`} title={streakText}>🔥 {streak.current}</span>
        )}
      </button>
      {gain && <span key={gain.key} className="xp-gain mono" aria-hidden="true">+{gain.n} XP</span>}

      {open && (
        <div ref={popRef} className="settings-popover profile-popover" role="dialog" aria-label="Profile and settings">
          {level && (
            <button className="profile-head" onClick={() => openPage("badges")} title="Open Progress">
              <span className="profile-head-row">
                <span className="profile-head-level">Lv {level.level} <span className="dim">{level.title}</span></span>
                <span className="mono tabular dim profile-xp">+{level.today} XP today</span>
              </span>
              <span className="hero-track profile-track" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </span>
              <span className="profile-head-row mono tabular dim profile-xp">
                <span>{level.xp} / {level.next} XP</span>
                {streak && streak.current > 0 && (
                  <span className={streak.atRisk ? "at-risk" : ""} title={streakText}>
                    🔥 {streak.current}-day streak{streak.atRisk ? " · at risk" : ""}
                  </span>
                )}
              </span>
            </button>
          )}

          <div className="profile-links">
            <button className="profile-link" onClick={() => openPage("health")}>
              <span>Health check</span><span aria-hidden="true">→</span>
            </button>
            {reportStatus.exists ? (
              <a className="profile-link" href="/usage-report.html" target="_blank" rel="noreferrer">
                <span>Insights report</span><span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="profile-link disabled" title="Run /insights in Claude Code to generate it">
                <span>Insights report</span><span className="mono dim">/insights</span>
              </span>
            )}
          </div>

          <div className="profile-section">
            <UnitSetting />
            <div className="profile-row">
              <span className="profile-row-label">Data</span>
              <span className="profile-row-value mono">
                <span className={`profile-dot ${source === "real" ? "ok" : "warn"}`} aria-hidden="true" />
                {source === "real" ? (parsedAgo ? `live · ${parsedAgo}` : "live") : "mock"}
              </span>
            </div>
            <LimitsSection />
          </div>

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

/**
 * "+N" for 2.4 s whenever `xp` passes the highest value seen (a live session's
 * XP can dip and recover: that is not new XP); null otherwise. Waits while the
 * tab is hidden, so the gain shows when the user comes back.
 */
function useXpGain(xp: number | null): { n: number; key: number } | null {
  const best = useRef<number | null>(null);
  const visible = useDocumentVisible();
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null);
  useEffect(() => {
    if (xp === null || !visible) return;
    const before = best.current;
    if (before !== null && xp <= before) return;
    best.current = xp;
    if (before !== null) setGain({ n: xp - before, key: Date.now() });
  }, [xp, visible]);
  useEffect(() => {
    if (!gain) return;
    const id = setTimeout(() => setGain(null), 2400);
    return () => clearTimeout(id);
  }, [gain]);
  return gain;
}
