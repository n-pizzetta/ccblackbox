import { useEffect, useRef, useState } from "react";
import { LimitsSection } from "./LimitsSection";

interface Profile {
  name: string | null;
  email: string | null;
}

function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then(setProfile)
      .catch(() => { /* static export: no API */ });
  }, []);

  const name = profile?.name ?? "Settings";
  const email = profile?.email;

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
    <div className="user-profile">
      <button
        ref={btnRef}
        className={`user-profile-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={name}
      >
        <span className="user-avatar">{initials(name)}</span>
        <span className="user-profile-name">
          <span className="mono user-profile-name-text">{name}</span>
          {email && <span className="mono dim user-profile-email">{email}</span>}
        </span>
        <span className="user-profile-chev mono dim">⚙</span>
      </button>
      {open && (
        <div ref={popRef} className="user-profile-popover" role="dialog" aria-label="Settings">
          <div className="user-profile-popover-head mono caps dim">Settings</div>
          <LimitsSection />
        </div>
      )}
    </div>
  );
}
