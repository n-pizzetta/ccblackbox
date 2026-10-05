import { UNITS, setUnit, useUnit } from "../utils/units";

/** Settings row: which unit session lists and rankings lead with. */
export function UnitSetting() {
  const unit = useUnit();
  return (
    <div className="profile-row">
      <span className="profile-row-label">Usage unit</span>
      <div className="unit-toggle" role="group" aria-label="Usage unit">
        {UNITS.map((u) => (
          <button
            key={u.id}
            type="button"
            className={`unit-opt ${unit === u.id ? "active" : ""}`}
            aria-pressed={unit === u.id}
            title={u.hint}
            onClick={() => setUnit(u.id)}
          >
            {u.label}
          </button>
        ))}
      </div>
    </div>
  );
}
