import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { VideoCard } from "@/components/video-card";
import type { FeedItem } from "@/lib/types";

const messages = {
  Dashboard: {
    feed: {
      statusNoTranscript: "no transcript",
      statusFailed: "failed",
      statusPending: "pending",
      statusNoMentions: "no mentions",
      dropped: "Ignored: {tickers}",
      droppedHint: "could not validate",
    },
  },
  Stock: { stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" } },
};

const ITEM: FeedItem = {
  video_id: "vid9",
  title: "Hello Video",
  thumbnail_url: "",
  published_at: "2026-06-10T00:00:00Z",
  status: "analyzed",
  error_message: null,
  dropped_tickers: [],
  channel: { id: "c1", title: "Chan" },
  stances: [{ ticker: "AAPL", stance: "buy", confidence: "high", summary: "Bullish AAPL" }],
};

function wrap(item: FeedItem) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VideoCard item={item} />
    </NextIntlClientProvider>,
  );
}

describe("VideoCard", () => {
  it("links the title to the internal video page (not YouTube)", () => {
    wrap(ITEM);
    const title = screen.getByRole("link", { name: "Hello Video" });
    expect(title.getAttribute("href")).toContain("/videos/vid9");
    expect(title.getAttribute("href")).not.toContain("youtube.com");
  });

  it("links a stance tag to the stock's mentions, deep-linking the video", () => {
    wrap(ITEM);
    const tag = screen.getByTitle("Bullish AAPL");
    expect(tag.getAttribute("href")).toContain("/stocks/AAPL");
    expect(tag.getAttribute("href")).toContain("video=vid9");
    expect(tag.getAttribute("href")).not.toContain("/videos/vid9");
  });
});
