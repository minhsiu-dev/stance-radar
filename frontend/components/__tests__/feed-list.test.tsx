import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FeedList } from "@/components/feed-list";

const messages = {
  Dashboard: {
    feed: {
      noMore: "No more results",
      loadError: "Failed: {message}",
      statusNoTranscript: "no transcript",
      statusFailed: "failed",
      statusPending: "pending",
      statusNoMentions: "no mentions",
    },
    empty: { prompt: "", linkLabel: "channels", hint: "" },
  },
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
    channel: { id: "c", title: "ch" },
    stances: [],
  };
}

describe("FeedList infinite scroll", () => {
  it("shows 'No more results' when last page is short", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      items: [makeItem(0)],
      total: 1,
      page: 1,
      page_size: PAGE_SIZE,
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
