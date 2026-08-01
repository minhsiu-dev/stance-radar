import type {
  SparklinePoint,
  TrackRecordRun,
  TrackRecordState,
} from "@/lib/types";

/** A normalized point: value = % change relative to the window start. */
export interface PercentPoint {
  time: string; // "YYYY-MM-DD"
  value: number;
}

/** Baseline = first bar's close in the window. Returns null when there is nothing
 *  to draw (no bar, or first close is non-positive making the ratio meaningless).
 *  If a stock lists after the window start, use its own first bar as the baseline. */
export function baselineOf(closes: SparklinePoint[]): number | null {
  const first = closes[0];
  if (!first || first.close <= 0) return null;
  return first.close;
}

/** Compute percentages ourselves, not using lightweight-charts' PriceScaleMode.Percentage:
 *  that mode rebases each series against its own first visible point, and since one stock
 *  is split into multiple series (one per run), a segment starting mid-window would be
 *  zeroed to 0%, destroying the chart's relative geometry. */
export function toPercentSeries(
  closes: SparklinePoint[],
  baseline: number | null,
): PercentPoint[] {
  if (baseline == null) return [];
  return closes.map((c) => ({
    time: c.date,
    value: (c.close / baseline - 1) * 100,
  }));
}

export interface RunSegment {
  state: TrackRecordState;
  from: string;
  to: string | null;
  points: PercentPoint[];
  /** true = points[0] is borrowed from the previous segment for bridging and
   *  does not lie within [from, to). */
  bridged: boolean;
}

/** One run maps to one drawable line. The interval is half-open [from, to), and the
 *  last point of the previous segment is prepended to the front of this segment —
 *  this way adjacent segments share exactly one point and the line doesn't break,
 *  even when the boundary date is not a trading day (when a segment has no bar of
 *  its own, the borrowed point passes directly to the next segment). Segments with
 *  fewer than two points are dropped (lightweight-charts cannot draw them anyway). */
export function splitRuns(
  points: PercentPoint[],
  runs: TrackRecordRun[],
): RunSegment[] {
  const out: RunSegment[] = [];
  let carried: PercentPoint | null = null;
  for (const run of runs) {
    const own = points.filter(
      (p) => p.time >= run.from && (run.to === null || p.time < run.to),
    );
    const bridged = carried !== null;
    const merged = carried ? [carried, ...own] : own;
    if (own.length > 0) carried = own[own.length - 1];
    if (merged.length >= 2) {
      out.push({
        state: run.state,
        from: run.from,
        to: run.to,
        points: merged,
        bridged,
      });
    }
  }
  return out;
}

/** The time of the segment's own first bar — the marker should anchor here (the
 *  borrowed bridge point does not count, otherwise the inflection arrow would fall
 *  before the inflection date). Returns null when the segment has no bar of its own. */
export function markerTime(segment: RunSegment): string | null {
  return segment.points[segment.bridged ? 1 : 0]?.time ?? null;
}
