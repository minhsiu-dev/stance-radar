import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const swrResponses: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrResponses[key] }),
}));

vi.mock("@/components/channel-leaderboard", () => ({
  alphaColor: (v: number | null) => (v == null ? "muted" : v > 0 ? "pos" : "neg"),
}));

import { ChannelPerformanceSummary } from "@/components/channel-performance-summary";

const dto = {
  benchmark: "VOO",
  window_days: 180,
  horizons: ["now", "30", "90"],
  summary: {
    all: {
      now: { win_rate: 41, avg: -1.5, median: -1.2, avg_return: -2.7, median_return: -2.1, n: 68 },
      "30": { win_rate: 38, avg: -0.9, median: -0.6, avg_return: -1.8, median_return: -1.3, n: 60 },
      "90": { win_rate: 30, avg: -3.4, median: -2.9, avg_return: -7.1, median_return: -6.6, n: 24 },
    },
    buy: {
      now: { win_rate: 70, avg: 6.3, median: 5.4, avg_return: 9.1, median_return: 8.2, n: 20 },
      "30": { win_rate: 61, avg: 2.9, median: 1.6, avg_return: 4.7, median_return: 3.8, n: 18 },
      "90": { win_rate: 52, avg: 0.7, median: 0.4, avg_return: 1.2, median_return: 0.9, n: 10 },
    },
    sell: {
      now: { win_rate: 33, avg: -3, median: -2, avg_return: -4, median_return: -3, n: 12 },
      "30": { win_rate: 45, avg: 0.5, median: 0.2, avg_return: 0.8, median_return: 0.6, n: 13 },
      "90": { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
    },
  },
  counts: { all: 41, buy: 26, sell: 15 },
};

describe("ChannelPerformanceSummary", () => {
  it("renders the buy slice by default", () => {
    swrResponses["/api/channels/ch1/performance"] = dto;
    render(<ChannelPerformanceSummary channelId="ch1" />);
    expect(screen.getByText("70%")).toBeInTheDocument(); // buy/now win rate
    expect(screen.getByText("+9.1%")).toBeInTheDocument(); // buy/now avg return
    expect(screen.getByText("+8.2%")).toBeInTheDocument(); // buy/now median return
    expect(screen.getByText("+5.4%")).toBeInTheDocument(); // buy/now median excess
  });

  it("switches to the all slice when the all filter is clicked", async () => {
    swrResponses["/api/channels/ch1/performance"] = dto;
    render(<ChannelPerformanceSummary channelId="ch1" />);
    await userEvent.click(screen.getByRole("button", { name: "filter.all" }));
    expect(screen.getByText("41%")).toBeInTheDocument(); // all/now win rate
    expect(screen.getByText("-2.7%")).toBeInTheDocument(); // all/now avg return
  });

  it("shows the empty state when the slice has no calls", () => {
    swrResponses["/api/channels/ch2/performance"] = {
      ...dto,
      counts: { all: 0, buy: 0, sell: 0 },
    };
    render(<ChannelPerformanceSummary channelId="ch2" />);
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
