import { describe, expect, it } from "vitest";
import {
  baselineOf,
  formatIndexedPercent,
  formatSignedPercent,
  snapMarkers,
  splitRuns,
  toExcessSeries,
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
    { state: "idle", from: "2026-01-05", to: "2026-01-07", opened_at: null },
    { state: "buy", from: "2026-01-07", to: null, opened_at: "2026-01-07" },
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
      { state: "idle", from: "2026-01-05", to: "2026-01-07", opened_at: null },
      // Weekend: no bar within the window
      { state: "sell", from: "2026-01-07", to: "2026-01-07", opened_at: "2026-01-07" },
      { state: "buy", from: "2026-01-07", to: null, opened_at: "2026-01-07" },
    ];
    const segs = splitRuns(pct(), runs);
    // Empty sell segment is dropped, but buy segment still connects to idle's last point
    expect(segs.map((s) => s.state)).toEqual(["idle", "buy"]);
    expect(segs[1].points[0].time).toBe("2026-01-06");
  });

  it("drops segments that cannot be drawn", () => {
    const runs: TrackRecordRun[] = [
      { state: "idle", from: "2026-01-05", to: "2026-01-06", opened_at: null },
      { state: "buy", from: "2026-01-06", to: null, opened_at: "2026-01-06" },
    ];
    const segs = splitRuns(pct(), runs);
    // idle has only 2026-01-05 -> cannot draw a line, so drop it
    expect(segs.map((s) => s.state)).toEqual(["buy"]);
  });
});

describe("snapMarkers", () => {
  const RUNS: TrackRecordRun[] = [
    { state: "idle", from: "2026-01-05", to: "2026-01-07", opened_at: null },
    { state: "buy", from: "2026-01-07", to: null, opened_at: "2026-01-07" },
  ];

  it("anchors on the segment's own bar, never the borrowed bridge point", () => {
    const [, second] = splitRuns(pct(), RUNS);
    // second.points[0] is 2026-01-06, borrowed from the idle segment
    expect(snapMarkers(second, [{ date: "2026-01-07" }])).toEqual([
      { marker: { date: "2026-01-07" }, time: "2026-01-07" },
    ]);
  });

  it("places every marker inside the segment, not just the one that opens it", () => {
    const [, second] = splitRuns(pct(), RUNS);
    const placed = snapMarkers(second, [
      { date: "2026-01-07", id: "open" },
      { date: "2026-01-08", id: "restate" },
    ]);
    expect(placed.map((p) => p.marker.id)).toEqual(["open", "restate"]);
    expect(placed.map((p) => p.time)).toEqual(["2026-01-07", "2026-01-08"]);
  });

  it("assigns each marker to exactly one segment, so none is drawn twice", () => {
    const segs = splitRuns(pct(), RUNS);
    const markers = [{ date: "2026-01-06" }, { date: "2026-01-08" }];
    const all = segs.flatMap((s) => snapMarkers(s, markers).map((p) => p.marker.date));
    expect(all).toEqual(["2026-01-06", "2026-01-08"]); // no duplicates across segments
  });

  it("ignores a marker at or past `to` even if the segment still has bars there", () => {
    // splitRuns never produces this (it clips own bars to < to), so this pins the
    // function's own [from, to) contract rather than relying on its caller.
    expect(
      snapMarkers(
        {
          state: "buy",
          from: "2026-01-05",
          to: "2026-01-07",
          points: [
            { time: "2026-01-05", value: 100 },
            { time: "2026-01-08", value: 120 },
          ],
          bridged: false,
        },
        [{ date: "2026-01-07" }],
      ),
    ).toEqual([]);
  });

  it("moves a call published on a non-trading day forward to the next session", () => {
    // A weekend gap: bars exist on Fri 01-09 and Mon 01-12, nothing between.
    const gapped = toIndexedSeries(
      [
        { date: "2026-01-09", close: 100 },
        { date: "2026-01-12", close: 110 },
      ],
      100,
    );
    const [segment] = splitRuns(gapped, [
      { state: "buy", from: "2026-01-09", to: null, opened_at: "2026-01-09" },
    ]);
    // Called on Sat 01-10 -> anchors on Mon 01-12 rather than disappearing
    expect(snapMarkers(segment, [{ date: "2026-01-10" }])[0].time).toBe(
      "2026-01-12",
    );
  });

  it("drops a marker with no bar at or after it", () => {
    const [, second] = splitRuns(pct(), RUNS);
    expect(snapMarkers(second, [{ date: "2026-02-01" }])).toEqual([]);
  });

  it("returns nothing for a segment made only of a borrowed point", () => {
    expect(
      snapMarkers(
        {
          state: "buy", from: "2026-01-07", to: null,
          points: [{ time: "2026-01-06", value: 110 }], bridged: true,
        },
        [{ date: "2026-01-07" }],
      ),
    ).toEqual([]);
  });
});

