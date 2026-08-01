import { describe, expect, it } from "vitest";
import {
  baselineOf,
  formatIndexedPercent,
  markerTime,
  splitRuns,
  toIndexedSeries,
  type IndexedPoint,
} from "@/lib/track-record";
import type { TrackRecordRun } from "@/lib/types";

const CLOSES = [
  { date: "2026-01-05", close: 100 },
  { date: "2026-01-06", close: 110 },
  { date: "2026-01-07", close: 120 },
  { date: "2026-01-08", close: 90 },
];

function pct(): IndexedPoint[] {
  return toIndexedSeries(CLOSES, baselineOf(CLOSES));
}

describe("baselineOf / toIndexedSeries", () => {
  it("indexes against the first close in the window, baseline = 100", () => {
    const values = pct().map((p) => p.value);
    expect(values[0]).toBeCloseTo(100);
    expect(values[1]).toBeCloseTo(110);
    expect(values[2]).toBeCloseTo(120);
    expect(values[3]).toBeCloseTo(90);
  });

  it("keeps the dates as the time axis", () => {
    expect(pct().map((p) => p.time)).toEqual([
      "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08",
    ]);
  });

  it("has no baseline for an empty or non-positive series", () => {
    expect(baselineOf([])).toBeNull();
    expect(baselineOf([{ date: "2026-01-05", close: 0 }])).toBeNull();
    expect(toIndexedSeries(CLOSES, null)).toEqual([]);
  });

  it("stays strictly positive even when the series dips below its baseline", () => {
    // This is the property log mode depends on: lightweight-charts v5's log
    // scale is a signed transform that breaks on values that cross zero.
    // Plain percent change (110-100=10, 90-100=-10) would go negative here;
    // the indexed values must not.
    const values = pct().map((p) => p.value);
    expect(values.every((v) => v > 0)).toBe(true);
    // Sanity: the dip is real (90 < baseline of 100 in raw-close terms) —
    // confirms this test is actually exercising a below-baseline point,
    // not vacuously true because the fixture never dips.
    expect(values[3]).toBeLessThan(values[0]);
  });
});

describe("formatIndexedPercent", () => {
  it("pins the display contract: indexed value -> signed percent string", () => {
    expect(formatIndexedPercent(120)).toBe("+20.0%");
    expect(formatIndexedPercent(93)).toBe("-7.0%");
    expect(formatIndexedPercent(786)).toBe("+686.0%");
    expect(formatIndexedPercent(100)).toBe("+0.0%");
  });
});

describe("splitRuns", () => {
  const RUNS: TrackRecordRun[] = [
    { state: "idle", from: "2026-01-05", to: "2026-01-07" },
    { state: "buy", from: "2026-01-07", to: null },
  ];

  it("keeps the run order and state", () => {
    expect(splitRuns(pct(), RUNS).map((s) => s.state)).toEqual(["idle", "buy"]);
  });

  it("shares exactly one boundary point between adjacent segments", () => {
    const [first, second] = splitRuns(pct(), RUNS);
    expect(first.points.map((p) => p.time)).toEqual([
      "2026-01-05", "2026-01-06",
    ]);
    expect(second.points.map((p) => p.time)).toEqual([
      "2026-01-06", "2026-01-07", "2026-01-08",
    ]);
    expect(second.points[0]).toEqual(first.points[first.points.length - 1]);
    expect(second.bridged).toBe(true);
    expect(first.bridged).toBe(false);
  });

  it("bridges a run whose date range contains no trading day", () => {
    const runs: TrackRecordRun[] = [
      { state: "idle", from: "2026-01-05", to: "2026-01-07" },
      // Weekend: no bar within the window
      { state: "sell", from: "2026-01-07", to: "2026-01-07" },
      { state: "buy", from: "2026-01-07", to: null },
    ];
    const segs = splitRuns(pct(), runs);
    // Empty sell segment is dropped, but buy segment still connects to idle's last point
    expect(segs.map((s) => s.state)).toEqual(["idle", "buy"]);
    expect(segs[1].points[0].time).toBe("2026-01-06");
  });

  it("drops segments that cannot be drawn", () => {
    const runs: TrackRecordRun[] = [
      { state: "idle", from: "2026-01-05", to: "2026-01-06" },
      { state: "buy", from: "2026-01-06", to: null },
    ];
    const segs = splitRuns(pct(), runs);
    // idle has only 2026-01-05 -> cannot draw a line, so drop it
    expect(segs.map((s) => s.state)).toEqual(["buy"]);
  });
});

describe("markerTime", () => {
  it("anchors on the segment's own first bar, not the bridged one", () => {
    const [, second] = splitRuns(pct(), [
      { state: "idle", from: "2026-01-05", to: "2026-01-07" },
      { state: "buy", from: "2026-01-07", to: null },
    ]);
    expect(markerTime(second)).toBe("2026-01-07");
  });

  it("is null when the segment has no bar of its own", () => {
    expect(
      markerTime({
        state: "buy", from: "2026-01-07", to: null,
        points: [{ time: "2026-01-06", value: 10 }], bridged: true,
      }),
    ).toBeNull();
  });
});
