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

/** Drop bars before the observation window's start. The backend's `closes`
 *  arrays are fetched from the earliest of (window start, every ranked
 *  ticker's true position-entry date) — reaching back further than the
 *  window whenever ANY of the top-10 tickers opened a position before it —
 *  so that `toExcessSeries` can price a position from its real entry even
 *  when that predates the window (see track_record.py's `price_start`).
 *  That extension is shared across every ticker's `closes` in the response,
 *  not just the one whose position is old, so `closes[0]` is frequently NOT
 *  the window start. The price-trend view promises "% change since the
 *  start of the window" (see the UI legend), so it must call this before
 *  `baselineOf`/`toIndexedSeries` — otherwise the baseline silently drifts
 *  to whatever the earliest-opened ranked position's entry date happens to
 *  be, which can be many months earlier and inflates the displayed percent
 *  far beyond the selected range (verified against the real channel: a 6-month
 *  window baselined at the unclipped array's first bar overstated one ticker's
 *  return by ~6x). The performance view does NOT use this — it needs the
 *  unclipped array so `toExcessSeries` can look up the true entry price. */
export function clipToWindow(
  closes: SparklinePoint[],
  start: string,
): SparklinePoint[] {
  return closes.filter((c) => c.date >= start);
}

/** Renders a percentage-point value with an explicit sign: 31.2 -> "+31.2%",
 *  -8.4 -> "-8.4%". Used directly by the call-anchored performance view, whose
 *  values are centred on zero. */
export function formatSignedPercent(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Renders an indexed-to-100 value as the signed percent-change string the
 *  price-trend view displays everywhere (price-scale ticks, line-end labels,
 *  crosshair tooltip): 120 -> "+20.0%", 93 -> "-7.0%", 786 -> "+686.0%".
 *  Centralized here so every render site stays in lockstep with the indexing
 *  scheme above. */
export function formatIndexedPercent(value: number): string {
  return formatSignedPercent(value - 100);
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

/** One point of the call-anchored performance view: percentage points of excess
 *  return over the benchmark, so 0 means "exactly matched the benchmark". Unlike
 *  IndexedPoint these are NOT indexed to 100 — they are centred on zero and go
 *  negative, which is why the two views must not share a price formatter (and
 *  why log mode is unavailable here: lightweight-charts' log scale is a
 *  signed-log transform that mangles zero-crossing data). */
export interface ExcessPoint {
  time: string; // "YYYY-MM-DD"
  value: number;
}

/** Stance-adjusted excess return over the benchmark for ONE position, measured
 *  from that position's own entry rather than the window start.
 *
 *      long:  (P_t/P_d - 1) - (B_t/B_d - 1)
 *      short: the negative of that — the channel said sell, so the stock falling
 *             counts as the call working out
 *
 *  The sign flip matches ticker_perf.py's stance adjustment, which is what makes
 *  this chart and the table below it read in the same units.
 *
 *  The anchor is `run.opened_at` (the true entry, possibly before the observation
 *  window) while the drawn range is [run.from, run.to) — so a position opened
 *  before the window starts mid-air, already carrying its accumulated P/L, which
 *  is correct. An entry landing on a non-trading day snaps forward to the next
 *  session. Bars with no matching benchmark session are skipped rather than
 *  treated as "the benchmark didn't move", which would invent excess return.
 *  Returns [] for an idle run (no position) or when either entry price is
 *  missing or non-positive. */
export function toExcessSeries(
  closes: SparklinePoint[],
  benchmarkCloses: SparklinePoint[],
  run: TrackRecordRun,
): ExcessPoint[] {
  if (run.state === "idle" || run.opened_at === null) return [];

  const anchor = run.opened_at;
  const entry = closes.find((c) => c.date >= anchor);
  const benchEntry = benchmarkCloses.find((c) => c.date >= anchor);
  if (!entry || !benchEntry || entry.close <= 0 || benchEntry.close <= 0) {
    return [];
  }

  const benchByDate = new Map(benchmarkCloses.map((c) => [c.date, c.close]));
  const direction = run.state === "sell" ? -1 : 1;
  const out: ExcessPoint[] = [];
  for (const bar of closes) {
    if (bar.date < run.from) continue;
    if (run.to !== null && bar.date >= run.to) continue;
    const bench = benchByDate.get(bar.date);
    if (bench === undefined || bench <= 0) continue;
    const stock = bar.close / entry.close - 1;
    const index = bench / benchEntry.close - 1;
    out.push({ time: bar.date, value: direction * (stock - index) * 100 });
  }
  return out;
}
