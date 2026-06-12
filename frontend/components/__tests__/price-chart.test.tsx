import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const setCrosshair = vi.fn();
const clearCrosshair = vi.fn();
const series = { setData: vi.fn(), priceScale: vi.fn() };
const chart = {
  addSeries: () => series,
  timeScale: () => ({ fitContent: vi.fn() }),
  subscribeCrosshairMove: vi.fn(),
  subscribeClick: vi.fn(),
  setCrosshairPosition: setCrosshair,
  clearCrosshairPosition: clearCrosshair,
  remove: vi.fn(),
};

vi.mock("lightweight-charts", () => ({
  createChart: () => chart,
  CandlestickSeries: {},
  ColorType: { Solid: "solid" },
  createSeriesMarkers: vi.fn(),
}));

vi.mock("swr", () => ({
  default: (key: string) => {
    if (key.includes("candles"))
      return {
        data: [
          { date: "2026-01-02", open: 100, high: 101, low: 99, close: 100, volume: 1 },
        ],
        isLoading: false,
      };
    if (key.includes("stances"))
      return {
        data: [
          {
            video_id: "vid-1",
            video_title: "",
            channel_id: "c",
            channel_title: "",
            published_at: "2026-01-02T12:00:00Z",
            stance: "buy",
            summary: "",
          },
        ],
      };
    return { data: undefined };
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { PriceChart } from "@/components/price-chart";

describe("PriceChart hover", () => {
  it("calls setCrosshairPosition when hoveredVideoId matches a marker", () => {
    const { rerender } = render(
      <PriceChart ticker="AAPL" hoveredVideoId={null} />,
    );
    setCrosshair.mockClear();
    rerender(<PriceChart ticker="AAPL" hoveredVideoId="vid-1" />);
    expect(setCrosshair).toHaveBeenCalledWith(100, "2026-01-02", series);
  });

  it("clears crosshair when hoveredVideoId becomes null", () => {
    const { rerender } = render(
      <PriceChart ticker="AAPL" hoveredVideoId="vid-1" />,
    );
    clearCrosshair.mockClear();
    rerender(<PriceChart ticker="AAPL" hoveredVideoId={null} />);
    expect(clearCrosshair).toHaveBeenCalled();
  });
});
