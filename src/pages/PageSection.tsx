import type { ReactNode } from "react";

/** A titled group of panels on a page: one heading style for every page. */
export function PageSection({ title, note, aside, children }: { title: string; note?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="page-section">
      <div className="page-section-head">
        <h2>{title}</h2>
        {note && <span className="page-section-note">{note}</span>}
        {aside && <div className="page-section-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
