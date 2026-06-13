import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FeedList, NO_FILTERS, type FeedFilters } from "@/components/feed-list";

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

// FeedList 改為受控元件;測試用小型 stateful wrapper 提供 filters/onFiltersChange
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
