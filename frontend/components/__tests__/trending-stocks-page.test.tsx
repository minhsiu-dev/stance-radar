import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { TrendingStocksPage, segmentParams } from "@/components/trending-stocks-page";

const messages = {
  Trending: {
    title: "Trending stocks",
    freshness: "Freshness",
    countWindow: "Count window",
    coverage: "Coverage",
    week: "1W", month: "1M", quarter: "3M",
    segAll: "All",
    segEmerging: "Emerging 2–3",
    segForming: "Forming 4–6",
    segHot: "Popular 7+",
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

// Offset-aware fetcher that mimics the paginated /trending endpoint.
function pagedFetcher(all: typeof STOCK[]) {
  return (url: string) => {
    const params = new URL(url, "http://x").searchParams;
    const offset = Number(params.get("offset") ?? 0);
    const limit = Number(params.get("limit") ?? 20);
    return Promise.resolve(all.slice(offset, offset + limit));
  };
}

describe("TrendingStocksPage", () => {
  it("fetches with default freshness + count_days and renders cards", async () => {
    const fetcher = vi.fn().mockResolvedValue([STOCK]);
    wrap(fetcher);
    expect(await screen.findByTestId("recent-stock-card")).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("days=30") && u.includes("count_days=90"))).toBe(true);
    // default coverage segment is "all" -> no channel-count bounds
    expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("min_channels") || u.includes("max_channels"))).toBe(false);
    // triggers show window labels, not raw day-count numbers
    expect(screen.getAllByText("1M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("3M").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("30")).toBeNull();
    expect(screen.queryByText("90")).toBeNull();
  });

  // Note: a test that drives the new coverage dropdown to "All" and asserts the key
  // drops min_channels/max_channels was attempted but skipped — Radix Select's
  // onValueChange does not fire under jsdom's pointer-event model, so the click
  // never changes the segment. The band->params mapping is instead covered directly
  // by the `segmentParams` unit tests below.

  it("shows the empty state when no stocks come back", async () => {
    wrap(vi.fn().mockResolvedValue([]));
    expect(await screen.findByText("No stocks")).toBeInTheDocument();
  });

  it("fetches only the first page (20) initially and shows a load-more sentinel", async () => {
    const stocks = Array.from({ length: 25 }, (_, i) => ({ ...STOCK, ticker: `T${i}` }));
    wrap(pagedFetcher(stocks));
    await screen.findAllByTestId("recent-stock-card");
    expect(screen.getAllByTestId("recent-stock-card")).toHaveLength(20); // first page only
    expect(screen.getByTestId("trending-load-more")).toBeInTheDocument(); // full page -> maybe more
  });

  it("renders all cards without a sentinel when the first page is short", async () => {
    const stocks = Array.from({ length: 8 }, (_, i) => ({ ...STOCK, ticker: `T${i}` }));
    wrap(pagedFetcher(stocks));
    await screen.findAllByTestId("recent-stock-card");
    expect(screen.getAllByTestId("recent-stock-card")).toHaveLength(8);
    expect(screen.queryByTestId("trending-load-more")).toBeNull(); // short page -> end
  });
});

describe("segmentParams", () => {
  it("maps each coverage band to the right channel-count query fragment", () => {
    expect(segmentParams("all")).toBe(""); // unbounded -> neither param
    expect(segmentParams("emerging")).toBe("&min_channels=2&max_channels=3");
    expect(segmentParams("forming")).toBe("&min_channels=4&max_channels=6");
    expect(segmentParams("hot")).toBe("&min_channels=7"); // open-ended -> min only
  });
});
