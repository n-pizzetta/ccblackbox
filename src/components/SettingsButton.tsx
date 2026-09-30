import { useEffect, useRef, useState } from "react";
import { LimitsSection } from "./LimitsSection";
import { useRateLimits } from "../utils/rateLimits";

/** Sidebar footer: opens the settings popover; the hint shows the 5h limit when connected. */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const limits = useRateLimits();
  const five = limits?.fiveHour;
  const hint = five ? `5h limit ${Math.round(five.usedPct)}%` : "Usage limits · not connected";

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings">
      <button
        ref={btnRef}
        className={`settings-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="settings-icon" aria-hidden="true">⚙</span>
        <span className="settings-label">
          <span className="settings-title">Settings</span>
          <span className="mono dim settings-hint">{hint}</span>
        </span>
      </button>
      {open && (
        <div ref={popRef} className="settings-popover" role="dialog" aria-label="Settings">
          <div className="settings-popover-head mono caps dim">Settings</div>
          <LimitsSection />
        </div>
      )}
    </div>
  );
}
