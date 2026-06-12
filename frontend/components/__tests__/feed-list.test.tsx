import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FeedList } from "@/components/feed-list";

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
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <FeedList />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("Video 0")).toBeInTheDocument();
    expect(await screen.findByText("No more results")).toBeInTheDocument();
  });
});
