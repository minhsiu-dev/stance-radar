import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { VideoScorecard } from "@/components/video-scorecard";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  VideoDetail: { callPerformance: "Call performance" },
  Scorecard: {
    empty: "No buy/sell stances to score yet.",
    loadError: "Failed: {message}",
    vsBenchmark: "α {value}",
    noData: "no data",
    columns: { date: "Date", ticker: "Ticker", stance: "Stance", horizon: "{days}d", now: "Now" },
  },
  Stock: { stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" } },
};

const SCORECARD = {
  horizons: [30, 90],
  benchmark: "VOO",
  total: 1,
  page: 1,
  page_size: 1,
  calls: [
    {
      video_id: "v1", video_title: "t", ticker: "AAPL", stance: "buy",
      confidence: null, summary: "s", published_at: "2026-01-10T00:00:00Z",
      entry_date: "2026-01-12", entry_price: 100,
      returns: { "30": 8.2, "90": null }, alpha: { "30": 1.4, "90": null },
      now_return: 15.0, now_alpha: 2.0, has_data: true,
    },
  ],
};

function wrap(data: unknown) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher: vi.fn().mockResolvedValue(data), provider: () => new Map() }}>
        <VideoScorecard videoId="v1" channelId="c1" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("VideoScorecard", () => {
  it("renders ticker/stance/Now/30d/90d with α and no date column", async () => {
    wrap(SCORECARD);
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Ticker", "Stance", "Now", "30d", "90d"]);
    expect(screen.getByText("+15.00%")).toBeInTheDocument();
    expect(screen.getByText("α +2.00%")).toBeInTheDocument();
    expect(screen.getByText("+8.20%")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "AAPL" }).getAttribute("href"),
    ).toBe("/stocks/AAPL?channel=c1");
  });

  it("shows the empty state when there are no calls", async () => {
    wrap({ horizons: [30, 90], benchmark: "VOO", total: 0, page: 1, page_size: 1, calls: [] });
    expect(await screen.findByText("No buy/sell stances to score yet.")).toBeInTheDocument();
  });
});
