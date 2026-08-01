import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addSeriesSpy = vi.hoisted(() => vi.fn());
const markersSpy = vi.hoisted(() => vi.fn());
const removeSpy = vi.hoisted(() => vi.fn());
const crosshairSpy = vi.hoisted(() => vi.fn());
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
    priceScale: () => ({ applyOptions: vi.fn() }),
    applyOptions: vi.fn(),
    remove: removeSpy,
  };
  return {
    createChart: () => chart,
    // The component calls createSeriesMarkers(series, markers) once, with markers
    // passed in directly rather than via a separate setMarkers call.
    createSeriesMarkers: (...args: unknown[]) => {
      markersSpy(...args);
      return { setMarkers: vi.fn() };
    },
    LineSeries: { kind: "line" },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    ColorType: { Solid: "solid" },
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

const DAYS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];

function closes() {
  return DAYS.map((date, i) => ({ date, close: 100 + i * 10 }));
}

/** Three segments: idle [d0,d2) → buy [d2,d3) → sell [d3,∞).
 *  The boundaries are chosen so every segment still has >= 2 points after
 *  splitRuns (segments with fewer than two points get dropped, which would
 *  make it impossible to test the faded and dotted styling). */
function threeRunTicker(name: string) {
  return {
    ticker: name,
    calls: 3,
    runs: [
      { state: "idle" as const, from: DAYS[0], to: DAYS[2] },
      { state: "buy" as const, from: DAYS[2], to: DAYS[3] },
      { state: "sell" as const, from: DAYS[3], to: null },
    ],
    markers: [
      { date: DAYS[2], stance: "buy" as const, video_id: "v1", video_title: "one" },
      { date: DAYS[3], stance: "sell" as const, video_id: "v2", video_title: "two" },
    ],
    closes: closes(),
  };
}

/** Single segment: buy all the way to today. */
function buyTicker(name: string) {
  return {
    ticker: name,
    calls: 1,
    runs: [{ state: "buy" as const, from: DAYS[0], to: null }],
    markers: [],
    closes: closes(),
  };
}

const RESPONSE = {
  benchmark: "VOO",
  range: "1y",
  start: DAYS[0],
  benchmark_closes: [
    { date: DAYS[0], close: 500 },
    { date: DAYS[3], close: 510 },
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
});