describe("formatSignedPercent", () => {
  it("signs both directions and keeps one decimal", () => {
    expect(formatSignedPercent(31.2)).toBe("+31.2%");
    expect(formatSignedPercent(-8.4)).toBe("-8.4%");
    expect(formatSignedPercent(0)).toBe("+0.0%");
  });

  it("still backs the indexed formatter", () => {
    expect(formatIndexedPercent(120)).toBe("+20.0%");
    expect(formatIndexedPercent(93)).toBe("-7.0%");
  });
});

describe("toExcessSeries", () => {
  // Stock doubles (100 -> 200, +100%); benchmark rises 10% (500 -> 550).
  const STOCK = [
    { date: "2026-01-05", close: 100 },
    { date: "2026-01-06", close: 150 },
    { date: "2026-01-07", close: 200 },
  ];
  const BENCH = [
    { date: "2026-01-05", close: 500 },
    { date: "2026-01-06", close: 525 },
    { date: "2026-01-07", close: 550 },
  ];
  const LONG: TrackRecordRun = {
    state: "buy", from: "2026-01-05", to: null, opened_at: "2026-01-05",
  };

  it("starts at zero and measures excess over the benchmark", () => {
    const pts = toExcessSeries(STOCK, BENCH, LONG);
    expect(pts.map((p) => p.time)).toEqual([
      "2026-01-05", "2026-01-06", "2026-01-07",
    ]);
    expect(pts[0].value).toBeCloseTo(0);
    expect(pts[1].value).toBeCloseTo(45); // +50% stock, +5% bench
    expect(pts[2].value).toBeCloseTo(90); // +100% stock, +10% bench
  });

  it("flips the sign for a short position, so a falling stock reads as a win", () => {
    const short: TrackRecordRun = { ...LONG, state: "sell" };
    const pts = toExcessSeries(STOCK, BENCH, short);
    // he said sell and it doubled -> he was badly wrong
    expect(pts[2].value).toBeCloseTo(-90);
  });

  it("draws nothing for an idle run", () => {
    expect(
      toExcessSeries(STOCK, BENCH, {
        state: "idle", from: "2026-01-05", to: null, opened_at: null,
      }),
    ).toEqual([]);
  });

  it("anchors on the true entry date even when it precedes the window", () => {
    // Position opened 01-05; the window only starts at 01-06, so the first
    // plotted point already carries accumulated P/L rather than starting at 0.
    const clipped: TrackRecordRun = {
      state: "buy", from: "2026-01-06", to: null, opened_at: "2026-01-05",
    };
    const pts = toExcessSeries(STOCK, BENCH, clipped);
    expect(pts.map((p) => p.time)).toEqual(["2026-01-06", "2026-01-07"]);
    expect(pts[0].value).toBeCloseTo(45); // not 0 — it opened before the window
  });

  it("moves an entry on a non-trading day forward to the next session", () => {
    const weekend: TrackRecordRun = {
      state: "buy", from: "2026-01-05", to: null, opened_at: "2026-01-04",
    };
    // 01-04 has no bar; anchor falls on 01-05, so the series still starts at 0
    expect(toExcessSeries(STOCK, BENCH, weekend)[0].value).toBeCloseTo(0);
  });

  it("stops at the run's end, exclusive", () => {
    const closed: TrackRecordRun = {
      state: "buy", from: "2026-01-05", to: "2026-01-07", opened_at: "2026-01-05",
    };
    expect(toExcessSeries(STOCK, BENCH, closed).map((p) => p.time)).toEqual([
      "2026-01-05", "2026-01-06",
    ]);
  });

  it("skips bars the benchmark has no matching session for", () => {
    const gappy = [
      { date: "2026-01-05", close: 500 },
      { date: "2026-01-07", close: 550 },
    ];
    expect(toExcessSeries(STOCK, gappy, LONG).map((p) => p.time)).toEqual([
      "2026-01-05", "2026-01-07",
    ]);
  });

  it("draws nothing when the entry price or benchmark entry is missing", () => {
    const late: TrackRecordRun = {
      state: "buy", from: "2026-02-01", to: null, opened_at: "2026-02-01",
    };
    expect(toExcessSeries(STOCK, BENCH, late)).toEqual([]);
    expect(toExcessSeries(STOCK, [], LONG)).toEqual([]);
  });
});
