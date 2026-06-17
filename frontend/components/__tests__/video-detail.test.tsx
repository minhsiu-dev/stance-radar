import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { VideoDetail } from "@/components/video-detail";

vi.mock("@/components/youtube-player", () => ({
  YouTubePlayer: () => <div data-testid="yt-player-mock" />,
}));

vi.mock("@/components/video-scorecard", () => ({
  VideoScorecard: () => <div data-testid="video-scorecard-mock" />,
}));

const nav = vi.hoisted(() => ({ params: new URLSearchParams("") }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useSearchParams: () => nav.params,
}));

const messages = {
  VideoDetail: {
    loadError: "Failed: {message}",
    notFound: "Video not found",
    watchOnYoutube: "Open on YouTube",
    mentionCount: "{count} mentions",
    stockCount: "{count} stocks",
    noMentions: "No mentions",
    callPerformance: "Call performance",
    byStock: "By stock",
    quotesByTime: "Quotes",
  },
  Stock: {
    stance: { buy: "Buy", neutral: "Neutral", sell: "Sell" },
  },
};

const DATA = {
  video: {
    id: "vid1",
    title: "My Video",
    channel: { id: "c1", title: "Channel One", thumbnail_url: "" },
    published_at: "2026-06-10T00:00:00Z",
    duration_seconds: 900,
    status: "analyzed",
  },
  groups: [
    {
      ticker: "AAPL", stance: "buy", summary: "Bullish", confidence: "high",
      mentions: [
        { start_seconds: 134, quote: "up", excerpt: null, stance: "buy", confidence: "high", time_horizon: null, is_conditional: null, condition: null },
      ],
    },
  ],
};

function wrap(fetcher: (key: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <VideoDetail videoId="vid1" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("VideoDetail", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams("");
  });

  it("renders the title, player and the scorecard tab by default", async () => {
    wrap(vi.fn().mockResolvedValue(DATA));
    expect(await screen.findByText("My Video")).toBeInTheDocument();
    expect(screen.getByTestId("yt-player-mock")).toBeInTheDocument();
    // default tab = scorecard
    expect(screen.getByTestId("video-scorecard-mock")).toBeInTheDocument();
    // all three tab triggers exist
    expect(screen.getByRole("tab", { name: "Call performance" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "By stock" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Quotes" })).toBeInTheDocument();
  });

  it("shows not-found when fetch 404s", async () => {
    const err = Object.assign(new Error("404"), { status: 404 });
    wrap(vi.fn().mockRejectedValue(err));
    expect(await screen.findByText("Video not found")).toBeInTheDocument();
  });

  it("opens the by-stock tab when a ?ticker is present", async () => {
    nav.params = new URLSearchParams("ticker=AAPL");
    wrap(vi.fn().mockResolvedValue(DATA));
    // by-stock tab is default -> its card summary renders; scorecard tab is not active
    expect(await screen.findByText("Bullish")).toBeInTheDocument();
    expect(screen.queryByTestId("video-scorecard-mock")).toBeNull();
  });
});
