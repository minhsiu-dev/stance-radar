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
