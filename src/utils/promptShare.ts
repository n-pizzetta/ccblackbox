/** Fresh tokens or API value: the unit a per-prompt weight is shown in (the app's usage unit). */
export type WeightUnit = "tokens" | "usd";

/**
 * Each prompt's weight in one unit, and its share of the session in that same unit: a prompt shown as
 * "24.8k fresh tokens" gets the share of the session's fresh tokens, not of its API value.
 */
export function promptWeights(
  stats: ReadonlyArray<{ fresh: number; cost: number }>,
  unit: WeightUnit,
): Array<{ value: number; share: number }> {
  const values = stats.map((s) => (unit === "tokens" ? s.fresh : s.cost));
  const total = values.reduce((a, v) => a + v, 0);
  return values.map((value) => ({ value, share: total > 0 ? value / total : 0 }));
}
