import type { ReactNode } from "react";
import { keepFocus } from "../utils/keepFocus";

export interface KpiItem {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Colors the value: a state, not decoration. */
  tone?: "amber" | "red" | "green";
  title?: string;
  /** The tile opens where the figure is detailed (another tab). */
  onClick?: () => void;
}

/** One headline figure: label, value, optional context line. The only KPI tile in the app. */
export function Kpi({ label, value, sub, tone, title, onClick }: KpiItem) {
  const body = (
    <>
      <span className="kpi-label">
        {label}
        {onClick && <span className="kpi-go" aria-hidden="true"> →</span>}
      </span>
      <span className={`kpi-value tabular ${tone ?? ""}`}>{value}</span>
      {sub && <span className="kpi-sub mono">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="kpi kpi-link" title={title} onMouseDown={keepFocus} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="kpi" title={title}>
      {body}
    </div>
  );
}

/** Up to six tiles share one row; seven or eight wrap into two even rows. */
export function KpiRow({ items }: { items: KpiItem[] }) {
  const cols = items.length <= 6 ? items.length : Math.ceil(items.length / 2);
  return (
    <div className="kpi-row" style={{ "--kpi-cols": cols } as React.CSSProperties}>
      {items.map((k) => <Kpi key={k.label} {...k} />)}
    </div>
  );
}
