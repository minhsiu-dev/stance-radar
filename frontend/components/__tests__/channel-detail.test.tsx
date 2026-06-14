import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ChannelDetail } from "@/components/channel-detail";

// 可控的 IntersectionObserver:記住每個 observe 的 (callback, element),
// 讓測試針對「捲動 sentinel」手動觸發載入(頁面上可能有多個 observer)。
let observed: { cb: IntersectionObserverCallback; el: Element }[] = [];
class MockIntersectionObserver {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    observed.push({ cb: this.cb, el });
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function scrollToSentinel() {
  const hits = observed.filter(
    (o) => o.el?.getAttribute?.("data-testid") === "load-more-sentinel",
  );
  const hit = hits[hits.length - 1];
  act(() => {
    hit?.cb(
      [{ isIntersecting: true, target: hit.el } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

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
      scorecard: "Latest mentions",
    },
    videos: {
      title: "Videos",
      filterAll: "All statuses",
      selectedCount: "{count} selected",
      analyzeSelected: "Analyze selected",
      skipSelected: "Skip selected",
      selectAll: "Select all",
      analyze: "Analyze",
      retry: "Retry",
      reanalyze: "Re-analyze",
      skip: "Skip",
      empty: "No videos.",
      actionFailed: "Action failed: {message}",
      queued: "Queued for analysis",
      loadMore: "Load more",
      loaded: "{loaded} of {total} loaded",
      loadOlder: "Load older videos",
      loadingOlder: "Loading…",
      loadOlderBusy: "Another update is running, try again shortly",
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
    title: "Latest mentions",
    description: "vs {benchmark}",
    loading: "Computing…",
    loadError: "Failed: {message}",
    empty: "No calls yet.",
    vsBenchmark: "excess {value}",
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

const scorecard = {
  horizons: [7, 30, 90],
  benchmark: "SPY",
  calls: [],
  total: 0,
  page: 1,
  page_size: 20,
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
  // afterEach 的 unstubAllGlobals 會還原 IntersectionObserver,故每個 test 前重裝
  beforeEach(() => {
    observed = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });
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

  it("defaults to the scorecard (最新提及) tab", async () => {
    renderDetail();
    // scorecard panel should be visible without clicking a tab:
    expect(await screen.findByTestId("channel-scorecard")).toBeInTheDocument();
  });

  it("lists videos with status labels and recovery action for skipped", async () => {
    renderDetail();
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("Skipped video")).toBeInTheDocument();
    // "Skipped" 同時出現在統計卡與 badge → 用 getAllByText
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
    // skipped 影片有「反悔」按鈕
    expect(
      screen.getByRole("button", { name: "Analyze" }),
    ).toBeInTheDocument();
  });

  it("loads videos in pages of 50 via infinite scroll", async () => {
    const fetcher = renderDetail(pagedVideos(120));
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    // 第一頁:50 部影片 + 計數器 + 捲動 sentinel(沒有「載入更多」按鈕)
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    expect(screen.getByText("Video 50")).toBeInTheDocument();
    expect(screen.queryByText("Video 51")).not.toBeInTheDocument();
    expect(screen.getByText("50 of 120 loaded")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("load-more-sentinel")).toBeInTheDocument();

    // 跨頁批次選取:第一頁勾的影片,載入第二頁後要保持勾選
    const firstCheckbox = screen.getByRole("checkbox", { name: "Video 1" });
    fireEvent.click(firstCheckbox);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    // 捲到 sentinel → 自動載入下一頁
    scrollToSentinel();
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
    // 還有第三頁(100<120)→ sentinel 仍在、還不會出現「載入更舊」
    expect(screen.getByTestId("load-more-sentinel")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load older videos" }),
    ).not.toBeInTheDocument();
  });

  it("select-all toggles every actionable loaded video at once", async () => {
    renderDetail(pagedVideos(3)); // 3 discovered videos
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    expect(await screen.findByText("Video 1")).toBeInTheDocument();

    const selectAll = screen.getByTestId("select-all");
    fireEvent.click(selectAll);

    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Video 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Video 3" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Analyze selected" })).toBeInTheDocument();

    // 再點一次全部取消
    fireEvent.click(selectAll);
    expect(screen.queryByText("3 selected")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Video 1" })).not.toBeChecked();
  });

  it("shows load-older (no sentinel) when every video is loaded", async () => {
    renderDetail(); // 預設 fixture:total 2、items 2
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 loaded")).toBeInTheDocument();
    // 全部載完 → 不再有捲動 sentinel,改成「載入更舊」按鈕
    expect(screen.queryByTestId("load-more-sentinel")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Load older videos" }),
    ).toBeInTheDocument();
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
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
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

  it("POSTs to load-older and re-enables when the job finishes", async () => {
    // POST /load-older → {job_id, created:true};/api/jobs/current → 非 running
    // 讓 poll 立即結束。loadOlder 全程走 apiFetch → global fetch。
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/load-older")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ success: true, data: { job_id: 7, created: true } }),
        });
      }
      // /api/jobs/current
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 7, kind: "load_older", status: "done", progress: {} },
          }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDetail(pagedVideos(1));
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    const btn = await screen.findByRole("button", { name: "Load older videos" });
    fireEvent.click(btn);

    // POST 應以正確 URL + method 打出
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            typeof url === "string" &&
            url === "/api/channels/UC_a/load-older" &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });

    // 工作完成後按鈕重新可用
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load older videos" }),
      ).not.toBeDisabled();
    });
  });

  it("shows a busy message when load-older is rejected (created:false)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ success: true, data: { job_id: 3, created: false } }),
      }),
    );
    renderDetail(pagedVideos(1));
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Load older videos" }),
    );
    expect(
      await screen.findByText("Another update is running, try again shortly"),
    ).toBeInTheDocument();
  });

  it("shows video list only after switching to the videos tab", async () => {
    renderDetail();
    // scorecard is the default — videos content not yet visible
    expect(await screen.findByTestId("channel-scorecard")).toBeInTheDocument();
    expect(screen.queryByText("Analyzed video")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: "Videos tab" }));
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
  });
});
