import type { ReactNode } from "react";

export interface KpiItem {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Colors the value: a state, not decoration. */
  tone?: "amber" | "red" | "green";
  title?: string;
}

/** One headline figure: label, value, optional context line. The only KPI tile in the app. */
export function Kpi({ label, value, sub, tone, title }: KpiItem) {
  return (
    <div className="kpi" title={title}>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value tabular ${tone ?? ""}`}>{value}</span>
      {sub && <span className="kpi-sub mono">{sub}</span>}
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
