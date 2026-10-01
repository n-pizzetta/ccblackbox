import { useEffect, useRef, useState } from "react";
import { LimitsSection } from "./LimitsSection";
import { UnitSetting } from "./UnitSetting";

/** Top-bar gear: opens the settings popover (limits connection status). */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

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
        title="Settings"
        aria-label="Settings"
      >
        <span className="settings-icon" aria-hidden="true">⚙</span>
      </button>
      {open && (
        <div ref={popRef} className="settings-popover" role="dialog" aria-label="Settings">
          <div className="settings-popover-head mono caps dim">Settings</div>
          <UnitSetting />
          <LimitsSection />
        </div>
      )}
    </div>
  );
}
