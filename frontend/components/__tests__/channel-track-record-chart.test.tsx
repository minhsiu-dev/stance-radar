import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addSeriesSpy = vi.hoisted(() => vi.fn());
const markersSpy = vi.hoisted(() => vi.fn());
const removeSpy = vi.hoisted(() => vi.fn());
const crosshairSpy = vi.hoisted(() => vi.fn());
const createChartSpy = vi.hoisted(() => vi.fn());
const priceScaleApplyOptionsSpy = vi.hoisted(() => vi.fn());
const appliedOptions = vi.hoisted(() => [] as unknown[]);
// Parallel to addSeriesSpy.mock.calls: createdSeries[i] is the object
// returned from the i-th addSeries(...) call, so a test can grab a specific
// series (e.g. "whichever call had title 'FFF'") and feed it back into a
// fabricated subscribeCrosshairMove param as `seriesData` keys.
const createdSeries = vi.hoisted(() => [] as unknown[]);
vi.mock("lightweight-charts", () => {
  const chart = {
    addSeries: (...args: unknown[]) => {
      addSeriesSpy(...args);
      const series = {
        setData: vi.fn(),
        applyOptions: (o: unknown) => appliedOptions.push(o),
        priceScale: () => ({ applyOptions: vi.fn() }),
      };
      createdSeries.push(series);
      return series;
    },
    timeScale: () => ({ fitContent: vi.fn(), applyOptions: vi.fn() }),
    subscribeCrosshairMove: crosshairSpy,
    // A stable spy (not a fresh vi.fn() per call) so a test can assert on
    // the price-scale-mode toggle effect, which calls
    // chart.priceScale("right").applyOptions({ mode }) on every click.
    priceScale: () => ({ applyOptions: priceScaleApplyOptionsSpy }),
    applyOptions: vi.fn(),
    remove: removeSpy,
  };
  return {
    createChart: (...args: unknown[]) => {
      createChartSpy(...args);
      return chart;
    },
    // The component calls createSeriesMarkers(series, markers) once, with markers
    // passed in directly rather than via a separate setMarkers call.
    createSeriesMarkers: (...args: unknown[]) => {
      markersSpy(...args);
      return { setMarkers: vi.fn() };
    },
    LineSeries: { kind: "line" },
    BaselineSeries: { kind: "baseline" },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    ColorType: { Solid: "solid" },
    // Values mirror the real enum (Normal=0, Logarithmic=1, ...) — the
    // component must never reference Percentage (see track-record.ts for
    // why: it would rebase each per-run segment series to 0 at its own
    // first visible point).
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
  };
});
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
class MockResizeObserver {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

let swrKey: string | null = null;
let swrData: unknown;
let swrError: Error | undefined;
vi.mock("swr", () => ({
  default: (key: string) => {
    swrKey = key;
    return { data: swrData, error: swrError };
  },
}));

import { ChannelTrackRecordChart } from "@/components/channel-track-record-chart";
import { toExcessSeries } from "@/lib/track-record";

// DAYS[4] exists only so AAA's open-ended sell run (see threeRunTicker below)
// has two bars matching benchmark_closes to compute an excess-return series
// from — the price-view tests below never reference it.
const DAYS = [
  "2026-01-05",
  "2026-01-06",
  "2026-01-07",
  "2026-01-08",
  "2026-01-09",
];

function closes() {
  return DAYS.map((date, i) => ({ date, close: 100 + i * 10 }));
}

/** Three segments: idle [d0,d2) → buy [d2,d3) → sell [d3,∞).
 *  The boundaries are chosen so every segment still has >= 2 points after
 *  splitRuns (segments with fewer than two points get dropped, which would
 *  make it impossible to test the faded and dotted styling).
 *  `opened_at` mirrors `from` for the buy/sell runs (null for idle, which
 *  holds no position) — a real position opened exactly when the run starts. */
function threeRunTicker(name: string) {
  return {
    ticker: name,
    calls: 3,
    runs: [
      { state: "idle" as const, from: DAYS[0], to: DAYS[2], opened_at: null },
      { state: "buy" as const, from: DAYS[2], to: DAYS[3], opened_at: DAYS[2] },
      { state: "sell" as const, from: DAYS[3], to: null, opened_at: DAYS[3] },
    ],
    markers: [
      { date: DAYS[2], stance: "buy" as const, kind: "new" as const, video_id: "v1", video_title: "one" },
      { date: DAYS[3], stance: "sell" as const, kind: "new" as const, video_id: "v2", video_title: "two" },
    ],
    closes: closes(),
  };
}

/** Single segment: buy all the way to today, with a same-stance restatement part
 *  way through — two markers land inside one segment, which is what distinguishes
 *  "every call is marked" from the old "only the call that opens a run is marked". */
function buyTicker(name: string) {
  return {
    ticker: name,
    calls: 2,
    runs: [{ state: "buy" as const, from: DAYS[0], to: null, opened_at: DAYS[0] }],
    markers: [
      { date: DAYS[0], stance: "buy" as const, kind: "new" as const, video_id: "b1", video_title: "opened" },
      { date: DAYS[2], stance: "buy" as const, kind: "repeat" as const, video_id: "b2", video_title: "restated" },
    ],
    closes: closes(),
  };
}

/** Priced, but every run is idle — nothing to draw in the performance view,
 *  while the price view still draws it fine. */
function idleOnlyTicker(name: string) {
  return {
    ticker: name,
    calls: 1,
    runs: [{ state: "idle" as const, from: DAYS[0], to: null, opened_at: null }],
    markers: [],
    closes: closes(),
  };
}

/** Priced entirely BEFORE the observation window (every bar predates
 *  RESPONSE.start === DAYS[0]) — simulates an all-time-ranked ticker that was
 *  delisted, or simply stopped trading, between the backend's widened
 *  price_start and the window's actual start. `hasPrice` (unclipped) is true
 *  — there are >= 2 bars — but `clipToWindow` drops every one of them, so the
 *  price view has nothing to draw even though the ticker "has price data". */
function preWindowOnlyTicker(name: string) {
  return {
    ticker: name,
    calls: 1,
    runs: [
      {
        state: "buy" as const,
        from: "2025-01-01",
        to: "2025-01-03",
        opened_at: "2025-01-01",
      },
    ],
    markers: [],
    closes: [
      { date: "2025-01-01", close: 50 },
      { date: "2025-01-02", close: 60 },
    ],
  };
}

/** A buy call published on DAYS[1] — a date with NO bar of its own (closes
 *  skip straight from DAYS[0] to DAYS[3]) — so snapMarkers must move it
 *  forward onto DAYS[3], the first bar at or after it. Distinguishes a
 *  tooltip lookup keyed by the marker's raw date from one keyed by the
 *  snapped bar date the chart actually plots the arrow on. */
function gapTicker(name: string) {
  return {
    ticker: name,
    calls: 1,
    runs: [{ state: "buy" as const, from: DAYS[0], to: null, opened_at: DAYS[0] }],
    markers: [
      {
        date: DAYS[1],
        stance: "buy" as const,
        kind: "new" as const,
        video_id: "g1",
        video_title: "gap-title",
      },
    ],
    closes: [
      { date: DAYS[0], close: 100 },
      { date: DAYS[3], close: 130 },
    ],
  };
}

const RESPONSE = {
  benchmark: "VOO",
  range: "1y",
  start: DAYS[0],
  benchmark_closes: [
    { date: DAYS[0], close: 500 },
    { date: DAYS[3], close: 510 },
    { date: DAYS[4], close: 515 },
  ],
  tickers: [
    threeRunTicker("AAA"),
    buyTicker("BBB"),
    buyTicker("CCC"),
    buyTicker("DDD"),
    buyTicker("EEE"),
    buyTicker("FFF"),
  ],
};

function chipFor(name: string): HTMLElement {
  return screen.getByTestId(`track-chip-${name}`);
}

describe("ChannelTrackRecordChart", () => {
  beforeEach(() => {
    addSeriesSpy.mockClear();
    markersSpy.mockClear();
    removeSpy.mockClear();
    crosshairSpy.mockClear();
    createChartSpy.mockClear();
    priceScaleApplyOptionsSpy.mockClear();
    appliedOptions.length = 0;
    createdSeries.length = 0;
    swrData = RESPONSE;
    swrError = undefined;
    swrKey = null;
  });

  it("activates the first five tickers by default", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    for (const name of ["AAA", "BBB", "CCC", "DDD", "EEE"]) {
      expect(chipFor(name)).toHaveAttribute("aria-pressed", "true");
    }
    expect(chipFor("FFF")).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles a ticker on and off", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    fireEvent.click(chipFor("FFF"));
    expect(chipFor("FFF")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chipFor("FFF"));
    expect(chipFor("FFF")).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses to turn off the last active ticker", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    for (const name of ["AAA", "BBB", "CCC", "DDD"]) fireEvent.click(chipFor(name));
    expect(chipFor("EEE")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chipFor("EEE"));
    expect(chipFor("EEE")).toHaveAttribute("aria-pressed", "true");
  });

  it("changes the SWR key when the range changes", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(swrKey).toBe("/api/channels/ch1/track-record?range=1y");
    fireEvent.click(screen.getByTestId("track-range-6m"));
    expect(swrKey).toBe("/api/channels/ch1/track-record?range=6m");
  });

