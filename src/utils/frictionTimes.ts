export interface TimelineFriction {
  /** Session time the friction is drawn at. */
  t: number;
  kind: string;
  detail: string;
}

/**
 * Where frictions go on the session timeline. /insights gives no time, only a position (`at`, 0–1,
 * spread by the parser): it is placed at that fraction of the chart's width, so it never lands in a
 * shortened idle gap, and the chart and the Frictions card show the same, approximate, moment.
 *
 * @param axis session time → position on the chart's axis (gaps shortened), increasing; omitted, the
 *   axis is time itself
 */
export function frictionTimes(
  frictions: ReadonlyArray<{ at: number; kind: string; detail: string }>,
  start: number,
  end: number,
  axis: (t: number) => number = (t) => t - start,
): TimelineFriction[] {
  const axisEnd = axis(end);
  // the time whose position is that fraction of the axis
  const timeAt = (frac: number) => {
    if (frac <= 0) return start;
    if (frac >= 1) return end;
    const target = frac * axisEnd;
    let lo = start;
    let hi = end;
    for (let i = 0; i < 64 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2;
      if (axis(mid) < target) lo = mid;
      else hi = mid;
    }
    return Math.round(hi);
  };
  return frictions.map((f) => ({
    t: end > start ? timeAt(Math.min(1, Math.max(0, f.at))) : start,
    kind: f.kind,
    detail: f.detail,
  }));
}
