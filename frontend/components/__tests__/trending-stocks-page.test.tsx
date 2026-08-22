import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { TrendingStocksPage, minChannelsParam } from "@/components/trending-stocks-page";

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));
vi.mock("@/components/holdings-dialog", () => ({ HoldingsDialog: () => null }));

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

const messages = {
  Trending: {
    title: "Trending stocks",
    freshness: "Freshness",
    countWindow: "Count window",
    minChannels: "Min channels",
    week: "1W", month: "1M", quarter: "3M",
    minAll: "Any", min2: "2 or more", min3: "3 or more", min5: "5 or more",
    empty: "No stocks",
    weighted: "Weight by win rate",
    excludeHeld: "Exclude held",
  },
  Dashboard: { recentStocks: { channelCount: "{count} channels", scoreBreakdown: "{channels} channels · {days}d ago" } },
  Stock: { stance: { buy: "Buy", neutral: "Neutral", sell: "Sell", new: "New", repeat: "Repeat" } },
};

function zone(n: number) {
  return { count: n, avatars: Array.from({ length: Math.min(n, 3) }, (_, i) => ({ title: `C${i}`, thumbnail_url: "" })) };
}
const STOCK = {
  ticker: "NVDA", channel_count: 3, buy_channel_count: 3, video_count: 5, watch_score: 2.5,
  last_mentioned_at: "2026-06-11T00:00:00Z", last_buy_at: "2026-06-11T00:00:00Z",
  channel_win_rate_avg: null,
  stances: { buy: zone(3), neutral: zone(0), sell: zone(0) }, buckets: [],
  held: null,
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
    // default min-channels band is "all" -> no channel-count bound
    expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("min_channels"))).toBe(false);
    // triggers show window labels, not raw day-count numbers
    expect(screen.getAllByText("1M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("3M").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("30")).toBeNull();
    expect(screen.queryByText("90")).toBeNull();
  });

  // Note: a test that drives the min-channels dropdown and asserts the key changes
  // min_channels was attempted but skipped — Base UI Select's onValueChange does not
  // fire under jsdom's pointer-event model, so the click never changes the value. The
  // band->params mapping is instead covered directly by the `minChannelsParam` unit
  // tests below.

  it("always requests the score ordering", async () => {
    const fetcher = vi.fn().mockResolvedValue([STOCK]);
    wrap(fetcher);
    await screen.findByTestId("recent-stock-card");
    // Scope to the trending-list calls: the shared mock fetcher also serves
    // useSparklines' /api/stocks/sparklines requests, which never carry `sort`.
    const trendingUrls = fetcher.mock.calls
      .map(([u]: string[]) => u)
      .filter((u: string) => u.includes("/api/stocks/trending"));
    expect(trendingUrls.length).toBeGreaterThan(0);
    expect(trendingUrls.every((u: string) => u.includes("sort=score"))).toBe(true);
  });

  it("requests weighting by default and drops it when toggled off", async () => {
    const fetcher = vi.fn().mockResolvedValue([STOCK]);
    wrap(fetcher);
    await screen.findByTestId("recent-stock-card");
    // the API default is weighted=true, so the URL should not carry an override
    expect(fetcher.mock.calls.every(([u]: string[]) => !u.includes("weighted=false"))).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: "Weight by win rate" }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("weighted=false"))).toBe(true),
    );
  });

  it("hides the exclude-held toggle while locked", async () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    const fetcher = vi.fn().mockResolvedValue([STOCK]);
    wrap(fetcher);
    await screen.findByTestId("recent-stock-card");
    expect(screen.queryByRole("switch", { name: "Exclude held" })).toBeNull();
    expect(fetcher.mock.calls.every(([u]: string[]) => !u.includes("exclude_held"))).toBe(true);
  });

  it("sends exclude_held when the toggle is on", async () => {
    const fetcher = vi.fn().mockResolvedValue([STOCK]);
    wrap(fetcher);
    await screen.findByTestId("recent-stock-card");
    fireEvent.click(screen.getByRole("switch", { name: "Exclude held" }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("exclude_held=true"))).toBe(true),
    );
  });

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

  it("fetches batched sparklines for loaded tickers and overlays the price line", async () => {
    const BUCKET = {
      start: "2026-06-01T00:00:00+00:00", end: "2026-06-08T00:00:00+00:00",
      granularity: "week",
      buy_new: 2, buy_repeat: 0, neutral_new: 0, neutral_repeat: 0, sell_new: 0, sell_repeat: 0,
    };
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("/api/stocks/sparklines")) {
        return { NVDA: [{ date: "2026-06-02", close: 100 }, { date: "2026-06-05", close: 105 }] };
      }
      return [{ ...STOCK, buckets: [BUCKET] }];
    });
    const { container } = wrap(fetcher);
    await screen.findByTestId("recent-stock-card");
    await waitFor(() => {
      expect(container.querySelector('[data-testid="price-line"]')).toBeInTheDocument();
    });
    const sparkUrl = fetcher.mock.calls.map(([u]: string[]) => u).find((u) => u.includes("/sparklines"));
    expect(sparkUrl).toContain("tickers=NVDA");
    expect(sparkUrl).toContain("days=90"); // count window default
  });
});

describe("minChannelsParam", () => {
  it("maps the min-channel bands to query params", () => {
    expect(minChannelsParam("all")).toBe("");
    expect(minChannelsParam("min2")).toBe("&min_channels=2");
    expect(minChannelsParam("min3")).toBe("&min_channels=3");
    expect(minChannelsParam("min5")).toBe("&min_channels=5");
  });
});
