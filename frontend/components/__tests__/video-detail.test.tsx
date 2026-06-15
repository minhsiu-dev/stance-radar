import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { VideoDetail } from "@/components/video-detail";

vi.mock("@/components/youtube-player", () => ({
  YouTubePlayer: () => <div data-testid="yt-player-mock" />,
}));

// No ?ticker by default
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(""),
}));

const messages = {
  VideoDetail: {
    loadError: "Failed: {message}",
    notFound: "Video not found",
    backToVideos: "Back",
    watchOnYoutube: "Open on YouTube",
    mentionsHeading: "Mentions & stances",
    mentionCount: "{count} mentions",
    jumpHint: "jump",
    noMentions: "No mentions",
    viewStock: "Stock page",
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
      ticker: "AAPL",
      stance: "buy",
      summary: "Bullish",
      confidence: "high",
      mentions: [
        { start_seconds: 134, quote: "up", stance: "buy", confidence: "high", time_horizon: null, is_conditional: null, condition: null },
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
  it("renders the title, player and grouped mentions", async () => {
    wrap(vi.fn().mockResolvedValue(DATA));
    expect(await screen.findByText("My Video")).toBeInTheDocument();
    expect(screen.getByTestId("yt-player-mock")).toBeInTheDocument();
    expect(screen.getByText("Bullish")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2:14" })).toBeInTheDocument();
  });

  it("shows not-found when fetch 404s", async () => {
    const err = Object.assign(new Error("404"), { status: 404 });
    wrap(vi.fn().mockRejectedValue(err));
    expect(await screen.findByText("Video not found")).toBeInTheDocument();
  });

  it("renders the player and mentions in a two-column layout", async () => {
    wrap(vi.fn().mockResolvedValue(DATA));
    expect(await screen.findByTestId("yt-player-mock")).toBeInTheDocument();
    expect(screen.getByText("My Video")).toBeInTheDocument();
    expect(screen.getByText("Bullish")).toBeInTheDocument(); // a mention group
  });
});
