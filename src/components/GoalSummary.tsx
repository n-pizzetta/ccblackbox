import { useLayoutEffect, useRef, useState } from "react";

const SUMMARY_INFO = "Summary: what the session was about. From /insights when it has analyzed the session; otherwise the first user prompt.";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[\s.…]+$/, "").trim();

/**
 * Whether the summary says more than the title. Sessions are often named after their first prompt
 * while the summary is that same prompt cut longer, so a summary that only extends a long title
 * repeats it too.
 */
function addsInfo(summary: string, goal: string): boolean {
  const s = norm(summary);
  const g = norm(goal);
  if (!s || s === "no prompt captured") return false;
  return s !== g && !(g.length >= 100 && s.startsWith(g));
}

/** The session's summary as a quiet subtitle under its title: two lines at most, the rest behind "more". */
export function GoalSummary({ summary, goal }: { summary: string; goal: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const shown = addsInfo(summary, goal);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [summary, open, shown]);

  if (!shown) return null;
  return (
    <div className="goal-summary-row">
      <p ref={ref} className={`goal-summary ${open ? "open" : ""}`} title={SUMMARY_INFO}>
        {summary}
      </p>
      {(clamped || open) && (
        <button className="goal-summary-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}
