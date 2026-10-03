import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["1 – 4", "Now · Sessions · Usage · Health"],
  ["↑ / k", "Previous session (while one is open)"],
  ["↓ / j", "Next session (while one is open)"],
  ["Esc", "Close the session / overlay"],
  ["?", "Toggle this help"],
];

const GLYPHS: Array<{ glyph: React.ReactNode; label: string; kind: string }> = [
  { glyph: <span className="glyph glyph-live" />, label: "Live", kind: "Claude Code: running process · Codex: task in progress" },
  { glyph: <span className="glyph glyph-ghost" />, label: "Ghost", kind: "Empty session, or its Claude Code process died (Claude Code only)" },
  { glyph: <span className="glyph glyph-friction">△</span>, label: "Friction", kind: "Friction points flagged by /insights" },
  { glyph: <span className="glyph glyph-failed" />, label: "Low outcome", kind: "Rated partially / not achieved by /insights" },
  { glyph: <span className="glyph glyph-lowquality">◐</span>, label: "Low quality", kind: "Context quality score < 70" },
];

const GLOSSARY: Array<[string, string]> = [
  ["Tokens", "Text units the model reads and writes. Input = what you send, output = what it generates, cache read/write = reused context (much cheaper)."],
  ["Cost", "Estimated at public API prices from token counts. It is not what a subscription plan bills you."],
  ["5h window", "Claude usage limits reset on a rolling five-hour window. The bar shows how much of it you have used."],
  ["Burn rate", "Tokens or dollars consumed per minute over the last 60 seconds."],
  ["Spike", "Your 5h limit jumped by 4 percentage points (amber) or 10 (red) within 5 minutes."],
  ["Ghost", "A session that ended without a clean shutdown, so its data may be incomplete."],
  ["Friction", "Moments where the session stalled, got corrected or went in circles, as flagged by an LLM."],
];

const DATA_SOURCES: Array<{ tag: string; label: string; examples: string }> = [
  { tag: "real", label: "Hard data", examples: "sessions count, duration, tokens, cost, tool sequence, prompts" },
  { tag: "llm", label: "LLM-assessed", examples: "outcome, summary, frictions (from /insights: ~/.claude/usage-data/facets/)" },
  { tag: "measured", label: "Measured quality", examples: "grade, score, waste signals (measured from the transcript)" },
];

export function HelpOverlay({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="help-backdrop" onClick={onClose} role="presentation">
      <div className="help-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Help">
        <div className="help-head">
          <h2>Help &amp; shortcuts</h2>
          <button className="help-close" onClick={onClose} aria-label="Close help">✕</button>
        </div>

        <section className="help-section">
          <h3>Keyboard</h3>
          <dl className="help-kbd-list">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="help-kbd-row">
                <dt><kbd>{k}</kbd></dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="help-section">
          <h3>Glyphs</h3>
          <dl className="help-glyph-list">
            {GLYPHS.map((g) => (
              <div key={g.label} className="help-glyph-row">
                <dt>{g.glyph}</dt>
                <dd>
                  <strong>{g.label}</strong>
                  <span className="dim mono"> — {g.kind}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="help-section">
          <h3>Glossary</h3>
          <dl className="help-glossary">
            {GLOSSARY.map(([term, def]) => (
              <div key={term} className="help-glossary-row">
                <dt>{term}</dt>
                <dd>{def}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="help-section">
          <h3>Data sources</h3>
          <dl className="help-source-list">
            {DATA_SOURCES.map((d) => (
              <div key={d.tag} className="help-source-row">
                <dt><span className={`help-tag help-tag-${d.tag}`}>{d.tag}</span></dt>
                <dd>
                  <strong>{d.label}</strong>
                  <div className="mono dim help-source-examples">{d.examples}</div>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="help-section help-footer">
          <span className="mono dim">
            ccblackbox · flight recorder for Claude Code &amp; Codex sessions
          </span>
        </section>
      </div>
    </div>
  );
}
