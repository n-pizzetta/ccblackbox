import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { TIER_LABEL, badgeKey, nextUp, type BadgeFamily, type BadgeTier, type BadgesPayload } from "../../utils/gamify";
import { BadgeGlyph } from "./BadgeGlyph";
import "../../badges.css";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number, unit: string | null) => `${compact.format(n)}${unit ? ` ${unit}` : ""}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Points the foil and glare at (x, y), from 0 to 1 across the card, and tilts the card toward it. */
function aim(card: HTMLElement, x: number, y: number) {
  card.style.setProperty("--mx", String(x * 100));
  card.style.setProperty("--my", String(y * 100));
  card.style.setProperty("--ry", `${(x - 0.5) * 16}deg`);
  card.style.setProperty("--rx", `${(0.5 - y) * 16}deg`);
}

/** A grid card tilts toward the mouse while hovered. */
function tilt(e: ReactPointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse" || reducedMotion()) return;
  const r = e.currentTarget.getBoundingClientRect();
  aim(e.currentTarget, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
}

function untilt(e: ReactPointerEvent<HTMLElement>) {
  for (const p of ["--mx", "--my", "--rx", "--ry"]) e.currentTarget.style.removeProperty(p);
}

/** The logo's session trace, faint behind the glyph. */
const trace = (
  <svg className="badge-trace" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 40H25L31 22 40 56 47 34 52 44H100" vectorEffect="non-scaling-stroke" />
  </svg>
);

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICON_PREV = icon("M15 6l-6 6 6 6");
const ICON_NEXT = icon("M9 6l6 6-6 6");
const ICON_CLOSE = icon("M6 6l12 12M18 6 6 18");

/** The card shows the best tier reached, or the first one face down. */
function shownTier(f: BadgeFamily) {
  const best = f.tiers.filter((t) => t.unlockedAt).at(-1) ?? null;
  return { best, shown: best ?? f.tiers[0] };
}

const cardClass = (best: BadgeTier | null) => `badge-card ${best ? `tier-${best.tier}` : "locked"}`;

/** A card's layers, in spans so the grid card can be a button. `lit`: face up, with its finish. */
function CardLayers({ f, t, lit, named = true }: { f: BadgeFamily; t: BadgeTier; lit: boolean; named?: boolean }) {
  return (
    <>
      <span className="badge-frame" />
      <span className="badge-face">
        <span className="badge-art">
          {lit && trace}
          <BadgeGlyph family={f.id} step={f.tiers.indexOf(t)} fallback={f.icon} />
          <span className="badge-corners" />
        </span>
        {named && <span className="badge-name">{t.name}</span>}
      </span>
      {lit && t.tier !== "bronze" && <span className="badge-foil" />}
      {lit && <span className="badge-glare" />}
    </>
  );
}

function FamilyCard({ f, fresh, onOpen }: { f: BadgeFamily; fresh: boolean; onOpen: () => void }) {
  const { best, shown } = shownTier(f);
  return (
    <div className="badge-slot">
      <button
        type="button"
        className={`${cardClass(best)}${fresh ? " fresh" : ""}`}
        data-badge={f.id}
        aria-label={`${f.name}: ${best ? `${best.name}, ${TIER_LABEL[best.tier]}` : "locked"}${fresh ? ", new" : ""}`}
        aria-haspopup="dialog"
        onPointerMove={tilt}
        onPointerLeave={untilt}
        onClick={onOpen}
      >
        <CardLayers f={f} t={shown} lit={best !== null} />
        {fresh && <span className="badge-new mono">new</span>}
      </button>
    </div>
  );
}

/**
 * Keeps the focused card alive: it follows the pointer anywhere over the stage and
 * sways slowly on its own otherwise, easing between the two. Still under reduced motion.
 */
function useLiveCard(stage: RefObject<HTMLElement | null>, card: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const area = stage.current;
    const el = card.current;
    if (!area || !el || reducedMotion()) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    let pointer: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      pointer = { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
    };
    const leave = () => { pointer = null; };
    const at = { x: 0.5, y: 0.4 };
    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      const s = now / 1000;
      const goal = pointer ?? { x: 0.5 + 0.3 * Math.sin(s * 0.7), y: 0.42 + 0.14 * Math.sin(s * 0.45 + 1) };
      const k = 1 - Math.exp(-(now - last) / (pointer ? 60 : 450));
      last = now;
      at.x += (goal.x - at.x) * k;
      at.y += (goal.y - at.y) * k;
      aim(el, at.x, at.y);
      raf = requestAnimationFrame(frame);
    });
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
    };
  }, [stage, card]);
}

/** Tab cycles through the dialog's controls instead of leaving it. */
function trapTab(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const items = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (items.length === 0 || (i === -1 && !e.shiftKey && panel.contains(document.activeElement))) return;
  if (e.shiftKey && i <= 0) {
    e.preventDefault();
    items[items.length - 1].focus();
  } else if (!e.shiftKey && (i === -1 || i === items.length - 1)) {
    e.preventDefault();
    items[0].focus();
  }
}

interface FocusProps {
  f: BadgeFamily;
  /** The card's place in the grid, from 1, and how many cards there are. */
  pos: number;
  count: number;
  fresh: Set<string>;
  /** When Marey first ran: badges only count sessions after it. */
  startedAt: string | null;
  onMove: (step: number) => void;
  onClose: () => void;
}

/** One badge brought forward: its card large and alive on the left, everything about it on the right. */
function BadgeFocus({ f, pos, count, fresh, startedAt, onMove, onClose }: FocusProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const { best, shown } = shownTier(f);
  const next = f.tiers.find((t) => !t.unlockedAt);
  const xpEarned = f.tiers.reduce((a, t) => a + (t.unlockedAt ? t.xp : 0), 0);
  const xpTotal = f.tiers.reduce((a, t) => a + t.xp, 0);

  // Modal: the page behind goes inert and focus starts on the dialog.
  useLayoutEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    panel.current?.focus({ preventScroll: true });
    return () => root?.removeAttribute("inert");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation(); // the app's shortcuts (1-5, ?) wait until the dialog closes
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        onMove(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key === "Tab") trapTab(e, panel.current);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onMove]);

  useLiveCard(stage, card);

  return createPortal(
    <div
      className="badge-focus-backdrop"
      // Closes on a click that starts and ends on the backdrop, not on a drag out of the panel.
      onPointerDown={(e) => { pressed.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressed.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        className={`badge-focus${best ? ` tier-${best.tier}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-status`}
        tabIndex={-1}
      >
        <button type="button" className="badge-focus-close" aria-label="Close" onClick={onClose}>{ICON_CLOSE}</button>
        <div className="badge-focus-body">
          <div ref={stage} className="badge-focus-stage">
            <div className="badge-slot">
              <div ref={card} className={cardClass(best)} aria-hidden="true">
                <CardLayers f={f} t={shown} lit={best !== null} />
              </div>
            </div>
            {count > 1 && (
              <div className="badge-focus-nav">
                <button type="button" aria-label="Previous badge" title="Previous badge (←)" onClick={() => onMove(-1)}>{ICON_PREV}</button>
                <span className="mono tabular">{pos} / {count}</span>
                <button type="button" aria-label="Next badge" title="Next badge (→)" onClick={() => onMove(1)}>{ICON_NEXT}</button>
              </div>
            )}
          </div>

          <div className="badge-focus-info">
            <header className="badge-focus-head">
              <h2 id={titleId}>{f.name}</h2>
              <p id={`${titleId}-status`} className="badge-focus-status">
                {best ? (
                  <><b>{best.name}</b> · {TIER_LABEL[best.tier]} · tier {f.tiers.indexOf(best) + 1} of {f.tiers.length}</>
                ) : (
                  <>Locked · face down until its first tier</>
                )}
              </p>
            </header>

            <section className="badge-focus-section">
              <h3>How to earn it</h3>
              <p className="badge-focus-hint">{f.hint}</p>
            </section>

            {next ? (
              <section className={`badge-focus-next tier-${next.tier}`}>
                <div className="badge-focus-next-head">
                  <span>{best ? "Next" : "To unlock"}: <b>{next.name}</b> <span className="dim">· {TIER_LABEL[next.tier]}</span></span>
                  <span className="mono tabular dim">{Math.floor((next.progress / next.target) * 100)}%</span>
                </div>
                <span className="badge-track" aria-hidden="true">
                  <span style={{ width: `${(next.progress / next.target) * 100}%` }} />
                </span>
                <span className="mono tabular dim">
                  {fmt(next.progress, null)} / {fmt(next.target, f.unit)} · {fmt(next.target - next.progress, f.unit)} to go
                </span>
              </section>
            ) : (
              <section className="badge-focus-next done">
                <div className="badge-focus-next-head"><span><b>Every tier earned</b></span></div>
              </section>
            )}

            <table className="badge-focus-tiers">
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">Target</th>
                  <th scope="col">Unlocked</th>
                </tr>
              </thead>
              <tbody>
                {f.tiers.map((t) => (
                  <tr key={t.tier} className={`tier-${t.tier}${t.unlockedAt ? " done" : ""}${t === best ? " current" : ""}`}>
                    <td>
                      <span className="badge-focus-tier">
                        <span className="badge-focus-swatch" aria-hidden="true" />
                        <span className="badge-focus-tier-text">
                          <span className="badge-focus-tier-name">
                            {t.name}
                            {fresh.has(badgeKey(f, t)) && <span className="badge-focus-new mono">new</span>}
                          </span>
                          <span className="badge-focus-tier-sub">{TIER_LABEL[t.tier]}{t.xp ? ` · +${t.xp} XP` : ""}</span>
                        </span>
                      </span>
                    </td>
                    <td className="mono tabular">{fmt(t.target, f.unit)}</td>
                    <td className="tabular">{t.unlockedAt ? day(t.unlockedAt) : "Locked"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="badge-focus-facts">
              <div>
                <dt>XP</dt>
                <dd>
                  {f.nudge
                    ? `+${xpEarned} of ${xpTotal} earned: a good-practice badge, each tier adds to your level`
                    : "None: a volume badge, it unlocks but only good-practice badges add XP"}
                </dd>
              </div>
              <div>
                <dt>Counts</dt>
                <dd>
                  {f.window === "30d"
                    ? "The last 30 days: progress drops as days slide out, an unlocked tier stays"
                    : startedAt ? `Sessions since ${day(startedAt)}` : "All sessions"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface Props {
  data: BadgesPayload;
  /** `family:tier` keys unlocked since the last visit: their cards are marked "new". */
  fresh: Set<string>;
}

export function Badges({ data, fresh }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);

  const families = data.families.filter((f) => f.available);
  const total = families.reduce((a, f) => a + f.tiers.length, 0);
  const unlocked = families.reduce((a, f) => a + f.tiers.filter((t) => t.unlockedAt).length, 0);
  const since = data.startedAt ? new Date(data.startedAt).toLocaleDateString() : null;
  const at = families.findIndex((f) => f.id === open);

  const close = () => {
    returnTo.current = open;
    setOpen(null);
  };
  const move = (step: number) => setOpen(families[(at + step + families.length) % families.length].id);

  // Focus goes back to the card of the badge last shown, which the arrows may have changed.
  useEffect(() => {
    if (open !== null || returnTo.current === null) return;
    grid.current?.querySelector<HTMLElement>(`[data-badge="${returnTo.current}"]`)?.focus();
    returnTo.current = null;
  }, [open]);

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Badges</span>
        <span className="dim mono tabular" title="Each tier counts as one badge. Only sessions started after Marey first ran count. Ignores the range and filters.">
          {unlocked}/{total}{since ? ` · since ${since}` : ""}
        </span>
      </div>
      <div className="badges" ref={grid}>
        {families.map((f) => (
          <FamilyCard
            key={f.id}
            f={f}
            fresh={f.tiers.some((t) => fresh.has(badgeKey(f, t)))}
            onOpen={() => setOpen(f.id)}
          />
        ))}
      </div>
      {at >= 0 && (
        <BadgeFocus f={families[at]} pos={at + 1} count={families.length} fresh={fresh} startedAt={data.startedAt} onMove={move} onClose={close} />
      )}
    </div>
  );
}

/** The next tier's card as a thumbnail, without its name, dimmed: a goal, not a win. Spans: it can sit in a button. */
function MiniCard({ f, t }: { f: BadgeFamily; t: BadgeTier }) {
  return (
    <span className="badge-slot badge-mini" aria-hidden="true">
      <span className={`badge-card tier-${t.tier}`}>
        <CardLayers f={f} t={t} lit named={false} />
      </span>
    </span>
  );
}

/** The locked tiers closest to unlocking among good-practice families: always a visible next goal. */
export function NextUp({ families, limit, onOpen }: { families: BadgeFamily[]; limit: number; onOpen?: () => void }) {
  const items = nextUp(families, limit);
  if (items.length === 0) return null;
  return (
    <div className="next-up">
      {items.map(({ family: f, tier: t }) => {
        const body = (
          <>
            <MiniCard f={f} t={t} />
            <span className="next-up-main">
              <span className="next-up-name">
                {f.name} <span className="next-up-tier">→ {t.name}</span>
              </span>
              <span className="badge-track" aria-hidden="true">
                <span style={{ width: `${(t.progress / t.target) * 100}%` }} />
              </span>
              <span className="next-up-state mono tabular">
                {fmt(t.progress, null)}/{fmt(t.target, f.unit)} · {fmt(t.target - t.progress, f.unit)} to go
              </span>
            </span>
          </>
        );
        const title = `${t.name} (${TIER_LABEL[t.tier]} ${f.name}): ${f.hint}${f.window === "30d" ? " (rolling 30 days)" : ""}`;
        return onOpen ? (
          <button key={f.id} className={`next-up-item tier-${t.tier}`} title={title} onClick={onOpen}>{body}</button>
        ) : (
          <div key={f.id} className={`next-up-item tier-${t.tier}`} title={title}>{body}</div>
        );
      })}
    </div>
  );
}
