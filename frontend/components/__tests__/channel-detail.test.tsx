import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ChannelDetail } from "@/components/channel-detail";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  ChannelDetail: {
    loadError: "Failed: {message}",
    added: "Added: {date}",
    stats: {
      analyzed: "Analyzed",
      discovered: "Awaiting review",
      skipped: "Skipped",
      failed: "Failed",
      no_transcript: "No transcript",
      pending: "Queued",
      topTickers: "Most mentioned stocks",
      noTickers: "No mentions yet",
    },
    videos: {
      title: "Videos",
      filterAll: "All statuses",
      selectedCount: "{count} selected",
      analyzeSelected: "Analyze selected",
      skipSelected: "Skip selected",
      analyze: "Analyze",
      retry: "Retry",
      skip: "Skip",
      empty: "No videos.",
      actionFailed: "Action failed: {message}",
      queued: "Queued for analysis",
      status: {
        discovered: "Awaiting review",
        pending: "Queued",
        analyzed: "Analyzed",
        no_transcript: "No transcript",
        failed: "Failed",
        skipped: "Skipped",
      },
    },
  },
  Channels: {
    list: { lastUpdated: "Last updated: {date}", neverUpdated: "Never updated" },
  },
};

const detail = {
  id: "UC_a",
  title: "Alpha",
  thumbnail_url: "",
  added_at: "2026-06-01T00:00:00Z",
  last_refreshed_at: "2026-06-10T00:00:00Z",
  status_counts: { analyzed: 2, skipped: 1 },
  top_tickers: [{ ticker: "AAPL", videos: 2, buy: 2, neutral: 0, sell: 0 }],
};

const videos = {
  total: 2,
  page: 1,
  page_size: 50,
  items: [
    {
      id: "v1", title: "Analyzed video", thumbnail_url: "",
      published_at: "2026-06-08T12:00:00Z", duration_seconds: 600,
      status: "analyzed", error_message: null,
      analyzed_at: "2026-06-09T00:00:00Z",
      stances: [{ ticker: "AAPL", stance: "buy", summary: "bullish" }],
    },
    {
      id: "v2", title: "Skipped video", thumbnail_url: "",
      published_at: "2026-06-07T12:00:00Z", duration_seconds: null,
      status: "skipped", error_message: null, analyzed_at: null,
      stances: [],
    },
  ],
};

function renderDetail() {
  const fetcher = vi.fn().mockImplementation((key: string) =>
    key.includes("/videos")
      ? Promise.resolve(videos)
      : Promise.resolve(detail),
  );
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ChannelDetail channelId="UC_a" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("ChannelDetail", () => {
  it("renders stats and top tickers", async () => {
    renderDetail();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Most mentioned stocks")).toBeInTheDocument();
    // AAPL 出現在 top tickers 與 stance badge 兩處
    expect((await screen.findAllByText(/AAPL/)).length).toBeGreaterThan(0);
  });

  it("lists videos with status labels and recovery action for skipped", async () => {
    renderDetail();
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("Skipped video")).toBeInTheDocument();
    // "Skipped" 同時出現在統計卡與 badge → 用 getAllByText
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
    // skipped 影片有「反悔」按鈕
    expect(
      screen.getByRole("button", { name: "Analyze" }),
    ).toBeInTheDocument();
  });
});