  it("titles only the last segment of a ticker, so the axis label is not repeated", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const titles = addSeriesSpy.mock.calls
      .map((call) => (call[1] as { title?: string }).title)
      .filter((title): title is string => Boolean(title));
    expect(titles.filter((t) => t === "AAA")).toHaveLength(1);
    expect(titles).toContain("VOO");
  });

  it("draws sell runs dotted and idle runs faded", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const opts = addSeriesSpy.mock.calls.map(
      (call) => call[1] as { lineStyle?: number; color?: string },
    );
    // AAA's sell segment -> LineStyle.Dotted (1 in the mock)
    expect(opts.some((o) => o.lineStyle === 1)).toBe(true);
    // AAA's idle segment -> the rgba() produced by withAlpha()
    expect(opts.some((o) => o.color?.startsWith("rgba("))).toBe(true);
  });

  it("anchors each turning-point marker on the run that opens it", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const placed = markersSpy.mock.calls.flatMap(
      (call) => call[1] as { time: string; shape: string }[],
    );
    expect(placed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ time: DAYS[2], shape: "arrowUp" }),
        expect.objectContaining({ time: DAYS[3], shape: "arrowDown" }),
      ]),
    );
  });

  it("marks every call, including same-stance restatements inside one run", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    // BBB is a single buy run carrying two markers: the opening call and a
    // restatement. Both must be drawn on that one segment.
    const bbbIndex = addSeriesSpy.mock.calls.findIndex(
      (call) => (call[1] as { title?: string }).title === "BBB",
    );
    const bbbCall = markersSpy.mock.calls.find(
      (call) => call[0] === createdSeries[bbbIndex],
    );
    const placed = bbbCall![1] as { time: string; size: number }[];
    expect(placed.map((m) => m.time)).toEqual([DAYS[0], DAYS[2]]);
  });

  it("draws restatements faded and smaller so state changes stay dominant", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const placed = markersSpy.mock.calls.flatMap(
      (call) => call[1] as { time: string; size: number; color: string }[],
    );
    const opened = placed.find((m) => m.time === DAYS[0])!;
    const restated = placed.find(
      (m) => m.time === DAYS[2] && m.size !== 1,
    )!;
    expect(opened.size).toBe(1);
    expect(opened.color).not.toMatch(/^rgba\(/);
    expect(restated.size).toBeLessThan(1);
    expect(restated.color).toMatch(/^rgba\(/);
  });

  it("renders the empty state and reports it upward", () => {
    const onEmptyChange = vi.fn();
    swrData = { ...RESPONSE, tickers: [] };
    render(
      <ChannelTrackRecordChart channelId="ch1" onEmptyChange={onEmptyChange} />,
    );
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(onEmptyChange).toHaveBeenCalledWith(true);
  });

  it("does not re-notify onEmptyChange when only the callback's identity changes", () => {
    // Same underlying data object throughout — no SWR revalidation happens
    // in this test, only a parent-style re-render with a fresh inline
    // callback (what ChannelDetail used to pass on every render).
    swrData = { ...RESPONSE, tickers: [] };
    const first = vi.fn();
    const { rerender } = render(
      <ChannelTrackRecordChart channelId="ch1" onEmptyChange={first} />,
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(true);

    const second = vi.fn();
    rerender(
      <ChannelTrackRecordChart channelId="ch1" onEmptyChange={second} />,
    );
    expect(second).not.toHaveBeenCalled();
  });

  it("notifies again on a genuine flip of `empty`, but not on a same-emptiness revalidation", () => {
    swrData = { ...RESPONSE, tickers: [] };
    const onEmptyChange = vi.fn();
    const { rerender } = render(
      <ChannelTrackRecordChart channelId="ch1" onEmptyChange={onEmptyChange} />,
    );
    expect(onEmptyChange).toHaveBeenCalledWith(true);
    onEmptyChange.mockClear();

    // Simulate a revalidation (e.g. SWR's revalidateOnFocus) that resolves
    // to the SAME emptiness: a brand new `data` object reference, but no
    // real transition — must not re-notify.
    swrData = { ...RESPONSE, tickers: [] };
    rerender(
      <ChannelTrackRecordChart channelId="ch1" onEmptyChange={onEmptyChange} />,
    );
    expect(onEmptyChange).not.toHaveBeenCalled();

    // A genuine flip — the channel now has directional calls — must notify.
    swrData = RESPONSE;
    rerender(
      <ChannelTrackRecordChart channelId="ch1" onEmptyChange={onEmptyChange} />,
    );
    expect(onEmptyChange).toHaveBeenCalledWith(false);
  });

  it("keeps a price-less ticker listed but disabled and unselected", () => {
    const dead = { ...buyTicker("ZZZ"), closes: [] };
    // Placed first: even though it ranks first, it should not be selected by default.
    swrData = { ...RESPONSE, tickers: [dead, ...RESPONSE.tickers] };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const chip = chipFor("ZZZ");
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "false");
    // The default five shift over instead of leaving only four lines drawn.
    expect(chipFor("EEE")).toHaveAttribute("aria-pressed", "true");
  });

  it("treats a ticker whose bars all predate the window as undrawable in the price view — not the same as price-less", () => {
    // Distinct from the "price-less" case above: YYY DOES have >= 2 bars
    // (hasPrice, unclipped, is true), they just all fall before
    // RESPONSE.start. Before the fix, drawableIn's price branch returned
    // `true` as soon as hasPrice passed, regardless of `start` — so this
    // chip rendered enabled and default-selected while the price view (which
    // clips to the window before drawing) actually plotted nothing for it.
    // As the sole ticker here, that produced a blank chart with no empty
    // message, since drawableCount counted it as drawable.
    swrData = { ...RESPONSE, tickers: [preWindowOnlyTicker("YYY")] };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const chip = chipFor("YYY");
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("wires a crosshair tooltip", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.getByTestId("track-record-tooltip")).toBeInTheDocument();
    expect(crosshairSpy).toHaveBeenCalled();
  });

  it("drops an active ticker from `active` when a data change makes it undrawable, without emptying the rest", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(chipFor("AAA")).toHaveAttribute("aria-pressed", "true");
    expect(chipFor("BBB")).toHaveAttribute("aria-pressed", "true");

    // Simulate a range switch whose new window has no price bars for AAA
    // (e.g. AAA's last trade is older than the new, narrower window) — the
    // ticker is still in the list (still ranked), just no longer drawable.
    swrData = {
      ...RESPONSE,
      tickers: RESPONSE.tickers.map((item) =>
        item.ticker === "AAA" ? { ...item, closes: [] } : item,
      ),
    };
    fireEvent.click(screen.getByTestId("track-range-6m"));

    const aaaChip = chipFor("AAA");
    expect(aaaChip).toBeDisabled();
    // The old bug: AAA stays stuck aria-pressed="true" while disabled, so the
    // user can never click it off. It must now read as off.
    expect(aaaChip).toHaveAttribute("aria-pressed", "false");
    // The rest of the previously-active selection survives untouched — this
    // is a targeted drop, not a full reseed back to the default five.
    expect(chipFor("BBB")).toHaveAttribute("aria-pressed", "true");
    expect(chipFor("FFF")).toHaveAttribute("aria-pressed", "false");
  });

  it("falls back to the default seed when every active ticker becomes undrawable at once", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    // All five originally-active tickers (AAA..EEE) lose their price data;
    // only FFF (originally inactive) keeps it. The intersection with the
    // drawable set would be empty, so the fallback should reseed instead of
    // leaving no chart to show.
    swrData = {
      ...RESPONSE,
      tickers: RESPONSE.tickers.map((item) =>
        item.ticker === "FFF" ? item : { ...item, closes: [] },
      ),
    };
    fireEvent.click(screen.getByTestId("track-range-6m"));
    expect(chipFor("FFF")).toHaveAttribute("aria-pressed", "true");
  });

  it("does not tear down the chart on a chip toggle, but does on a data-changing range switch", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    removeSpy.mockClear();

    fireEvent.click(chipFor("FFF"));
    expect(removeSpy).not.toHaveBeenCalled();

    // A real range switch fetches a fresh response; simulate that by giving
    // SWR a new (even if content-equivalent) object before the click causes
    // a re-render.
    swrData = { ...RESPONSE };
    fireEvent.click(screen.getByTestId("track-range-6m"));
    expect(removeSpy).toHaveBeenCalled();
  });

  it("hides a toggled ticker via visible:false on its existing series instead of removing it", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const callsAfterMount = addSeriesSpy.mock.calls.length;
    // FFF's single-segment series already exists at mount (built eagerly for
    // every drawable ticker), just hidden — confirm it was created up front.
    expect(
      addSeriesSpy.mock.calls.some(
        (call) => (call[1] as { title?: string }).title === "FFF",
      ),
    ).toBe(true);

    fireEvent.click(chipFor("FFF"));
    // Turning a chip on/off must never call addSeries again.
    expect(addSeriesSpy.mock.calls.length).toBe(callsAfterMount);
    expect(
      appliedOptions.some((o) => (o as { visible?: boolean }).visible === true),
    ).toBe(true);

    fireEvent.click(chipFor("FFF"));
    expect(addSeriesSpy.mock.calls.length).toBe(callsAfterMount);
    expect(
      appliedOptions.some((o) => (o as { visible?: boolean }).visible === false),
    ).toBe(true);
  });

  it("excludes a hidden ticker's series from the crosshair tooltip even if lightweight-charts still reports data for it", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const aaaIndex = addSeriesSpy.mock.calls.findIndex(
      (call) => (call[1] as { title?: string }).title === "AAA",
    );
    const fffIndex = addSeriesSpy.mock.calls.findIndex(
      (call) => (call[1] as { title?: string }).title === "FFF",
    );
    expect(aaaIndex).toBeGreaterThanOrEqual(0);
    expect(fffIndex).toBeGreaterThanOrEqual(0);
    const aaaSeries = createdSeries[aaaIndex];
    const fffSeries = createdSeries[fffIndex]; // FFF is inactive by default

    const crosshairHandler = crosshairSpy.mock.calls[0][0] as (param: unknown) => void;
    crosshairHandler({
      point: { x: 10, y: 10 },
      time: DAYS[2],
      seriesData: new Map([
        [aaaSeries, { value: 5 }],
        [fffSeries, { value: 42 }],
      ]),
    });

    const tooltip = screen.getByTestId("track-record-tooltip");
    expect(tooltip.textContent).toContain("AAA");
    expect(tooltip.textContent).not.toContain("FFF");
  });

  it("renders the crosshair tooltip's per-ticker value as a signed percentage of the indexed value, not the raw indexed number", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const aaaIndex = addSeriesSpy.mock.calls.findIndex(
      (call) => (call[1] as { title?: string }).title === "AAA",
    );
    const aaaSeries = createdSeries[aaaIndex];

    const crosshairHandler = crosshairSpy.mock.calls[0][0] as (param: unknown) => void;
    // 105 is an indexed-to-100 value (chart series data), meaning +5% —
    // the tooltip must show "+5.0%", never "105.0%" or "105".
    crosshairHandler({
      point: { x: 10, y: 10 },
      time: DAYS[0],
      seriesData: new Map([[aaaSeries, { value: 105 }]]),
    });

    const tooltip = screen.getByTestId("track-record-tooltip");
    expect(tooltip.textContent).toContain("+5.0%");
    expect(tooltip.textContent).not.toContain("105.0%");
  });

  it("keeps the chart container mounted (and does not tear down the chart) when a background revalidation errors on an already-loaded chart", () => {
    const { rerender } = render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.getByTestId("track-record-canvas")).toBeInTheDocument();
    removeSpy.mockClear();

    // Simulate SWR's revalidateOnFocus failing: `error` becomes set while
    // `data` keeps the exact same reference (as SWR does when the request
    // fails without new data). The old bug rendered `error ? <p> : ... :
    // <div ref={containerRef}>`, which swaps the container out of the tree
    // on this transition — but the chart-creation effect's deps ([data,
    // dark, rankOf]) haven't changed, so its cleanup never runs and the
    // chart is orphaned on a detached node.
    swrError = new Error("network blip");
    rerender(<ChannelTrackRecordChart channelId="ch1" />);

    // The container must still be in the document — never unmounted —
    // and the error is surfaced ABOVE the still-live chart, not instead of it.
    expect(screen.getByTestId("track-record-canvas")).toBeInTheDocument();
    expect(screen.getByText(/error/)).toBeInTheDocument();
    // Since `data` is unchanged, the chart-creation effect must not have
    // re-run (no stale chart torn down, no new one created).
    expect(removeSpy).not.toHaveBeenCalled();

    // Once the revalidation later succeeds again, the container is still
    // the one the chart was created in — no flash of an empty chart area.
    swrError = undefined;
    rerender(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.getByTestId("track-record-canvas")).toBeInTheDocument();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("shows the video title as a secondary line under a ticker's row on its turning-point date", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const aaaIndex = addSeriesSpy.mock.calls.findIndex(
      (call) => (call[1] as { title?: string }).title === "AAA",
    );
    const aaaSeries = createdSeries[aaaIndex];

    const crosshairHandler = crosshairSpy.mock.calls[0][0] as (
      param: unknown,
    ) => void;
    // DAYS[2] is AAA's buy turning point (marker video_title: "one").
    crosshairHandler({
      point: { x: 10, y: 10 },
      time: DAYS[2],
      seriesData: new Map([[aaaSeries, { value: 5 }]]),
    });

    const tooltip = screen.getByTestId("track-record-tooltip");
    expect(tooltip.textContent).toContain("one");
  });

  it("shows no video title line on a date that is not a turning point for that ticker", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const aaaIndex = addSeriesSpy.mock.calls.findIndex(
      (call) => (call[1] as { title?: string }).title === "AAA",
    );
    const aaaSeries = createdSeries[aaaIndex];

    const crosshairHandler = crosshairSpy.mock.calls[0][0] as (
      param: unknown,
    ) => void;
    // DAYS[0] has no marker for AAA.
    crosshairHandler({
      point: { x: 10, y: 10 },
      time: DAYS[0],
      seriesData: new Map([[aaaSeries, { value: 0 }]]),
    });

    const tooltip = screen.getByTestId("track-record-tooltip");
    expect(tooltip.textContent).not.toContain("one");
    expect(tooltip.textContent).not.toContain("two");
  });

  it("resolves the marker title by the snapped bar date, not the call's raw (non-trading-day) date", () => {
    // GGG's only marker is dated DAYS[1], a day with no bar of its own —
    // snapMarkers moves it forward to DAYS[3] (see gapTicker above), which is
    // also the only bar the crosshair can ever report as `param.time` for
    // this series. If the tooltip's lookup map were still keyed by the
    // marker's raw date (the pre-fix behavior), hovering DAYS[3] would find
    // nothing — the title would be permanently unreachable.
    // Placed first so it lands in the default-active five (the crosshair
    // tooltip skips inactive tickers entirely — see activeRef filtering
    // below — which is orthogonal to what this test is pinning).
    swrData = { ...RESPONSE, tickers: [gapTicker("GGG"), ...RESPONSE.tickers] };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const gggIndex = addSeriesSpy.mock.calls.findIndex(
      (call) => (call[1] as { title?: string }).title === "GGG",
    );
    expect(gggIndex).toBeGreaterThanOrEqual(0);
    const gggSeries = createdSeries[gggIndex];

    const crosshairHandler = crosshairSpy.mock.calls[
      crosshairSpy.mock.calls.length - 1
    ][0] as (param: unknown) => void;
    crosshairHandler({
      point: { x: 10, y: 10 },
      time: DAYS[3],
      seriesData: new Map([[gggSeries, { value: 3 }]]),
    });

    const tooltip = screen.getByTestId("track-record-tooltip");
    expect(tooltip.textContent).toContain("gap-title");
  });

  it("defaults the price scale to linear (Normal mode)", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.getByTestId("track-scale-linear")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("track-scale-log")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const opts = createChartSpy.mock.calls[0][1] as {
      rightPriceScale?: { mode?: number };
    };
    expect(opts.rightPriceScale?.mode).toBe(0); // PriceScaleMode.Normal
  });

  it("switches to Logarithmic mode on toggle without tearing down the chart", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    removeSpy.mockClear();
    createChartSpy.mockClear();

    fireEvent.click(screen.getByTestId("track-scale-log"));

    expect(screen.getByTestId("track-scale-log")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("track-scale-linear")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Applied via applyOptions on the existing price scale (mode 1 =
    // Logarithmic), the same technique as chip visibility — never a rebuild.
    expect(priceScaleApplyOptionsSpy).toHaveBeenCalledWith({ mode: 1 });
    expect(removeSpy).not.toHaveBeenCalled();
    expect(createChartSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("track-scale-linear"));
    expect(priceScaleApplyOptionsSpy).toHaveBeenCalledWith({ mode: 0 });
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("never uses PriceScaleMode.Percentage, which would rebase each run segment to 0", () => {
    // Percentage mode zeroes a series to its own first *visible* point; since
    // one ticker is split into several run-segment series, a segment that
    // starts mid-window would be flattened to 0%, destroying the chart's
    // relative geometry (this is why the component computes percentages
    // itself in track-record.ts instead of using this chart mode).
    render(<ChannelTrackRecordChart channelId="ch1" />);
    fireEvent.click(screen.getByTestId("track-scale-log"));
    fireEvent.click(screen.getByTestId("track-scale-linear"));
    const modesUsed = priceScaleApplyOptionsSpy.mock.calls.map(
      (call) => (call[0] as { mode: number }).mode,
    );
    expect(modesUsed).not.toContain(2); // PriceScaleMode.Percentage
  });

  it("wires the price-scale formatter to render indexed chart values as signed percentages", () => {
    // The series data plotted on the chart is indexed to 100 (see
    // track-record.ts), not raw percent change — this confirms the formatter
    // passed to createChart's `localization.priceFormatter` (which also
    // drives the line-end labels via lastValueVisible/title) renders it back
    // as the percentage the reader expects, e.g. price-scale ticks reading
    // "+20.0%" rather than the raw indexed number "120".
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const opts = createChartSpy.mock.calls[0][1] as {
      localization?: { priceFormatter?: (v: number) => string };
    };
    expect(opts.localization?.priceFormatter?.(120)).toBe("+20.0%");
    expect(opts.localization?.priceFormatter?.(93)).toBe("-7.0%");
    expect(opts.localization?.priceFormatter?.(786)).toBe("+686.0%");
  });

  it("baselines the price view to the window start, not to a bar fetched only to price another ticker's early entry", () => {
    // track_record.py's price_start reaches back to the earliest opened_at
    // across ALL ranked tickers (see build_track_record), so every ticker's
    // `closes` array can carry bars before `data.start` even when this
    // particular ticker's own run opened exactly at the window start. The
    // price view must clip those leading bars before computing its baseline
    // (see clipToWindow in track-record.ts) — otherwise the displayed "%
    // since window start" silently drifts to whatever date the extension
    // happens to start at.
    const earlyBarTicker = {
      ...buyTicker("GGG"),
      // An extra bar dated before RESPONSE.start (DAYS[0]), simulating the
      // backend's extension for some OTHER ticker's early position. Its
      // price (1000) is wildly different from the window's actual first
      // close (100 on DAYS[0]) so a wrong baseline is obvious.
      closes: [{ date: "2025-01-01", close: 1000 }, ...closes()],
    };
    swrData = {
      ...RESPONSE,
      tickers: [earlyBarTicker, ...RESPONSE.tickers.slice(1)],
    };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const gggIndex = addSeriesSpy.mock.calls.findIndex(
      (call) =>
        (call[0] as { kind?: string }).kind === "line" &&
        (call[1] as { title?: string }).title === "GGG",
    );
    expect(gggIndex).toBeGreaterThanOrEqual(0);
    const plotted = (
      createdSeries[gggIndex] as {
        setData: { mock: { calls: [{ time: string; value: number }[]][] } };
      }
    ).setData.mock.calls[0][0];
    // First plotted point is DAYS[0] at close=100 -> indexed value 100
    // (baseline = the window-start bar), not 100/1000*100 = 10 (the bug:
    // baselining off the unclipped array's first bar).
    expect(plotted[0].time).toBe(DAYS[0]);
    expect(plotted[0].value).toBeCloseTo(100);
  });

  it("clips the benchmark series to the window start too, not just the ticker series", () => {
    // Mirrors the GGG test above, but for the benchmark line: the same
    // globally-shared price_start extension that can put an early bar in a
    // ticker's `closes` (see clipToWindow's docstring) lands in
    // `benchmark_closes` as well, since both are fetched together. The
    // fixture's default RESPONSE.benchmark_closes[0].date already equals
    // RESPONSE.start, so it alone can't distinguish "clipped" from
    // "unclipped" — this test injects an earlier bar to force that
    // distinction.
    const earlyBenchmarkCloses = [
      // Wildly different price, dated before RESPONSE.start, so an unclipped
      // baseline is obviously wrong rather than coincidentally close.
      { date: "2025-01-01", close: 5000 },
      ...RESPONSE.benchmark_closes,
    ];
    swrData = { ...RESPONSE, benchmark_closes: earlyBenchmarkCloses };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    const benchmarkIndex = addSeriesSpy.mock.calls.findIndex(
      (call) =>
        (call[0] as { kind?: string }).kind === "line" &&
        (call[1] as { title?: string }).title === "VOO",
    );
    expect(benchmarkIndex).toBeGreaterThanOrEqual(0);
    const plotted = (
      createdSeries[benchmarkIndex] as {
        setData: { mock: { calls: [{ time: string; value: number }[]][] } };
      }
    ).setData.mock.calls[0][0];
    // First plotted point is DAYS[0] (the window start) at close=500 ->
    // indexed 100 (baseline = the window-start bar), not the injected
    // 2025-01-01 bar (the bug: baselining/plotting off the unclipped array,
    // which would put "2025-01-01" as plotted[0] instead).
    expect(plotted[0].time).toBe(DAYS[0]);
    expect(plotted[0].value).toBeCloseTo(100);
    // DAYS[3]'s indexed value is baselined at 500 (clipped) -> 102, not at
    // 5000 (unclipped) -> 10.2 — a wrong baseline would compress this ~10x.
    const laterPoint = plotted.find(
      (p: { time: string }) => p.time === DAYS[3],
    );
    expect(laterPoint.value).toBeCloseTo(102);
  });
});

describe("ChannelTrackRecordChart — call performance view", () => {
  beforeEach(() => {
    addSeriesSpy.mockClear();
    // createdSeries is a module-level array that parallels
    // addSeriesSpy.mock.calls by index (see the mock above); it must be
    // cleared alongside the spy or an index computed from this test's own
    // (freshly-cleared) calls would land on a stale entry left over from an
    // earlier test.
    createdSeries.length = 0;
    swrData = RESPONSE;
  });

  function switchToPerformance() {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    fireEvent.click(screen.getByTestId("track-view-performance"));
  }

  it("tears down and recreates the chart exactly once when switching views, never accumulating series", () => {
    // Unlike a chip toggle (visible:false on an existing series) or the
    // linear/log toggle (applyOptions on the existing scale), the view
    // switch is a genuine structural change — the series type itself
    // changes from Line to Baseline — so it must go through the full
    // teardown/rebuild path exactly once, not zero times (stale series
    // reused) or more than once (leaked chart instances).
    render(<ChannelTrackRecordChart channelId="ch1" />);
    removeSpy.mockClear();
    fireEvent.click(screen.getByTestId("track-view-performance"));
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("defaults to the price view", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.getByTestId("track-view-price")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches the series type to Baseline with a zero base value", () => {
    switchToPerformance();
    const baselines = addSeriesSpy.mock.calls.filter(
      (call) => (call[0] as { kind?: string }).kind === "baseline",
    );
    expect(baselines.length).toBeGreaterThan(0);
    const opts = baselines[0][1] as {
      baseValue: { type: string; price: number };
      topLineColor: string;
      bottomLineColor: string;
      topFillColor1: string;
      bottomFillColor1: string;
    };
    expect(opts.baseValue).toEqual({ type: "price", price: 0 });
    // ticker hue above and below; only the opacity differs
    expect(opts.topLineColor).not.toMatch(/^rgba\(/);
    expect(opts.bottomLineColor).toMatch(/^rgba\(/);
    // fills off: ten overlapping translucent fills would be mud
    expect(opts.topFillColor1).toBe("transparent");
    expect(opts.bottomFillColor1).toBe("transparent");
  });

  it("clips the performance view's benchmark zero line to the window start too, not just the price view's baseline", () => {
    // Mirrors "clips the benchmark series to the window start too" in the
    // price-view describe above, but for the performance view's flat zero
    // line. Every ticker's BaselineSeries starts at run.from >= data.start,
    // so an unclipped zero line is the ONLY series carrying pre-window bars
    // — and chart.timeScale().fitContent() fits the x-axis to whatever it's
    // given, so that one unclipped series alone stretches the visible range
    // back to price_start instead of the selected window (measured on the
    // live app: at range=6m, 103 of 228 benchmark bars precede the window).
    const earlyBenchmarkCloses = [
      // Dated well before RESPONSE.start (DAYS[0]) — simulates the shared
      // price_start extension fetched to price some OTHER ticker's early
      // entry (see clipToWindow's docstring).
      { date: "2025-01-01", close: 5000 },
      ...RESPONSE.benchmark_closes,
    ];
    swrData = { ...RESPONSE, benchmark_closes: earlyBenchmarkCloses };
    switchToPerformance();
    // switchToPerformance() mounts in the price view first, then clicks over
    // to performance — the chart is torn down and rebuilt (see the "tears
    // down and recreates the chart exactly once" test above), but
    // addSeriesSpy accumulates calls across BOTH chart instances. The first
    // "line"+"VOO" match would be the price view's now-torn-down benchmark
    // series, so this must find the LAST match — the live performance-view
    // chart's benchmark series — same reasoning as the crosshairSpy lookups
    // elsewhere in this describe block.
    let benchmarkIndex = -1;
    for (let i = addSeriesSpy.mock.calls.length - 1; i >= 0; i--) {
      const call = addSeriesSpy.mock.calls[i];
      if (
        (call[0] as { kind?: string }).kind === "line" &&
        (call[1] as { title?: string }).title === "VOO"
      ) {
        benchmarkIndex = i;
        break;
      }
    }
    expect(benchmarkIndex).toBeGreaterThanOrEqual(0);
    const plotted = (
      createdSeries[benchmarkIndex] as {
        setData: { mock: { calls: [{ time: string; value: number }[]][] } };
      }
    ).setData.mock.calls[0][0] as { time: string; value: number }[];
    // No bar earlier than data.start: the injected 2025-01-01 bar must be
    // gone, and the first plotted bar must be the window start itself.
    expect(plotted.every((p) => p.time >= RESPONSE.start)).toBe(true);
    expect(plotted[0].time).toBe(DAYS[0]);
    // Still a flat zero line — clipping must not touch the values, only drop
    // the pre-window bars.
    expect(plotted.every((p) => p.value === 0)).toBe(true);
  });

  it("dims baseline series via topLineColor, not color — the hover effect's baseline branch", () => {
    // BaselineSeries has no `color` option; applying one fails silently (per
    // the component's own comment), so this pins the branch that avoids that
    // and would otherwise have zero coverage. Verified to fail if the
    // `entry.baseline` branch in the hover effect were removed (that would
    // route baseline series through the `color`-only path instead).
    switchToPerformance();
    appliedOptions.length = 0;
    fireEvent.mouseEnter(screen.getByTestId("track-chip-AAA"));
    const opts = appliedOptions as { color?: string; topLineColor?: string }[];
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((o) => "topLineColor" in o)).toBe(true);
    expect(opts.every((o) => !("color" in o))).toBe(true);
  });

  it("hides the log toggle, whose signed-log transform breaks on zero-crossing values", () => {
    switchToPerformance();
    expect(screen.queryByTestId("track-scale-log")).not.toBeInTheDocument();
    expect(screen.queryByTestId("track-scale-linear")).not.toBeInTheDocument();
  });

  it("forces a linear price scale even if log was left on in the price view", () => {
    render(<ChannelTrackRecordChart channelId="ch1" />);
    fireEvent.click(screen.getByTestId("track-scale-log"));
    fireEvent.click(screen.getByTestId("track-view-performance"));
    // createChart(el, options) — index 1 is the options object, matching the
    // pre-existing "defaults the price scale to linear" test above.
    const modes = createChartSpy.mock.calls.map(
      (call) => (call[1] as { rightPriceScale?: { mode?: number } }).rightPriceScale?.mode,
    );
    expect(modes[modes.length - 1]).toBe(0); // PriceScaleMode.Normal
  });

  it("uses the centred percent formatter, not the indexed one", () => {
    switchToPerformance();
    // createChart(el, options) — index 1 is the options object.
    const opts = createChartSpy.mock.calls[
      createChartSpy.mock.calls.length - 1
    ][1] as { localization: { priceFormatter: (v: number) => string } };
    // 31.2 is already percentage points here; the indexed formatter would
    // render this as "-68.8%"
    expect(opts.localization.priceFormatter(31.2)).toBe("+31.2%");
  });

  it("draws no series for an idle run", () => {
    // AAA's first run is idle; only its buy and sell runs may become series
    switchToPerformance();
    const titles = addSeriesSpy.mock.calls
      .filter((call) => (call[0] as { kind?: string }).kind === "baseline")
      .map((call) => (call[1] as { title?: string }).title)
      .filter(Boolean);
    expect(titles.filter((t) => t === "AAA")).toHaveLength(1);
  });

  it("renders the crosshair tooltip's value with the centred formatter, not the indexed one", () => {
    // The tooltip builds its row text manually (not through the chart's own
    // localization.priceFormatter), so it has its own chance to mix up the
    // two views' value spaces. 5 is already a percentage point here; the
    // indexed formatter would misread it as "-95.0%" (5 - 100).
    switchToPerformance();
    const aaaIndex = addSeriesSpy.mock.calls.findIndex(
      (call) =>
        (call[0] as { kind?: string }).kind === "baseline" &&
        (call[1] as { title?: string }).title === "AAA",
    );
    const aaaSeries = createdSeries[aaaIndex];

    // crosshairSpy is not cleared in this describe's beforeEach (it
    // accumulates across chart (re)creations); the freshest subscription is
    // the one from the performance-view chart created by switchToPerformance.
    const crosshairHandler = crosshairSpy.mock.calls[
      crosshairSpy.mock.calls.length - 1
    ][0] as (param: unknown) => void;
    crosshairHandler({
      point: { x: 10, y: 10 },
      time: DAYS[3],
      seriesData: new Map([[aaaSeries, { value: 5 }]]),
    });

    const tooltip = screen.getByTestId("track-record-tooltip");
    expect(tooltip.textContent).toContain("+5.0%");
    expect(tooltip.textContent).not.toContain("-95.0%");
  });

  it("negates the excess series for a sell run, so a falling stock reads as a win", () => {
    // toExcessSeries' sign flip for `sell` runs is currently guarded by only
    // one unit test in lib/track-record.test.ts and had no production
    // consumer before this component. This is that consumer's own coverage:
    // confirm the data actually handed to the chart series is the negated
    // series, not just that the pure function negates in isolation.
    switchToPerformance();
    const aaaIndex = addSeriesSpy.mock.calls.findIndex(
      (call) =>
        (call[0] as { kind?: string }).kind === "baseline" &&
        (call[1] as { title?: string }).title === "AAA",
    );
    expect(aaaIndex).toBeGreaterThanOrEqual(0);
    const aaaSeries = createdSeries[aaaIndex] as {
      setData: (points: { time: string; value: number }[]) => void;
    };
    const plotted = (
      aaaSeries.setData as unknown as {
        mock: { calls: [{ time: string; value: number }[]][] };
      }
    ).mock.calls[0][0];

    // AAA's only drawable run here is its sell run (from DAYS[3], opened_at
    // DAYS[3] — see threeRunTicker; its buy run has no bar matching
    // benchmark_closes). Recompute the same run as a `buy` (long) directly
    // via toExcessSeries and assert the component plotted its negation.
    const sellRun = {
      state: "sell" as const,
      from: DAYS[3],
      to: null,
      opened_at: DAYS[3],
    };
    const longPoints = toExcessSeries(
      closes(),
      RESPONSE.benchmark_closes,
      { ...sellRun, state: "buy" as const },
    );
    expect(longPoints.length).toBeGreaterThan(0);
    expect(plotted).toEqual(
      longPoints.map((p) => ({ time: p.time, value: -p.value })),
    );
  });

  it("disables a ticker that has no position in this view, but keeps its chip", () => {
    swrData = { ...RESPONSE, tickers: [...RESPONSE.tickers, idleOnlyTicker("ZZZ")] };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    // price view: drawable, so selectable
    expect(screen.getByTestId("track-chip-ZZZ")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("track-view-performance"));
    // performance view: no position -> disabled, but still listed
    expect(screen.getByTestId("track-chip-ZZZ")).toBeInTheDocument();
    expect(screen.getByTestId("track-chip-ZZZ")).toBeDisabled();
  });

  it("drops a now-undrawable ticker from active instead of stranding it", () => {
    swrData = { ...RESPONSE, tickers: [idleOnlyTicker("ZZZ"), ...RESPONSE.tickers] };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.getByTestId("track-chip-ZZZ")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByTestId("track-view-performance"));
    // must not stay pressed-and-disabled, which the user could never clear
    expect(screen.getByTestId("track-chip-ZZZ")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows the empty state when no ticker has a position in this view", () => {
    swrData = { ...RESPONSE, tickers: [idleOnlyTicker("ZZZ")] };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.queryByText("emptyPerformance")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("track-view-performance"));
    expect(screen.getByText("emptyPerformance")).toBeInTheDocument();
  });

  it("recovers the default selection after `active` empties out and tickers become drawable again", () => {
    // A single idle-only ticker: drawable (and thus default-seeded) in the
    // price view, but undrawable in the performance view, so switching there
    // empties `active` out to a zero-size Set — not just a trimmed one.
    swrData = { ...RESPONSE, tickers: [idleOnlyTicker("ZZZ")] };
    render(<ChannelTrackRecordChart channelId="ch1" />);
    expect(screen.getByTestId("track-chip-ZZZ")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("track-view-performance"));
    // `active` is now an empty (but non-null) Set — nothing drawable here.
    expect(screen.getByTestId("track-chip-ZZZ")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("track-view-price"));
    // Back in the price view ZZZ is drawable again. The old bail
    // (`kept.size === prev.size`) matched trivially for an empty `prev`
    // (0 === 0) and returned it unchanged, so the default selection could
    // never repopulate once `active` had emptied out. It must reseed here.
    expect(screen.getByTestId("track-chip-ZZZ")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
