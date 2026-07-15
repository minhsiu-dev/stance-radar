import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";

const addSeriesSpy = vi.hoisted(() => vi.fn());
const setCrosshairSpy = vi.hoisted(() => vi.fn());
const clearCrosshairSpy = vi.hoisted(() => vi.fn());
const paneSetHeightSpy = vi.hoisted(() => vi.fn());
const crosshairMoveSpy = vi.hoisted(() => vi.fn());
const createdSeries = vi.hoisted(
  () =>
    [] as Array<{ setData: Mock; priceScale: () => { applyOptions: Mock } }>,
);
vi.mock("lightweight-charts", () => {
  const chart = {
    addSeries: (...args: unknown[]) => {
      addSeriesSpy(...args);
      const s = {
        setData: vi.fn(),
        priceScale: () => ({ applyOptions: vi.fn() }),
      };
      createdSeries.push(s);
      return s;
    },
    panes: () => [{ setHeight: vi.fn() }, { setHeight: paneSetHeightSpy }],
    priceScale: () => ({ applyOptions: vi.fn() }),
    timeScale: () => ({ fitContent: vi.fn(), applyOptions: vi.fn() }),
    subscribeCrosshairMove: crosshairMoveSpy,
    subscribeClick: vi.fn(),
    clearCrosshairPosition: clearCrosshairSpy,
    setCrosshairPosition: setCrosshairSpy,
    remove: vi.fn(),
  };
  return {
    createChart: () => chart,
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
    CandlestickSeries: { kind: "candlestick" },
    HistogramSeries: { kind: "histogram" },
    ColorType: { Solid: "solid" },
  };
});

const mockApiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch: mockApiFetch }));

import { createSeriesMarkers } from "lightweight-charts";
import { PriceChart } from "@/components/price-chart";

const messages = {
  Errors: { candlesLoad: "Error: {message}" },
  Stock: { stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" } },
};

function makeFetcher(candleClose: number[]) {
  return (url: string) => {
    if (url.includes("candles")) {
      return Promise.resolve(
        candleClose.map((close, i) => ({
          time: `2026-01-0${i + 1}`,
          open: close,
          high: close + 10,
          low: close - 10,
          close,
          volume: 1,
        })),
      );
    }
    return Promise.resolve([]);
  };
}

// candles on 06-05(Fri) 06-08(Mon) 06-09(Tue); one buy on Mon, one sell on Mon, one neutral out of range
function makeStanceFetcher() {
  return (url: string) => {
    if (url.includes("candles")) {
      return Promise.resolve(
        ["2026-06-05", "2026-06-08", "2026-06-09"].map((time, i) => ({
          time, open: 10 + i, high: 12 + i, low: 9 + i, close: 10 + i, volume: 1,
        })),
      );
    }
    if (url.includes("stances")) {
      return Promise.resolve([
        { video_id: "vBuy", video_title: "b", channel_id: "c", channel_title: "C",
          published_at: "2026-06-08T00:00:00Z", stance: "buy", summary: "s", confidence: null },
        { video_id: "vSell", video_title: "s", channel_id: "c", channel_title: "C",
          published_at: "2026-06-08T10:00:00Z", stance: "sell", summary: "s", confidence: null },
        { video_id: "vOld", video_title: "o", channel_id: "c", channel_title: "C",
          published_at: "2026-05-01T00:00:00Z", stance: "neutral", summary: "s", confidence: null },
      ]);
    }
    return Promise.resolve([]);
  };
}

function renderChart() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ provider: () => new Map() }}>
        <PriceChart ticker="NVDA" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  addSeriesSpy.mockClear();
  paneSetHeightSpy.mockClear();
  crosshairMoveSpy.mockClear();
  createdSeries.length = 0;
});

describe("PriceChart", () => {
  it("renders all nine range buttons", async () => {
    mockApiFetch.mockImplementation(makeFetcher([105]));

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <PriceChart ticker="AAPL" />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    for (const r of ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"]) {
      expect(await screen.findByRole("button", { name: r })).toBeInTheDocument();
    }
  });

  it("displays period gain in green when positive", async () => {
    mockApiFetch.mockImplementation(makeFetcher([100, 110]));

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <PriceChart ticker="AAPL" />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    const pct = await screen.findByText(/\+10\.00%/);
    expect(pct.className).toMatch(/emerald/);
  });

  it("adds a volume histogram series", async () => {
    mockApiFetch.mockImplementation(makeFetcher([100, 110]));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <PriceChart ticker="AAPL" />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    await screen.findByText(/\+10\.00%/);
    expect(addSeriesSpy).toHaveBeenCalledWith({ kind: "histogram" }, expect.anything());
  });

  it("clears the crosshair when hovering a row with no marker in range (no stale highlight)", async () => {
    setCrosshairSpy.mockClear();
    clearCrosshairSpy.mockClear();
    const cache = new Map();
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("candles")) {
        return Promise.resolve(
          ["2026-06-05", "2026-06-08", "2026-06-09"].map((time, i) => ({
            time,
            open: 10 + i,
            high: 12 + i,
            low: 9 + i,
            close: 10 + i, // distinct closes → non-zero delta so the chart renders
            volume: 1,
          })),
        );
      }
      if (url.includes("stances")) {
        return Promise.resolve([
          // in range (2026-06-08 is a candle day) → has a marker
          { video_id: "vIn", video_title: "in", channel_id: "c", channel_title: "C",
            published_at: "2026-06-08T00:00:00Z", stance: "buy", summary: "s", confidence: null },
          // published before the first candle → snapToTradingDay returns null → NO marker
          { video_id: "vOut", video_title: "out", channel_id: "c", channel_title: "C",
            published_at: "2026-05-01T00:00:00Z", stance: "sell", summary: "s", confidence: null },
        ]);
      }
      return Promise.resolve([]);
    });

    const Harness = ({ hovered }: { hovered?: string }) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ provider: () => cache }}>
          <PriceChart ticker="AAPL" hoveredVideoId={hovered} />
        </SWRConfig>
      </NextIntlClientProvider>
    );

    const { rerender } = render(<Harness />);
    // wait until the chart is built (candlestick + volume series added)
    await waitFor(() => expect(addSeriesSpy).toHaveBeenCalled());

    // hover an in-range row → crosshair is positioned on its date
    setCrosshairSpy.mockClear();
    clearCrosshairSpy.mockClear();
    rerender(<Harness hovered="vIn" />);
    await waitFor(() => expect(setCrosshairSpy).toHaveBeenCalledTimes(1));

    // now hover a row with no marker in range → must CLEAR, not leave the stale highlight
    setCrosshairSpy.mockClear();
    clearCrosshairSpy.mockClear();
    rerender(<Harness hovered="vOut" />);
    await waitFor(() => expect(clearCrosshairSpy).toHaveBeenCalled());
    expect(setCrosshairSpy).not.toHaveBeenCalled();
  });
});

