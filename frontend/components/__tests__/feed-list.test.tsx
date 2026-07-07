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

describe("FeedList ticker filters", () => {
  it("emits one ticker query param per selected ticker", async () => {
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/channels") || key.startsWith("/api/stocks")) return Promise.resolve([]);
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
});
