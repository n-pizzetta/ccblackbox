import { UNITS, setUnit, useUnit } from "../utils/units";

/** Settings row: which unit session lists and rankings lead with. */
export function UnitSetting() {
  const unit = useUnit();
  return (
    <div className="settings-section">
      <div className="settings-label mono caps dim">Usage unit</div>
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
      <div className="mono dim limits-status">
        {UNITS.find((u) => u.id === unit)?.hint} “% of window” will join once your limits history is calibrated.
      </div>
    </div>
  );
}
