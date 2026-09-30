/**
 * Single source of truth for Claude model names and public API pricing,
 * shared by the parser (Node) and the dashboard (bundled by Vite).
 *
 * Prices are USD per million tokens (Anthropic first-party API rates).
 * Cache writes are derived from the input rate: 1.25x (5-minute TTL),
 * 2x (1-hour TTL). Cache reads vary by model, so they are listed.
 *
 * When Anthropic ships a model: add a row here. Unknown ids still get a
 * readable name (see normalizeModel) and the latest price of their family.
 */
export const MODELS = {
  "fable-5.1":  { label: "Fable 5.1",  in: 10, out: 50, cacheRead: 0.25 },
  "fable-5":    { label: "Fable 5",    in: 10, out: 50, cacheRead: 1 },
  "mythos-5.1": { label: "Mythos 5.1", in: 10, out: 50, cacheRead: 0.25 },
  "mythos-5":   { label: "Mythos 5",   in: 10, out: 50, cacheRead: 1 },
  "opus-5.5":   { label: "Opus 5.5",   in: 4,  out: 20, cacheRead: 0.2 },
  "opus-5":     { label: "Opus 5",     in: 5,  out: 25, cacheRead: 0.5 },
  "opus-4.8":   { label: "Opus 4.8",   in: 5,  out: 25, cacheRead: 0.5 },
  "opus-4.7":   { label: "Opus 4.7",   in: 5,  out: 25, cacheRead: 0.5 },
  "opus-4.6":   { label: "Opus 4.6",   in: 5,  out: 25, cacheRead: 0.5 },
  "sonnet-5.5": { label: "Sonnet 5.5", in: 2,  out: 10, cacheRead: 0.2 },
  "sonnet-5":   { label: "Sonnet 5",   in: 2,  out: 10, cacheRead: 0.2 },
  "sonnet-4.6": { label: "Sonnet 4.6", in: 3,  out: 15, cacheRead: 0.3 },
  "haiku-4.5":  { label: "Haiku 4.5",  in: 1,  out: 5,  cacheRead: 0.1 },
};

const BUILTIN = Object.fromEntries(Object.entries(MODELS).map(([k, v]) => [k, { ...v }]));

export const DEFAULT_MODEL = "opus-5.5";

/** What Claude Code's bare aliases (`opus`, `sonnet[1m]`, …) resolve to today. */
const FAMILY_LATEST = {
  fable: "fable-5.1",
  mythos: "mythos-5.1",
  opus: "opus-5.5",
  sonnet: "sonnet-5.5",
  haiku: "haiku-4.5",
};

/**
 * `claude-opus-5-5[1m]` → `opus-5.5`, `claude-haiku-4-5-20251001` → `haiku-4.5`,
 * `opus[1m]` → `opus-5.5`. Returns null for non-model markers like `<synthetic>`.
 */
export function normalizeModel(id) {
  if (!id || typeof id !== "string" || id.startsWith("<")) return null;
  const m = id.toLowerCase().replace(/^claude-/, "").replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
  if (FAMILY_LATEST[m]) return FAMILY_LATEST[m];
  const parts = m.match(/^([a-z]+)-(\d+)(?:-(\d+))?$/);
  if (!parts) return m;
  return parts[3] ? `${parts[1]}-${parts[2]}.${parts[3]}` : `${parts[1]}-${parts[2]}`;
}

/**
 * Replace user overrides (from ~/.claude/ccblackbox/models.json) on top of the
 * built-in table. Keys may be raw ids (`claude-opus-6`) or normalized
 * (`opus-6`); rows need numeric `in`, `out`, `cacheRead` ($/MTok) and an
 * optional `label`. Invalid rows are skipped. Returns the accepted rows.
 */
export function setModelOverrides(overrides) {
  for (const k of Object.keys(MODELS)) delete MODELS[k];
  for (const [k, v] of Object.entries(BUILTIN)) MODELS[k] = { ...v };
  const accepted = {};
  if (!overrides || typeof overrides !== "object") return accepted;
  for (const [key, v] of Object.entries(overrides)) {
    const id = normalizeModel(key);
    const valid = v && [v.in, v.out, v.cacheRead].every((n) => typeof n === "number" && n >= 0);
    if (!id || key.startsWith("$") || !valid) continue;
    const label = typeof v.label === "string" && v.label ? v.label : modelLabel(id);
    MODELS[id] = accepted[id] = { label, in: v.in, out: v.out, cacheRead: v.cacheRead };
  }
  return accepted;
}

/** False when the model has no row and its cost is an estimate (family fallback). */
export function isKnownModel(model) {
  return !!model && Object.hasOwn(MODELS, model);
}

/** Per-token-kind prices ($/MTok). `cacheWrite` is the 5-minute rate. */
export function priceFor(model) {
  const p = MODELS[model] ?? MODELS[FAMILY_LATEST[String(model).split("-")[0]]] ?? MODELS[DEFAULT_MODEL];
  return { in: p.in, out: p.out, cacheRead: p.cacheRead, cacheWrite: p.in * 1.25, cacheWrite1h: p.in * 2 };
}

export function modelLabel(model) {
  if (!model) return "unknown";
  if (MODELS[model]) return MODELS[model].label;
  const [family, version] = model.split("-");
  return version ? `${family[0].toUpperCase()}${family.slice(1)} ${version}` : model;
}

/** Family key (`opus`, `sonnet`, …) for colour coding. */
export function modelFamily(model) {
  return String(model ?? "").split("-")[0];
}

/**
 * Cost in USD. Uses the 5m / 1h cache-write split when the token bundle has
 * it (`cacheWrite5m`, `cacheWrite1h`); any remainder is billed at the 5m rate.
 */
export function costOf(model, t) {
  if (!t) return 0;
  const p = priceFor(model);
  const cw = t.cacheWrite ?? 0;
  const cw1h = Math.min(cw, t.cacheWrite1h ?? 0);
  return (
    ((t.input ?? 0) * p.in +
      (t.output ?? 0) * p.out +
      (t.cacheRead ?? 0) * p.cacheRead +
      (cw - cw1h) * p.cacheWrite +
      cw1h * p.cacheWrite1h) /
    1e6
  );
}
