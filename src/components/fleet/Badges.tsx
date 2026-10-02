import type { Session } from "../../types";
import { useBadges, type BadgeFamily } from "../../utils/gamify";

interface Props {
  /** Only used to refetch after each re-parse: badges ignore the range and filters. */
  allSessions: Session[];
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number, unit: string | null) => `${compact.format(n)}${unit ? ` ${unit}` : ""}`;
const TIER_LABEL = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };

function tooltip(f: BadgeFamily): string {
  const lines = f.tiers.map((t) => {
    const done = t.unlockedAt ? ` ✓ ${new Date(t.unlockedAt).toLocaleDateString()}` : "";
    return `${TIER_LABEL[t.tier]}: ${fmt(t.target, f.unit)}${done}`;
  });
  return [`${f.name}: ${f.hint}`, f.window === "30d" ? "Rolling 30 days." : "", ...lines].filter(Boolean).join("\n");
}

function FamilyCard({ f }: { f: BadgeFamily }) {
  const best = f.tiers.filter((t) => t.unlockedAt).at(-1)?.tier ?? null;
  const next = f.tiers.find((t) => !t.unlockedAt);
  return (
    <div className={`badge ${best ? `unlocked tier-${best}` : "locked"}`} title={tooltip(f)}>
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

export function Badges({ allSessions }: Props) {
  const data = useBadges(allSessions);
  if (!data) return null;
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
        {families.map((f) => <FamilyCard key={f.id} f={f} />)}
      </div>
    </div>
  );
}
