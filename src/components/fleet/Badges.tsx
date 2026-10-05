import { TIER_LABEL, badgeKey, nextUp, type BadgeFamily, type BadgesPayload } from "../../utils/gamify";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number, unit: string | null) => `${compact.format(n)}${unit ? ` ${unit}` : ""}`;

function tooltip(f: BadgeFamily): string {
  const lines = f.tiers.map((t) => {
    const done = t.unlockedAt ? ` ✓ ${new Date(t.unlockedAt).toLocaleDateString()}` : "";
    return `${TIER_LABEL[t.tier]}: ${fmt(t.target, f.unit)}${done}`;
  });
  return [`${f.name}: ${f.hint}`, f.window === "30d" ? "Rolling 30 days." : "", ...lines].filter(Boolean).join("\n");
}

function FamilyCard({ f, fresh }: { f: BadgeFamily; fresh: boolean }) {
  const best = f.tiers.filter((t) => t.unlockedAt).at(-1)?.tier ?? null;
  const next = f.tiers.find((t) => !t.unlockedAt);
  return (
    <div className={`badge ${best ? `unlocked tier-${best}` : "locked"}${fresh ? " fresh" : ""}`} title={tooltip(f)}>
      {fresh && <span className="badge-new mono">new</span>}
      <span className="badge-icon" aria-hidden="true">{f.icon}</span>
      <span className="badge-name">{f.name}</span>
      <span className="badge-pips" aria-label={best ? `${TIER_LABEL[best]} reached` : "No tier yet"}>
        {f.tiers.map((t) => (
          <span key={t.tier} className={`badge-pip pip-${t.tier}${t.unlockedAt ? " on" : ""}`} />
        ))}
      </span>
      {next ? (
        <>
          <span className="badge-track" aria-hidden="true">
            <span style={{ width: `${(next.progress / next.target) * 100}%` }} />
          </span>
          <span className="badge-state mono tabular">
            {fmt(next.progress, null)}/{fmt(next.target, f.unit)}
          </span>
        </>
      ) : (
        <span className="badge-state mono">maxed</span>
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
  const families = data.families.filter((f) => f.available);
  const total = families.reduce((a, f) => a + f.tiers.length, 0);
  const unlocked = families.reduce((a, f) => a + f.tiers.filter((t) => t.unlockedAt).length, 0);
  const since = data.startedAt ? new Date(data.startedAt).toLocaleDateString() : null;

  return (
    <div className="fleet-block">
      <div className="section-title">
        <span>Badges</span>
        <span className="dim mono tabular" title="Only sessions started after ccblackbox first ran count. Ignores the range and filters.">
          {unlocked}/{total}{since ? ` · since ${since}` : ""}
        </span>
      </div>
      <div className="badges">
        {families.map((f) => (
          <FamilyCard key={f.id} f={f} fresh={f.tiers.some((t) => fresh.has(badgeKey(f, t)))} />
        ))}
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
            <span className="next-up-icon" aria-hidden="true">{f.icon}</span>
            <span className="next-up-main">
              <span className="next-up-name">
                {f.name} <span className="next-up-tier">→ {TIER_LABEL[t.tier]}</span>
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
        const title = `${f.name}: ${f.hint}${f.window === "30d" ? " (rolling 30 days)" : ""}`;
        return onOpen ? (
          <button key={f.id} className={`next-up-item tier-${t.tier}`} title={title} onClick={onOpen}>{body}</button>
        ) : (
          <div key={f.id} className={`next-up-item tier-${t.tier}`} title={title}>{body}</div>
        );
      })}
    </div>
  );
}
