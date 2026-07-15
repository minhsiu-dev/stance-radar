import type { CandleDto, StanceRow, StanceValue } from "@/lib/types";

export interface ChartMarker {
  time: string;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  id: string; // video_id
}

const STANCE_MARKER: Record<
  StanceValue,
  Pick<ChartMarker, "position" | "color" | "shape">
> = {
  buy: { position: "belowBar", color: "#0ea5e9", shape: "arrowUp" },
  sell: { position: "aboveBar", color: "#f97316", shape: "arrowDown" },
  neutral: { position: "aboveBar", color: "#a1a1aa", shape: "circle" },
};

/** Shared stance hex palette (sky-500 / zinc-400 / orange-500). Keep in sync
 *  with StanceMiniBar's tailwind classes and StanceTrendChart's COLORS. */
export const STANCE_COLORS: Record<StanceValue, string> = {
  buy: "#0ea5e9",
  neutral: "#a1a1aa",
  sell: "#f97316",
};

/** Snap publish date to "the same day or the next trading day"; returns null if before the chart range, snaps to the last bar if after it. */
export function snapToTradingDay(
  publishedAt: string,
  tradingDays: string[],
): string | null {
  if (tradingDays.length === 0) return null;
  const date = publishedAt.slice(0, 10);
  if (date < tradingDays[0]) return null;
  for (const day of tradingDays) {
    if (day >= date) return day;
  }
  return tradingDays[tradingDays.length - 1];
}

export function buildMarkers(
  stances: StanceRow[],
  candles: CandleDto[],
): ChartMarker[] {
  const days = candles
    .map((c) => c.time)
    .filter((t): t is string => typeof t === "string");
  if (days.length === 0) return [];
  const markers: ChartMarker[] = [];
  for (const row of stances) {
    const time = snapToTradingDay(row.published_at, days);
    if (time == null) continue;
    markers.push({ time, id: row.video_id, ...STANCE_MARKER[row.stance] });
  }
  return markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/** Subset of stance rows matching the table's filters (stance AND channel).
 *  "all" means no constraint on that dimension.
 *
 *  Mirrors the predicate the mentions table applies to its rows. Note the chart's
 *  markers come from /stances (VideoStance rows) while the table's channel/stance
 *  options come from /mentions (which can use a majority-vote stance fallback when
 *  a video has mentions but no VideoStance) — so in that rare case the two can
 *  diverge and a filtered table row may have no corresponding chart marker. */
export function filterStances(
  stances: StanceRow[],
  stanceFilter: StanceValue | "all",
  channelFilter: string,
): StanceRow[] {
  return stances.filter(
    (s) =>
      (stanceFilter === "all" || s.stance === stanceFilter) &&
      (channelFilter === "all" || s.channel_id === channelFilter),
  );
}

export interface VideoDay {
  time: string; // trading day (YYYY-MM-DD)
  id: string; // video_id
}

export interface StanceHistogramPoint {
  time: string; // trading day (YYYY-MM-DD)
  buy: number;
  neutral: number;
  sell: number;
}

function tradingDays(candles: CandleDto[]): string[] {
  return candles
    .map((c) => c.time)
    .filter((t): t is string => typeof t === "string");
}

/** Video↔trading-day pairs for the chart's click/hover lookup maps. */
export function buildVideoDays(
  stances: StanceRow[],
  candles: CandleDto[],
): VideoDay[] {
  const days = tradingDays(candles);
  if (days.length === 0) return [];
  const out: VideoDay[] = [];
  for (const row of stances) {
    const time = snapToTradingDay(row.published_at, days);
    if (time == null) continue;
    out.push({ time, id: row.video_id });
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/** Per-day stance counts for the stacked histogram pane. */
export function buildStanceHistogram(
  stances: StanceRow[],
  candles: CandleDto[],
): StanceHistogramPoint[] {
  const days = tradingDays(candles);
  if (days.length === 0) return [];
  const byDay = new Map<string, StanceHistogramPoint>();
  for (const row of stances) {
    const time = snapToTradingDay(row.published_at, days);
    if (time == null) continue;
    const p = byDay.get(time) ?? { time, buy: 0, neutral: 0, sell: 0 };
    p[row.stance] += 1;
    byDay.set(time, p);
  }
  return [...byDay.values()].sort((a, b) =>
    a.time < b.time ? -1 : a.time > b.time ? 1 : 0,
  );
}
