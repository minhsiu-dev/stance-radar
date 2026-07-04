import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FeedList, NO_FILTERS, type FeedFilters } from "@/components/feed-list";

// Privacy mock — mutate `privacy` object per-test to control locked/ready
const privacy = { locked: false, ready: true };
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => privacy,
}));

const messages = {
  Dashboard: {
    feed: {
      noMore: "No more results",
      noMatch: "No videos match",
      dropped: "Ignored: {tickers}",
      droppedHint: "could not validate",
      loadError: "Failed: {message}",
      statusNoTranscript: "no transcript",
      statusFailed: "failed",
      statusPending: "pending",
      statusNoMentions: "no mentions",
      filter: {
        allChannels: "All channels",
        allTickers: "All stocks",
        allStances: "All stances",
        holdingsOnly: "Holdings only",
        active: "Filtering:",
        tickersSelected: "{count} selected",
      },
    },
    empty: { prompt: "", linkLabel: "channels", hint: "" },
  },
  Stock: { stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" } },
};

const PAGE_SIZE = 20;

function makeItem(i: number) {
  return {
    video_id: `v${i}`,
    title: `Video ${i}`,
    thumbnail_url: "",
    published_at: "2026-06-10T00:00:00Z",
    status: "analyzed",
    error_message: null,
    dropped_tickers: [],
    channel: { id: "c", title: "ch" },
    stances: [],
  };
}

// FeedList is now a controlled component; tests use a small stateful wrapper to provide filters/onFiltersChange
function ControlledFeedList({ initial = NO_FILTERS }: { initial?: FeedFilters }) {
  const [filters, setFilters] = useState<FeedFilters>(initial);
  return <FeedList filters={filters} onFiltersChange={setFilters} />;
}

function wrap(fetcher: (key: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ControlledFeedList />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("FeedList infinite scroll", () => {
  it("shows 'No more results' when last page is short", async () => {
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/channels")) return Promise.resolve([]);
      if (key.startsWith("/api/stocks")) return Promise.resolve([]);
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [], totals: HOLDINGS_TOTALS });
      return Promise.resolve({
        items: [makeItem(0)],
        total: 1,
        page: 1,
        page_size: PAGE_SIZE,
      });
    });
    wrap(fetcher);
    expect(await screen.findByText("Video 0")).toBeInTheDocument();
    expect(await screen.findByText("No more results")).toBeInTheDocument();
  });
});

const HOLDINGS_TOTALS = {
  market_value: 1,
  cost_basis: 1,
  unrealized_pl: 0,
  unrealized_pl_percent: 0,
};

describe("FeedList holdings-only chip", () => {
  it("shows chip and sets holdings_only=true when clicked", async () => {
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [{ ticker: "AAPL" }], totals: HOLDINGS_TOTALS });
      if (key.startsWith("/api/channels")) return Promise.resolve([]);
      if (key.startsWith("/api/stocks")) return Promise.resolve([]);
      // Return one item so FeedList renders the filter bar (not the empty-state card)
      return Promise.resolve({ items: [makeItem(0)], total: 1, page: 1, page_size: PAGE_SIZE });
    });

    wrap(fetcher);

    const chip = await screen.findByRole("button", { name: "Holdings only" });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(
        fetcher.mock.calls.some(([url]: string[]) => url.includes("holdings_only=true")),
      ).toBe(true);
    });
  });

  it("emits one ticker query param per selected ticker", async () => {
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/channels") || key.startsWith("/api/stocks")) return Promise.resolve([]);
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [], totals: HOLDINGS_TOTALS });
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: PAGE_SIZE });
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <ControlledFeedList initial={{ ...NO_FILTERS, tickers: ["AAPL", "NVDA"] }} />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      expect(
        fetcher.mock.calls.some(
          ([u]: string[]) => u.includes("ticker=AAPL") && u.includes("ticker=NVDA"),
        ),
      ).toBe(true);
    });
  });

  it("removes a ticker when its chip is clicked", async () => {
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/channels") || key.startsWith("/api/stocks")) return Promise.resolve([]);
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [], totals: HOLDINGS_TOTALS });
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: PAGE_SIZE });
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <ControlledFeedList initial={{ ...NO_FILTERS, tickers: ["AAPL"] }} />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    const chip = await screen.findByTestId("active-ticker-chip");
    expect(chip.textContent).toContain("AAPL");
    fireEvent.click(chip);
    await waitFor(() => {
      expect(screen.queryByTestId("active-ticker-chip")).toBeNull();
    });
  });

  it("does not render chip when holdings list is empty", async () => {
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [], totals: HOLDINGS_TOTALS });
      if (key.startsWith("/api/channels")) return Promise.resolve([]);
      if (key.startsWith("/api/stocks")) return Promise.resolve([]);
      // Return one item so FeedList renders the filter bar (not the empty-state card)
      return Promise.resolve({ items: [makeItem(0)], total: 1, page: 1, page_size: PAGE_SIZE });
    });

    wrap(fetcher);

    // Wait for feed items to appear (filter bar is rendered), then check chip is absent
    await screen.findByText("Video 0");

    // Wait for holdings fetch to settle
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith("/api/portfolio/holdings");
    });

    expect(screen.queryByRole("button", { name: "Holdings only" })).toBeNull();
  });
});

describe("FeedList holdings privacy", () => {
  it("does NOT fetch holdings when Hide Holdings is on", async () => {
    privacy.locked = true;
    privacy.ready = true;
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/channels")) return Promise.resolve([]);
      if (key.startsWith("/api/stocks")) return Promise.resolve([]);
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [{ ticker: "AAA" }], totals: HOLDINGS_TOTALS });
      return Promise.resolve({ items: [makeItem(0)], total: 1, page: 1, page_size: PAGE_SIZE });
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <ControlledFeedList />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    // Wait for the feed to render
    await screen.findByText("Video 0");
    // Holdings must not have been fetched and the filter button must be absent
    expect(fetcher).not.toHaveBeenCalledWith("/api/portfolio/holdings");
    expect(screen.queryByTestId("feed-filter-holdings")).not.toBeInTheDocument();
  });

  it("fetches holdings and shows the filter when not hidden", async () => {
    privacy.locked = false;
    privacy.ready = true;
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/channels")) return Promise.resolve([]);
      if (key.startsWith("/api/stocks")) return Promise.resolve([]);
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [{ ticker: "AAA" }], totals: HOLDINGS_TOTALS });
      return Promise.resolve({ items: [makeItem(0)], total: 1, page: 1, page_size: PAGE_SIZE });
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <ControlledFeedList />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    await screen.findByText("Video 0");
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith("/api/portfolio/holdings");
    });
  });
});
