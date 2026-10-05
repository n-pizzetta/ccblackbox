import { useEffect, useId, useState, type PointerEvent } from "react";
import { TIER_LABEL, badgeKey, nextUp, type BadgeFamily, type BadgeTier, type BadgesPayload } from "../../utils/gamify";
import { BadgeGlyph } from "./BadgeGlyph";
import "../../badges.css";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number, unit: string | null) => `${compact.format(n)}${unit ? ` ${unit}` : ""}`;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Tilts the card toward the pointer and moves the foil with it. */
function tilt(e: PointerEvent<HTMLDivElement>) {
  if (e.pointerType !== "mouse" || reducedMotion()) return;
  const card = e.currentTarget;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  card.style.setProperty("--mx", String(x * 100));
  card.style.setProperty("--my", String(y * 100));
  card.style.setProperty("--ry", `${(x - 0.5) * 16}deg`);
  card.style.setProperty("--rx", `${(0.5 - y) * 16}deg`);
}

function untilt(e: PointerEvent<HTMLDivElement>) {
  for (const p of ["--mx", "--my", "--rx", "--ry"]) e.currentTarget.style.removeProperty(p);
}

/** The logo's session trace, faint behind the glyph. */
const trace = (
  <svg className="badge-trace" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 40H25L31 22 40 56 47 34 52 44H100" vectorEffect="non-scaling-stroke" />
  </svg>
);

/** The card shows the best tier reached, or the first one face down. */
function shownTier(f: BadgeFamily) {
  const best = f.tiers.filter((t) => t.unlockedAt).at(-1) ?? null;
  return { best, shown: best ?? f.tiers[0] };
}

type Tip = { f: BadgeFamily; rect: DOMRect };

function FamilyCard({ f, fresh, tipId, onTip }: { f: BadgeFamily; fresh: boolean; tipId: string | undefined; onTip: (tip: Tip | null) => void }) {
  const { best, shown } = shownTier(f);
  const show = (el: HTMLElement) => onTip({ f, rect: el.getBoundingClientRect() });
  return (
    <div className="badge-slot">
      <div
        className={`badge-card ${best ? `tier-${best.tier}` : "locked"}${fresh ? " fresh" : ""}`}
        role="img"
        tabIndex={0}
        aria-label={best ? `${shown.name}: ${TIER_LABEL[best.tier]} ${f.name}` : `${f.name}: locked`}
        aria-describedby={tipId}
        onPointerMove={tilt}
        onPointerEnter={(e) => show(e.currentTarget)}
        onPointerLeave={(e) => { untilt(e); onTip(null); }}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => onTip(null)}
      >
        <div className="badge-frame" />
        <div className="badge-face">
          <div className="badge-art">
            {best && trace}
            <BadgeGlyph family={f.id} step={f.tiers.indexOf(shown)} fallback={f.icon} />
            <span className="badge-corners" />
          </div>
          <div className="badge-name">{shown.name}</div>
        </div>
        {best && best.tier !== "bronze" && <div className="badge-foil" />}
        {best && <div className="badge-glare" />}
        {fresh && <span className="badge-new mono">new</span>}
      </div>
    </div>
  );
}

/** Every tier with its target and unlock date, then progress toward the next one. */
function BadgeTip({ tip, id }: { tip: Tip; id: string }) {
  const { f, rect } = tip;
  const next = f.tiers.find((t) => !t.unlockedAt);
  // Below the card in the top half of the screen, above it in the bottom half; kept inside the viewport.
  const width = Math.min(272, window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const style = rect.top > window.innerHeight / 2 ? { left, bottom: window.innerHeight - rect.top + 8 } : { left, top: rect.bottom + 8 };
  return (
    <div className="badge-tip" id={id} role="tooltip" style={style}>
      <div className="badge-tip-name">{f.name}</div>
      <p className="badge-tip-hint">{f.hint}{f.window === "30d" ? " · rolling 30 days" : ""}</p>
      <ul className="badge-tip-tiers">
        {f.tiers.map((t) => (
          <li key={t.tier} className={`tier-${t.tier}${t.unlockedAt ? " done" : ""}`} title={TIER_LABEL[t.tier]}>
            <span className="badge-tip-dot" />
            <span>{t.name}</span>
            <span className="badge-tip-target mono tabular">{fmt(t.target, f.unit)}</span>
            <span className="badge-tip-date mono tabular">{t.unlockedAt ? new Date(t.unlockedAt).toLocaleDateString() : "–"}</span>
          </li>
        ))}
      </ul>
      {next ? (
        <div className={`badge-tip-next tier-${next.tier}`}>
          <span>Next: {next.name}</span>
          <span className="mono tabular">{fmt(next.progress, null)}/{fmt(next.target, f.unit)}</span>
          <span className="badge-track" aria-hidden="true">
            <span style={{ width: `${(next.progress / next.target) * 100}%` }} />
          </span>
        </div>
      ) : (
        <div className="badge-tip-next">Every tier earned</div>
      )}
    </div>
  );
}

interface Props {
  data: BadgesPayload;
  /** `family:tier` keys unlocked since the last visit: their cards are marked "new". */
  fresh: Set<string>;
}

export function Badges({ data, fresh }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipId = useId();
  // A fixed hover card would drift from its card on scroll: close it instead.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [tip]);

  const families = data.families.filter((f) => f.available);
  const total = families.reduce((a, f) => a + f.tiers.length, 0);
  const unlocked = families.reduce((a, f) => a + f.tiers.filter((t) => t.unlockedAt).length, 0);
  const since = data.startedAt ? new Date(data.startedAt).toLocaleDateString() : null;

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Badges</span>
        <span className="dim mono tabular" title="Each tier counts as one badge. Only sessions started after ccblackbox first ran count. Ignores the range and filters.">
          {unlocked}/{total}{since ? ` · since ${since}` : ""}
        </span>
      </div>
      <div className="badges">
        {families.map((f) => (
          <FamilyCard
            key={f.id}
            f={f}
            fresh={f.tiers.some((t) => fresh.has(badgeKey(f, t)))}
            tipId={tip?.f.id === f.id ? tipId : undefined}
            onTip={setTip}
          />
        ))}
      </div>
      {tip && <BadgeTip tip={tip} id={tipId} />}
    </div>
  );
}

/** The next tier's card as a thumbnail, without its name, dimmed: a goal, not a win. */
function MiniCard({ f, t }: { f: BadgeFamily; t: BadgeTier }) {
  return (
    <div className="badge-slot badge-mini" aria-hidden="true">
      <div className={`badge-card tier-${t.tier}`}>
        <div className="badge-frame" />
        <div className="badge-face">
          <div className="badge-art">
            {trace}
            <BadgeGlyph family={f.id} step={f.tiers.indexOf(t)} fallback={f.icon} />
            <span className="badge-corners" />
          </div>
        </div>
        {t.tier !== "bronze" && <div className="badge-foil" />}
        <div className="badge-glare" />
      </div>
    </div>
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
