import { useCallback, useEffect, useMemo, useState } from "react";
import { TIER_LABEL, unlockedKeys, type BadgeFamily, type BadgesPayload, type Tier } from "./gamify";
import { toastAchievement } from "./toast";
import { useDocumentVisible } from "./visibility";

const STORAGE_KEY = "ccblackbox:progress";

/** Unlocks already announced by a toast, unlocks already seen on the Progress page, last level announced. */
type Seen = { notified: string[]; viewed: string[]; level: number };

function readSeen(): Seen | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (v && Array.isArray(v.notified) && Array.isArray(v.viewed) && typeof v.level === "number") return v;
  } catch { /* ignore */ }
  return null;
}

function writeSeen(s: Seen) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function announceUnlocks(data: BadgesPayload, keys: string[], onOpen: () => void) {
  const byId = new Map<string, BadgeFamily>(data.families.map((f) => [f.id, f]));
  const items = keys.flatMap((k) => {
    const [id, name] = k.split(":") as [string, Tier];
    const f = byId.get(id);
    const t = f?.tiers.find((x) => x.tier === name);
    return f && t ? [{ f, t }] : [];
  });
  if (items.length === 0) return;
  const action = { label: "View", run: onOpen };
  const xp = items.reduce((a, { t }) => a + t.xp, 0);
  const xpText = xp > 0 ? `+${xp} XP · ` : "";
  if (items.length === 1) {
    const { f, t } = items[0];
    toastAchievement({ icon: f.icon, title: `${t.name} · ${TIER_LABEL[t.tier]}`, sub: `${xpText}${f.name}: ${f.hint}`, tone: t.tier, action });
    return;
  }
  const order: Tier[] = ["platinum", "gold", "silver", "bronze"];
  const best = order.find((tier) => items.some(({ t }) => t.tier === tier))!;
  toastAchievement({
    icon: items.slice(0, 3).map((i) => i.f.icon).join(""),
    title: `${items.length} badges unlocked`,
    sub: `${xpText}${items.map(({ t }) => `${t.name} (${TIER_LABEL[t.tier]})`).join(", ")}`,
    tone: best,
    action,
  });
}

/**
 * Turns badge payload changes into moments: a toast for new unlocks (one for
 * several at once), one for a level-up, and the unlocks not yet seen on the
 * Progress page. The first run records the current state silently, so what
 * was earned before (or in another browser) never floods in. Announcements
 * wait until the tab is visible, so a background tab doesn't use them up.
 */
export function useProgressEvents(data: BadgesPayload | null, onOpen: () => void) {
  // Bumped when the Progress page marks unlocks as seen; localStorage holds the state itself.
  const [version, setVersion] = useState(0);
  const visible = useDocumentVisible();
  const keys = useMemo(() => (data ? unlockedKeys(data.families) : []), [data]);

  useEffect(() => {
    // No level: the API hasn't parsed yet (empty payload) or isn't there.
    if (!data?.level || !visible) return;
    const level = data.level.level;
    // Re-read: another tab may have announced these already.
    const stored = readSeen();
    if (!stored) {
      const first = { notified: keys, viewed: keys, level };
      writeSeen(first);
      return;
    }
    const fresh = keys.filter((k) => !stored.notified.includes(k));
    if (fresh.length === 0 && level === stored.level) return;
    announceUnlocks(data, fresh, onOpen);
    if (level > stored.level) {
      const { title, xp, next } = data.level;
      toastAchievement({ icon: "⬆", title: `Level ${level} · ${title}`, sub: `${xp} XP · next level at ${next}`, tone: "level", action: { label: "View", run: onOpen } });
    }
    // The level can dip while a live session's score falls: never re-announce the same level.
    writeSeen({ ...stored, notified: [...new Set([...stored.notified, ...keys])], level: Math.max(level, stored.level) });
    // onOpen only navigates; a new identity each render must not re-announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, keys, visible]);

  // Before the first write (first run) everything counts as seen.
  const unseen = useMemo(() => {
    const viewed = new Set(readSeen()?.viewed ?? keys);
    return new Set(keys.filter((k) => !viewed.has(k)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, version]);

  const markViewed = useCallback(() => {
    const stored = readSeen();
    if (!stored) return;
    writeSeen({ ...stored, viewed: [...new Set([...stored.viewed, ...keys])] });
    setVersion((v) => v + 1);
  }, [keys]);

  return { unseen, markViewed };
}