describe("stance histogram pane", () => {
  it("adds three cumulative histogram series in pane 1 (sell→neutral→buy draw order) and sets pane height", async () => {
    mockApiFetch.mockImplementation(makeStanceFetcher());
    renderChart();
    await waitFor(() =>
      expect(addSeriesSpy).toHaveBeenCalledWith(
        { kind: "histogram" }, expect.anything(), 1,
      ),
    );
    const paneCalls = addSeriesSpy.mock.calls.filter((c) => c[2] === 1);
    expect(paneCalls.map((c) => c[1].color)).toEqual([
      "#f97316", // total → sell color, drawn first (back)
      "#a1a1aa", // buy+neutral → neutral color
      "#0ea5e9", // buy → buy color, drawn last (front)
    ]);
    expect(paneSetHeightSpy).toHaveBeenCalledWith(64);

    // cumulative stacking data: buy=1, sell=1 on 2026-06-08.
    // NOTE: slice(-3) not slice(2) — SWR 兩支 fetch 到達時序不定,chart 可能先以
    // 無 stances 重建一次(多出 candle+volume 兩個 series),取「最後三個」才穩。
    const [total, buyNeutral, buy] = createdSeries.slice(-3);
    await waitFor(() => expect(buy.setData).toHaveBeenCalled());
    expect(total.setData.mock.calls.at(-1)![0]).toEqual([
      { time: "2026-06-08", value: 2 },
    ]);
    expect(buyNeutral.setData.mock.calls.at(-1)![0]).toEqual([
      { time: "2026-06-08", value: 1 },
    ]);
    expect(buy.setData.mock.calls.at(-1)![0]).toEqual([
      { time: "2026-06-08", value: 1 },
    ]);
  });

  it("does not create the pane when the stock has no stances", async () => {
    mockApiFetch.mockImplementation(makeFetcher([100, 110]));
    renderChart();
    await screen.findByText(/\+10\.00%/);
    expect(addSeriesSpy.mock.calls.every((c) => c[2] !== 1)).toBe(true);
  });

  it("does not create the pane on intraday ranges", async () => {
    mockApiFetch.mockImplementation(makeStanceFetcher());
    const user = (await import("@testing-library/user-event")).default.setup();
    renderChart();
    await waitFor(() =>
      expect(addSeriesSpy).toHaveBeenCalledWith({ kind: "histogram" }, expect.anything(), 1),
    );
    addSeriesSpy.mockClear();
    await user.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(addSeriesSpy).toHaveBeenCalled()); // chart rebuilt
    expect(addSeriesSpy.mock.calls.every((c) => c[2] !== 1)).toBe(true);
  });

  it("no longer renders series markers on the candlesticks", async () => {
    mockApiFetch.mockImplementation(makeStanceFetcher());
    renderChart();
    await waitFor(() => expect(addSeriesSpy).toHaveBeenCalled());
    expect(createSeriesMarkers).not.toHaveBeenCalled();
  });

  it("shows a tooltip with per-stance counts when the crosshair is over a day with data", async () => {
    mockApiFetch.mockImplementation(makeStanceFetcher());
    renderChart();
    await waitFor(() =>
      expect(addSeriesSpy).toHaveBeenCalledWith({ kind: "histogram" }, expect.anything(), 1),
    );
    const cb = crosshairMoveSpy.mock.calls.at(-1)![0];

    act(() => cb({ time: "2026-06-08", point: { x: 40, y: 10 } }));
    const tip = screen.getByTestId("stance-tooltip");
    expect(tip.style.display).toBe("block");
    expect(tip).toHaveTextContent("2026-06-08");
    expect(tip).toHaveTextContent("Buy 1");
    expect(tip).toHaveTextContent("Neutral 0");
    expect(tip).toHaveTextContent("Sell 1");

    // day without data (or leaving the chart) hides it
    act(() => cb({ time: "2026-06-09", point: { x: 60, y: 10 } }));
    expect(tip.style.display).toBe("none");
    act(() => cb({ time: "2026-06-08", point: { x: 40, y: 10 } }));
    act(() => cb({ time: undefined, point: undefined }));
    expect(tip.style.display).toBe("none");
  });
});
