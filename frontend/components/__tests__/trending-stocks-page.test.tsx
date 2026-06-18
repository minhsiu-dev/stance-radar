import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { TrendingStocksPage } from "@/components/trending-stocks-page";

const messages = {
  Trending: {
    title: "Trending stocks",
    freshness: "Freshness",
    countWindow: "Count window",
    week: "1W", month: "1M", quarter: "3M",
    empty: "No stocks",
  },
  Dashboard: { recentStocks: { channelCount: "{count} channels" } },
};

function zone(n: number) {
  return { count: n, avatars: Array.from({ length: Math.min(n, 3) }, (_, i) => ({ title: `C${i}`, thumbnail_url: "" })) };
}
const STOCK = {
  ticker: "NVDA", channel_count: 3, mention_count: 5, score: 1, last_mentioned_at: "2026-06-11T00:00:00Z",
  stances: { buy: zone(3), neutral: zone(0), sell: zone(0) }, buckets: [],
};

function wrap(fetcher: (url: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <TrendingStocksPage />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("TrendingStocksPage", () => {
  it("fetches with default freshness + count_days and renders cards", async () => {
    const fetcher = vi.fn().mockResolvedValue([STOCK]);
    wrap(fetcher);
    expect(await screen.findByTestId("recent-stock-card")).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("days=30") && u.includes("count_days=90"))).toBe(true);
    // triggers show window labels, not raw day-count numbers
    expect(screen.getAllByText("1M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("3M").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("30")).toBeNull();
    expect(screen.queryByText("90")).toBeNull();
  });

  it("shows the empty state when no stocks come back", async () => {
    wrap(vi.fn().mockResolvedValue([]));
    expect(await screen.findByText("No stocks")).toBeInTheDocument();
  });
});
