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
  buy: { position: "belowBar", color: "#22c55e", shape: "arrowUp" },
  sell: { position: "aboveBar", color: "#ef4444", shape: "arrowDown" },
  neutral: { position: "aboveBar", color: "#9ca3af", shape: "circle" },
};

/** 發布日貼齊「當天或下一個交易日」;早於圖表範圍回 null,晚於最後一根貼最後一根。 */
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
  const days = candles.map((c) => c.date);
  const markers: ChartMarker[] = [];
  for (const row of stances) {
    const time = snapToTradingDay(row.published_at, days);
    if (time == null) continue;
    markers.push({ time, id: row.video_id, ...STANCE_MARKER[row.stance] });
  }
  return markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}
