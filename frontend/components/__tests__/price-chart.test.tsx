import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";

const addSeriesSpy = vi.hoisted(() => vi.fn());
const setCrosshairSpy = vi.hoisted(() => vi.fn());
const clearCrosshairSpy = vi.hoisted(() => vi.fn());
vi.mock("lightweight-charts", () => {
  const series = { setData: vi.fn() };
  const chart = {
    addSeries: (...args: unknown[]) => {
      addSeriesSpy(...args);
      return series;
    },
    priceScale: () => ({ applyOptions: vi.fn() }),
    timeScale: () => ({ fitContent: vi.fn(), applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    clearCrosshairPosition: clearCrosshairSpy,
    setCrosshairPosition: setCrosshairSpy,
    remove: vi.fn(),
  };
  return {
    createChart: () => chart,
    createSeriesMarkers: vi.fn(),
    CandlestickSeries: { kind: "candlestick" },
    HistogramSeries: { kind: "histogram" },
    ColorType: { Solid: "solid" },
  };
});

const mockApiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch: mockApiFetch }));

import { PriceChart } from "@/components/price-chart";

const messages = { Errors: { candlesLoad: "Error: {message}" } };

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
    addSeriesSpy.mockClear();
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
