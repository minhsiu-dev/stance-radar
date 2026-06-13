import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { LatestVideos } from "@/components/latest-videos";

const messages = {
  Dashboard: {
    latest: "Latest videos",
    viewAll: "View all →",
    feed: {
      loadError: "Failed: {message}",
      statusNoTranscript: "no transcript",
      statusFailed: "failed",
      statusPending: "pending",
      statusNoMentions: "no mentions",
      dropped: "Ignored: {tickers}",
      droppedHint: "could not validate",
    },
    empty: { prompt: "No videos yet", linkLabel: "channels", hint: "" },
  },
  Stock: { stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" } },
};

function item(i: number) {
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

function wrap(fetcher: (key: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <LatestVideos />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("LatestVideos", () => {
  it("requests at most 5 and renders cards + a view-all link", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      items: [item(1), item(2)],
      total: 2,
      page: 1,
      page_size: 5,
    });
    wrap(fetcher);
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    expect(screen.getByText("Video 2")).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]: string[]) => url.includes("page_size=5"))).toBe(true);
    const viewAll = screen.getByRole("link", { name: "View all →" });
    expect(viewAll.getAttribute("href")).toContain("/videos");
  });

  it("shows empty prompt when there are no videos", async () => {
    wrap(vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 }));
    expect(await screen.findByText("No videos yet")).toBeInTheDocument();
  });
});
