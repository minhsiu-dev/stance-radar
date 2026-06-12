import { describe, expect, it } from "vitest";
import { buildMarkers, snapToTradingDay } from "@/lib/markers";
import type { CandleDto, StanceRow } from "@/lib/types";

const DAYS = ["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"]; // 週四五一二

function candle(date: string): CandleDto {
  return { date, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };
}

function stance(videoId: string, publishedAt: string, s: StanceRow["stance"]): StanceRow {
  return {
    video_id: videoId, video_title: `title-${videoId}`,
    channel_id: "UC_x", channel_title: "頻道 X",
    published_at: publishedAt, stance: s, summary: "s",
  };
}

describe("snapToTradingDay", () => {
  it("keeps trading-day dates as-is", () => {
    expect(snapToTradingDay("2026-06-05T10:00:00+00:00", DAYS)).toBe("2026-06-05");
  });
  it("snaps weekend publish to next trading day", () => {
    expect(snapToTradingDay("2026-06-06T10:00:00+00:00", DAYS)).toBe("2026-06-08");
  });
  it("clamps dates after the last bar to the last bar", () => {
    expect(snapToTradingDay("2026-06-20T10:00:00+00:00", DAYS)).toBe("2026-06-09");
  });
  it("returns null before chart range (marker 不顯示)", () => {
    expect(snapToTradingDay("2026-06-01T10:00:00+00:00", DAYS)).toBeNull();
  });
});

describe("buildMarkers", () => {
  it("maps stances to styled markers sorted by time", () => {
    const candles = DAYS.map(candle);
    const markers = buildMarkers(
      [
        stance("v2", "2026-06-08T00:00:00+00:00", "sell"),
        stance("v1", "2026-06-04T00:00:00+00:00", "buy"),
        stance("v3", "2026-06-01T00:00:00+00:00", "neutral"), // 範圍外 → 略過
      ],
      candles,
    );
    expect(markers.map((m) => m.id)).toEqual(["v1", "v2"]);
    expect(markers[0]).toMatchObject({
      time: "2026-06-04", position: "belowBar", shape: "arrowUp",
    });
    expect(markers[1]).toMatchObject({
      time: "2026-06-08", position: "aboveBar", shape: "arrowDown",
    });
  });
});
