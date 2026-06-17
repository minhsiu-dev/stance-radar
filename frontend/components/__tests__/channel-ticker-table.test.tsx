import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const swrResponses: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrResponses[key], error: undefined }),
}));

import { ChannelTickerTable } from "@/components/channel-ticker-table";

const rows = [
  { ticker: "AAA", videos: 3, buy: 2, neutral: 1, sell: 0, latest_stance: "buy",
    latest_date: "2026-06-01", win_rate: 66.7, avg_alpha: 4.2, n: 3 },
  { ticker: "BBB", videos: 9, buy: 1, neutral: 0, sell: 8, latest_stance: "sell",
    latest_date: "2026-06-10", win_rate: 25.0, avg_alpha: -3.1, n: 8 },
  { ticker: "CCC", videos: 1, buy: 0, neutral: 1, sell: 0, latest_stance: "neutral",
    latest_date: "2026-05-01", win_rate: null, avg_alpha: null, n: 0 },
];

function tickerOrder(): string[] {
  return screen.getAllByTestId(/^ticker-row-/).map((el) => el.getAttribute("data-ticker")!);
}

describe("ChannelTickerTable", () => {
  it("renders one row per ticker, default sorted by video count desc", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    expect(tickerOrder()).toEqual(["BBB", "AAA", "CCC"]);
  });

  it("renders an em dash for tickers with no realized perf", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    const ccc = screen.getByTestId("ticker-row-CCC");
    expect(within(ccc).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("re-sorts by win rate when the win-rate header is clicked", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    fireEvent.click(screen.getByRole("button", { name: "winRate" }));
    // desc: AAA (66.7), BBB (25.0), then null last (CCC)
    expect(tickerOrder()).toEqual(["AAA", "BBB", "CCC"]);
  });
});
