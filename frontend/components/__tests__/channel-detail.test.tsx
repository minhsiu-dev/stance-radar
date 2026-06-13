import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      loadMore: "Load more",
      loaded: "{loaded} of {total} loaded",
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

function renderDetail(videosForKey?: (key: string) => unknown) {
  const fetcher = vi.fn().mockImplementation((key: string) => {
    if (key.includes("/videos")) {
      return Promise.resolve(videosForKey ? videosForKey(key) : videos);
    }
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
  return fetcher;
}

function makeVideo(n: number, status = "discovered") {
  return {
    id: `vid${n}`, title: `Video ${n}`, thumbnail_url: "",
    published_at: "2026-06-08T12:00:00Z", duration_seconds: 600,
    status, error_message: null, analyzed_at: null,
    dropped_tickers: [], stances: [],
  };
}

/** 模擬後端分頁:total 部影片,每頁 page_size 部。 */
function pagedVideos(total: number) {
  return (key: string) => {
    const params = new URLSearchParams(key.split("?")[1]);
    const page = Number(params.get("page") ?? "1");
    const pageSize = Number(params.get("page_size") ?? "50");
    const start = (page - 1) * pageSize;
    return {
      total,
      page,
      page_size: pageSize,
      items: Array.from(
        { length: Math.max(0, Math.min(pageSize, total - start)) },
        (_, i) => makeVideo(start + i + 1),
      ),
    };
  };
}

describe("ChannelDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("loads videos in pages of 50 with a load-more button", async () => {
    const fetcher = renderDetail(pagedVideos(120));
    // 第一頁:50 部影片 + 計數器 + 載入更多按鈕
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    expect(screen.getByText("Video 50")).toBeInTheDocument();
    expect(screen.queryByText("Video 51")).not.toBeInTheDocument();
    expect(screen.getByText("50 of 120 loaded")).toBeInTheDocument();

    // 跨頁批次選取:第一頁勾的影片,載入第二頁後要保持勾選
    const firstCheckbox = screen.getByRole("checkbox", { name: "Video 1" });
    fireEvent.click(firstCheckbox);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Video 51")).toBeInTheDocument();
    expect(screen.getByText("Video 100")).toBeInTheDocument();
    expect(screen.getByText("100 of 120 loaded")).toBeInTheDocument();
    // 第一頁勾選跨頁仍保留
    expect(screen.getByRole("checkbox", { name: "Video 1" })).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    // 確認第二頁是用 page=2 取的
    expect(
      fetcher.mock.calls.some(
        ([key]) =>
          typeof key === "string" &&
          key.includes("/videos") &&
          key.includes("page=2"),
      ),
    ).toBe(true);
    // 還有第三頁 → 按鈕仍在
    expect(
      screen.getByRole("button", { name: "Load more" }),
    ).toBeInTheDocument();
  });

  it("hides load-more when every video is loaded", async () => {
    renderDetail(); // 預設 fixture:total 2、items 2
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 loaded")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("revalidates the video list after a skip action", async () => {
    // act() 走 apiFetch → global fetch;回傳成功 envelope
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { skipped: 1 } }),
      }),
    );
    const fetcher = renderDetail(pagedVideos(1));
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    const videoCalls = () =>
      fetcher.mock.calls.filter(
        ([key]) =>
          typeof key === "string" &&
          key.includes("/videos") &&
          key.includes("page=1"),
      ).length;
    const before = videoCalls();

    // discovered 影片有 Skip 按鈕
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    // skip 成功後必須重新抓影片清單(useSWRInfinite 的 $inf$ key 也要被 mutate 命中)
    await waitFor(() => {
      expect(videoCalls()).toBeGreaterThan(before);
    });
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
