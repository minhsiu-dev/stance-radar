import type {
  SparklinePoint,
  TrackRecordRun,
  TrackRecordState,
} from "@/lib/types";

/** A normalized point: value = the close indexed to a baseline of 100 —
 *  i.e. `(close / baseline) * 100`, so 100 = the window start, 120 = +20%,
 *  93 = -7%. Display code renders `value - 100` as a signed percentage; see
 *  `formatIndexedPercent` below. */
export interface IndexedPoint {
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

/** Compute the indexed series ourselves, not using lightweight-charts'
 *  PriceScaleMode.Percentage: that mode rebases each series against its own first
 *  visible point, and since one stock is split into multiple series (one per run),
 *  a segment starting mid-window would be zeroed to 0%, destroying the chart's
 *  relative geometry.
 *
 *  Values are indexed to 100 (`close / baseline * 100`) rather than plain percent
 *  change (`(close / baseline - 1) * 100`) so that every plotted value is strictly
 *  positive — closes and baselines are both positive by construction (see
 *  `baselineOf`), so their ratio never crosses zero. This matters because
 *  lightweight-charts v5's log scale is a *signed* log transform
 *  (`sign(v) * (log10(|v| + 0.0001) + 4)`) meant for data that straddles zero: fed
 *  ordinary percent-change values, any dip below the baseline (a negative value)
 *  gets thrown to the opposite side of that transform from the gains, producing
 *  chasms in the line and nonsense axis ticks. Indexing to 100 sidesteps that
 *  entirely. Do NOT "simplify" this back to percent change — that silently
 *  re-breaks log mode. The +100 offset is constant, so display code just
 *  subtracts it back out (`formatIndexedPercent`) and every downstream
 *  consumer (segment splitting, markers, sort order, hover) is unaffected by
 *  the shift since they only compare/order values, never test against zero. */
export function toIndexedSeries(
  closes: SparklinePoint[],
  baseline: number | null,
): IndexedPoint[] {
  if (baseline == null) return [];
  return closes.map((c) => ({
    time: c.date,
    value: (c.close / baseline) * 100,
  }));
}

/** Renders an indexed-to-100 value as the signed percent-change string the UI
 *  displays everywhere (price-scale ticks, line-end labels, crosshair tooltip):
 *  120 -> "+20.0%", 93 -> "-7.0%", 786 -> "+686.0%". Centralized here so every
 *  render site stays in lockstep with the indexing scheme above. */
export function formatIndexedPercent(value: number): string {
  const pct = value - 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export interface RunSegment {
  state: TrackRecordState;
  from: string;
  to: string | null;
  points: IndexedPoint[];
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
  points: IndexedPoint[],
  runs: TrackRecordRun[],
): RunSegment[] {
  const out: RunSegment[] = [];
  let carried: IndexedPoint | null = null;
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

/** The segment's own bars — the borrowed bridge point is excluded, since a marker
 *  anchored there would render before the date it belongs to. */
function ownPoints(segment: RunSegment): IndexedPoint[] {
  return segment.bridged ? segment.points.slice(1) : segment.points;
}

/** Place every marker that belongs to this segment onto a bar the segment actually
 *  plots.
 *
 *  A marker belongs to the run it falls inside, [from, to) — the same half-open
 *  interval `splitRuns` uses, so each marker lands in exactly one segment and is
 *  never drawn twice. Its date is then moved forward to the first bar at or after
 *  it, so a call published on a weekend or a market holiday shows up on the next
 *  session instead of vanishing. Markers with no bar at or after them within the
 *  segment are dropped: there is nothing to anchor them to, and lightweight-charts
 *  silently ignores markers whose time is absent from the series data.
 *
 *  Generic over the marker shape so this stays pure maths and testable without
 *  constructing full DTOs. */
export function snapMarkers<M extends { date: string }>(
  segment: RunSegment,
  markers: M[],
): { marker: M; time: string }[] {
  const own = ownPoints(segment);
  if (own.length === 0) return [];
  const out: { marker: M; time: string }[] = [];
  for (const marker of markers) {
    if (marker.date < segment.from) continue;
    if (segment.to !== null && marker.date >= segment.to) continue;
    const bar = own.find((p) => p.time >= marker.date);
    if (bar) out.push({ marker, time: bar.time });
  }
  return out;
}
