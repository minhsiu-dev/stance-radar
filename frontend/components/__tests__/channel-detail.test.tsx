import { fireEvent, render, screen } from "@testing-library/react";
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
    autoAnalyze: {
      on: "Auto-analyze: on",
      off: "Auto-analyze: off",
      hint: "auto analyze hint",
    },
    stats: {
      analyzed: "Analyzed",
      discovered: "Awaiting review",
      skipped: "Skipped",
      failed: "Failed",
      no_transcript: "No transcript",
      pending: "Queued",
    },
    topTickers: {
      title: "Most mentioned",
      empty: "No data yet",
      ticker: "Ticker",
      mentions: "Mentions",
      videoCount: "{count} videos",
      distribution: "Stance mix",
      latest: "Latest",
    },
    tabs: {
      videos: "Videos tab",
      scorecard: "Scorecard tab",
    },
    videos: {
      title: "Videos",
      filterAll: "All statuses",
      selectedCount: "{count} selected",
      analyzeSelected: "Analyze selected",
      skipSelected: "Skip selected",
      analyze: "Analyze",
      retry: "Retry",
      reanalyze: "Re-analyze",
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
  Stock: {
    stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" },
  },
  Scorecard: {
    title: "Scorecard",
    description: "vs {benchmark}",
    loading: "Computing…",
    loadError: "Failed: {message}",
    empty: "No calls yet.",
    afterDays: "{days}d after call",
    vsBenchmark: "excess {value}",
    winRate: "win rate {value}",
    sampleCount: "{count} calls",
    noData: "no data",
    columns: {
      date: "Date",
      ticker: "Ticker",
      stance: "Stance",
      horizon: "{days}d",
    },
  },
};

const detail = {
  id: "UC_a",
  title: "Alpha",
  thumbnail_url: "",
  auto_analyze: false,
  added_at: "2026-06-01T00:00:00Z",
  last_refreshed_at: "2026-06-10T00:00:00Z",
  status_counts: { analyzed: 2, skipped: 1 },
  top_tickers: [
    {
      ticker: "AAPL",
      videos: 2,
      buy: 2,
      neutral: 0,
      sell: 0,
      latest_stance: "buy",
      latest_date: "2026-06-08",
    },
  ],
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
      analyzed_at: "2026-06-09T00:00:00Z", dropped_tickers: [],
      stances: [
        { ticker: "AAPL", stance: "buy", summary: "bullish", confidence: "high" },
      ],
    },
    {
      id: "v2", title: "Skipped video", thumbnail_url: "",
      published_at: "2026-06-07T12:00:00Z", duration_seconds: null,
      status: "skipped", error_message: null, analyzed_at: null,
      dropped_tickers: [], stances: [],
    },
  ],
};

const emptyHorizon = {
  count: 0, avg_return: null, avg_alpha: null, win_rate: null,
};
const scorecard = {
  horizons: [7, 30, 90],
  benchmark: "SPY",
  aggregates: {
    buy: { total: 0, horizons: { 7: emptyHorizon, 30: emptyHorizon, 90: emptyHorizon } },
    sell: { total: 0, horizons: { 7: emptyHorizon, 30: emptyHorizon, 90: emptyHorizon } },
  },
  calls: [],
};

function renderDetail() {
  const fetcher = vi.fn().mockImplementation((key: string) => {
    if (key.includes("/videos")) return Promise.resolve(videos);
    if (key.includes("/scorecard")) return Promise.resolve(scorecard);
    return Promise.resolve(detail);
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ChannelDetail channelId="UC_a" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("ChannelDetail", () => {
  it("renders stats and the most-mentioned table", async () => {
    renderDetail();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Most mentioned")).toBeInTheDocument();
    // top-tickers 表格的 ticker 連到個股頁
    const link = screen.getByRole("link", { name: "AAPL" });
    expect(link.getAttribute("href")).toContain("/stocks/AAPL");
    expect(screen.getByTestId("stance-bar-AAPL")).toBeInTheDocument();
  });

  it("lists videos with status labels and recovery action for skipped", async () => {
    renderDetail();
    // 預設分頁是 videos,影片清單直接可見
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("Skipped video")).toBeInTheDocument();
    // "Skipped" 同時出現在統計卡與 badge → 用 getAllByText
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
    // skipped 影片有「反悔」按鈕
    expect(
      screen.getByRole("button", { name: "Analyze" }),
    ).toBeInTheDocument();
  });

  it("shows the scorecard only after switching to its tab", async () => {
    renderDetail();
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    // scorecard 內容藏在非預設分頁
    expect(screen.queryByText("No calls yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Scorecard tab" }));
    expect(await screen.findByText("No calls yet.")).toBeInTheDocument();
  });
});
