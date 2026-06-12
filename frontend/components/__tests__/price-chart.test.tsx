import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";

vi.mock("lightweight-charts", () => {
  const series = { setData: vi.fn() };
  const chart = {
    addSeries: () => series,
    timeScale: () => ({ fitContent: vi.fn(), applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    clearCrosshairPosition: vi.fn(),
    setCrosshairPosition: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: () => chart,
    createSeriesMarkers: vi.fn(),
    CandlestickSeries: {},
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
});
