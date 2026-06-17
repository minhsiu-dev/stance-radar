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
      now: { win_rate: 58, avg: 4.1, median: 3.2, n: 37 },
      "30": { win_rate: 55, avg: 2, median: 1.5, n: 31 },
      "90": { win_rate: 52, avg: 1.2, median: 0.8, n: 18 },
    },
    buy: {
      now: { win_rate: 70, avg: 6, median: 5, n: 20 },
      "30": { win_rate: 60, avg: 3, median: 2, n: 18 },
      "90": { win_rate: 50, avg: 1, median: 1, n: 10 },
    },
    sell: {
      now: { win_rate: 40, avg: -1, median: -2, n: 17 },
      "30": { win_rate: 45, avg: 0.5, median: 0.2, n: 13 },
      "90": { win_rate: null, avg: null, median: null, n: 0 },
    },
  },
  counts: { all: 41, buy: 26, sell: 15 },
};

describe("ChannelPerformanceSummary", () => {
  it("renders the 'all' slice by default", () => {
    swrResponses["/api/channels/ch1/performance"] = dto;
    render(<ChannelPerformanceSummary channelId="ch1" />);
    expect(screen.getByText("58%")).toBeInTheDocument(); // all/now win rate
    expect(screen.getByText("+3.2%")).toBeInTheDocument(); // all/now median
  });

  it("switches to the buy slice when the buy filter is clicked", async () => {
    swrResponses["/api/channels/ch1/performance"] = dto;
    render(<ChannelPerformanceSummary channelId="ch1" />);
    await userEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(screen.getByText("70%")).toBeInTheDocument(); // buy/now win rate
    expect(screen.getByText("+5.0%")).toBeInTheDocument(); // buy/now median
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
