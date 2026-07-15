import { describe, expect, it } from "vitest";
import {
  buildStanceHistogram, buildVideoDays,
  filterStances, snapToTradingDay, STANCE_COLORS,
} from "@/lib/markers";
import type { CandleDto, StanceRow } from "@/lib/types";

const DAYS = ["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"]; // Thu Fri Mon Tue

function candle(date: string): CandleDto {
  return { time: date, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };
}

function stance(videoId: string, publishedAt: string, s: StanceRow["stance"]): StanceRow {
  return {
    video_id: videoId, video_title: `title-${videoId}`,
    channel_id: "UC_x", channel_title: "Channel X",
    published_at: publishedAt, stance: s, summary: "s", confidence: null,
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
  it("returns null before chart range (marker not shown)", () => {
    expect(snapToTradingDay("2026-06-01T10:00:00+00:00", DAYS)).toBeNull();
  });
});

describe("filterStances", () => {
  const rows: StanceRow[] = [
    { video_id: "v1", video_title: "t1", channel_id: "cA", channel_title: "A",
      published_at: "2026-06-04T00:00:00Z", stance: "buy", summary: "s", confidence: null },
    { video_id: "v2", video_title: "t2", channel_id: "cB", channel_title: "B",
      published_at: "2026-06-05T00:00:00Z", stance: "sell", summary: "s", confidence: null },
    { video_id: "v3", video_title: "t3", channel_id: "cA", channel_title: "A",
      published_at: "2026-06-08T00:00:00Z", stance: "neutral", summary: "s", confidence: null },
  ];

  it("returns all rows when both filters are 'all'", () => {
    expect(filterStances(rows, "all", "all")).toHaveLength(3);
  });
  it("filters by stance", () => {
    expect(filterStances(rows, "buy", "all").map((r) => r.video_id)).toEqual(["v1"]);
  });
  it("filters by channel", () => {
    expect(filterStances(rows, "all", "cA").map((r) => r.video_id)).toEqual(["v1", "v3"]);
  });
  it("applies stance AND channel together", () => {
    expect(filterStances(rows, "neutral", "cA").map((r) => r.video_id)).toEqual(["v3"]);
  });
  it("returns [] when nothing matches", () => {
    expect(filterStances(rows, "buy", "cB")).toEqual([]);
  });
});

describe("STANCE_COLORS", () => {
  it("pins the shared stance palette (sky-500 / zinc-400 / orange-500)", () => {
    expect(STANCE_COLORS).toEqual({
      buy: "#0ea5e9",
      neutral: "#a1a1aa",
      sell: "#f97316",
    });
  });
});

describe("buildVideoDays", () => {
  it("maps stances to video/day pairs sorted by time, skipping out-of-range", () => {
    const candles = DAYS.map(candle);
    const days = buildVideoDays(
      [
        stance("v2", "2026-06-08T00:00:00+00:00", "sell"),
        stance("v1", "2026-06-04T00:00:00+00:00", "buy"),
        stance("v3", "2026-06-01T00:00:00+00:00", "neutral"), // before range → skipped
      ],
      candles,
    );
    expect(days).toEqual([
      { time: "2026-06-04", id: "v1" },
      { time: "2026-06-08", id: "v2" },
    ]);
  });

  it("returns [] for intraday (numeric-time) candles", () => {
    const intraday = [{ time: 1750000000 as unknown as string, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }];
    expect(buildVideoDays([stance("v1", "2026-06-04T00:00:00+00:00", "buy")], intraday as CandleDto[])).toEqual([]);
  });
});

describe("buildStanceHistogram", () => {
  it("groups snapped days and counts per stance, sorted by time", () => {
    const candles = DAYS.map(candle);
    const hist = buildStanceHistogram(
      [
        stance("v1", "2026-06-04T00:00:00+00:00", "buy"),
        stance("v2", "2026-06-06T00:00:00+00:00", "buy"),     // Sat → snaps to 06-08
        stance("v3", "2026-06-08T00:00:00+00:00", "sell"),
        stance("v4", "2026-06-08T00:00:00+00:00", "neutral"),
        stance("v5", "2026-06-01T00:00:00+00:00", "sell"),    // before range → skipped
      ],
      candles,
    );
    expect(hist).toEqual([
      { time: "2026-06-04", buy: 1, neutral: 0, sell: 0 },
      { time: "2026-06-08", buy: 1, neutral: 1, sell: 1 },
    ]);
  });

  it("returns [] when candles are empty", () => {
    expect(buildStanceHistogram([stance("v1", "2026-06-04T00:00:00+00:00", "buy")], [])).toEqual([]);
  });

  it("returns [] for intraday (numeric-time) candles", () => {
    const intraday = [{ time: 1750000000 as unknown as string, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }];
    expect(
      buildStanceHistogram([stance("v1", "2026-06-04T00:00:00+00:00", "buy")], intraday as CandleDto[]),
    ).toEqual([]);
  });
});
