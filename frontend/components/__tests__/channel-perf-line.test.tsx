import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const swrResponses: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrResponses[key] }),
}));

import { ChannelPerfLine } from "@/components/channel-perf-line";

const emptyCell = {
  win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0,
};
const empties = { now: emptyCell, "30": emptyCell, "90": emptyCell };
const base = {
  benchmark: "VOO",
  window_days: 180,
  horizons: ["now", "30", "90"],
  summary: {
    all: empties,
    buy: {
      ...empties,
      now: { win_rate: 58, avg: 4.1, median: 3.2, avg_return: 6.5, median_return: 5.5, n: 37 },
    },
    sell: empties,
  },
  counts: { all: 50, buy: 37, sell: 13 },
};

describe("ChannelPerfLine", () => {
  it("renders buy win rate, median and sample count for the buy/now slice", () => {
    swrResponses["/api/channels/ch1/performance"] = base;
    render(<ChannelPerfLine channelId="ch1" />);
    const line = screen.getByTestId("channel-perf-line").textContent ?? "";
    expect(line).toContain("58%"); // buy win rate
    expect(line).toContain("+3.2%"); // buy median
    expect(line).toContain("37"); // sample count
  });

  it("renders nothing when there are no buy calls", () => {
    swrResponses["/api/channels/ch2/performance"] = {
      ...base,
      counts: { all: 10, buy: 0, sell: 10 },
    };
    const { container } = render(<ChannelPerfLine channelId="ch2" />);
    expect(container.querySelector('[data-testid="channel-perf-line"]')).toBeNull();
  });

  it("renders nothing when buy calls exist but none have settled returns (now.n === 0)", () => {
    swrResponses["/api/channels/ch3/performance"] = {
      ...base,
      summary: { ...base.summary, buy: { ...empties } },
      counts: { all: 5, buy: 3, sell: 2 },
    };
    const { container } = render(<ChannelPerfLine channelId="ch3" />);
    expect(
      container.querySelector('[data-testid="channel-perf-line"]'),
    ).toBeNull();
  });
});
