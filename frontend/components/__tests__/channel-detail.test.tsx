import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ChannelDetail } from "@/components/channel-detail";

// Controllable IntersectionObserver: remember each observe's (callback, element),
// so tests can manually trigger loads against the "scroll sentinel" (the page may have multiple observers).
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

// The detail test focuses on layout/tabs/videos, so the tab children are stubbed.
vi.mock("@/components/channel-ticker-table", () => ({
  ChannelTickerTable: () => <div data-testid="ticker-table" />,
}));
vi.mock("@/components/channel-recent-feed", () => ({
  ChannelRecentFeed: () => <div data-testid="recent-feed" />,
}));
vi.mock("@/components/channel-performance-summary", () => ({
  ChannelPerformanceSummary: () => <div data-testid="perf-summary" />,
}));

// Captures the onEmptyChange callback so a test can trigger it from outside,
// simulating the chart reporting "nothing to draw".
const emptyCallback = vi.hoisted(() => ({
  fn: null as ((empty: boolean) => void) | null,
}));
vi.mock("@/components/channel-track-record-chart", () => ({
  ChannelTrackRecordChart: ({
    onEmptyChange,
  }: {
    onEmptyChange?: (empty: boolean) => void;
  }) => {
    emptyCallback.fn = onEmptyChange ?? null;
    return <div data-testid="track-record-chart" />;
  },
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

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
    trackRecord: {
      description: "Per-ticker track record",
      empty: "No data yet",
      ticker: "Ticker",
      mentions: "Mentions",
      videoCount: "{count} videos",
      distribution: "Stance mix",
      latest: "Latest",
      winRate: "Win rate",
      avgAlpha: "Avg excess",
      samples: "n",
    },
    trackRecordChart: {
      showTable: "Show full data table",
      hideTable: "Hide data table",
    },
    recent: {
      empty: "No mentions yet",
    },
    performance: {
      title: "Last 180 days vs VOO",
      filter: { all: "All" },
      columns: {
        period: "Period",
        winRate: "Win rate",
        avg: "Avg excess",
        median: "Median",
        samples: "n",
      },
      empty: "No directional calls in the last 180 days",
      error: "Couldn't load performance",
    },
    tabs: {
      tickers: "Track record",
      recent: "Latest mentions",
      videos: "Videos tab",
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
      now: "Now",
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
    if (key.includes("/performance")) return Promise.resolve({
      benchmark: "VOO", window_days: 180, horizons: ["now", 30, 90],
      summary: {
        all: { now: { win_rate: null, avg: null, median: null, n: 0 }, "30": { win_rate: null, avg: null, median: null, n: 0 }, "90": { win_rate: null, avg: null, median: null, n: 0 } },
        buy: { now: { win_rate: null, avg: null, median: null, n: 0 }, "30": { win_rate: null, avg: null, median: null, n: 0 }, "90": { win_rate: null, avg: null, median: null, n: 0 } },
        sell: { now: { win_rate: null, avg: null, median: null, n: 0 }, "30": { win_rate: null, avg: null, median: null, n: 0 }, "90": { win_rate: null, avg: null, median: null, n: 0 } },
      },
      counts: { all: 0, buy: 0, sell: 0 },
    });
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

/** Simulate backend pagination: total videos, page_size per page. */
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
  // afterEach's unstubAllGlobals restores IntersectionObserver, so reinstall before each test
  beforeEach(() => {
    observed = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the header and the full-width performance card", async () => {
    renderDetail();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    // The performance summary sits full-width above the tabs.
    expect(screen.getByTestId("perf-summary")).toBeInTheDocument();
  });

  it("defaults to the track-record (個股戰績) tab", async () => {
    renderDetail();
    // The chart leads the tab and is visible without clicking a tab (the table
    // stays collapsed by default, so it's not a valid proxy for "tab is active" anymore):
    expect(await screen.findByTestId("track-record-chart")).toBeInTheDocument();
  });

  it("shows the recent feed after switching to the recent tab", async () => {
    renderDetail();
    expect(await screen.findByTestId("track-record-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("recent-feed")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: "Latest mentions" }));
    expect(screen.getByTestId("recent-feed")).toBeInTheDocument();
  });

  it("lists videos with status labels and recovery action for skipped", async () => {
    renderDetail();
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("Skipped video")).toBeInTheDocument();
    // "Skipped" appears in both the stat card and the badge → use getAllByText
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
    // Skipped videos have an "undo" button
    expect(
      screen.getByRole("button", { name: "Analyze" }),
    ).toBeInTheDocument();
  });

  it("loads videos in pages of 50 via infinite scroll", async () => {
    const fetcher = renderDetail(pagedVideos(120));
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    // First page: 50 videos + counter + scroll sentinel (no "load more" button)
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    expect(screen.getByText("Video 50")).toBeInTheDocument();
    expect(screen.queryByText("Video 51")).not.toBeInTheDocument();
    expect(screen.getByText("50 of 120 loaded")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("load-more-sentinel")).toBeInTheDocument();

    // Cross-page batch selection: videos checked on the first page must stay checked after loading the second page
    const firstCheckbox = screen.getByRole("checkbox", { name: "Video 1" });
    fireEvent.click(firstCheckbox);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    // Scroll to the sentinel → auto-load the next page
    scrollToSentinel();
    expect(await screen.findByText("Video 51")).toBeInTheDocument();
    expect(screen.getByText("Video 100")).toBeInTheDocument();
    expect(screen.getByText("100 of 120 loaded")).toBeInTheDocument();
    // First-page selections persist across pages
    expect(screen.getByRole("checkbox", { name: "Video 1" })).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    // Confirm the second page was fetched with page=2
    expect(
      fetcher.mock.calls.some(
        ([key]) =>
          typeof key === "string" &&
          key.includes("/videos") &&
          key.includes("page=2"),
      ),
    ).toBe(true);
    // There's still a third page (100<120) → the sentinel remains and "load older" doesn't appear yet
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

    // Click again to deselect all
    fireEvent.click(selectAll);
    expect(screen.queryByText("3 selected")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Video 1" })).not.toBeChecked();
  });

  it("shows load-older (no sentinel) when every video is loaded", async () => {
    renderDetail(); // default fixture: total 2, items 2
    // switch to videos tab first (scorecard is now the default)
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 loaded")).toBeInTheDocument();
    // Everything loaded → no more scroll sentinel, replaced by the "load older" button
    expect(screen.queryByTestId("load-more-sentinel")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Load older videos" }),
    ).toBeInTheDocument();
  });

  it("revalidates the video list after a skip action", async () => {
    // act() goes through apiFetch → global fetch; returns a success envelope
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

    // Discovered videos have a Skip button
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    // After a successful skip, the video list must be re-fetched (the useSWRInfinite $inf$ key must also be hit by mutate)
    await waitFor(() => {
      expect(videoCalls()).toBeGreaterThan(before);
    });
  });

  it("POSTs to load-older and re-enables when the job finishes", async () => {
    // POST /load-older → {job_id, created:true}; /api/jobs/current → non-running
    // so the poll ends immediately. loadOlder goes entirely through apiFetch → global fetch.
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

    // The POST should be made with the correct URL + method
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

    // The button becomes usable again after the job finishes
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
    // 個股戰績 is the default — videos content not yet visible
    expect(await screen.findByTestId("track-record-chart")).toBeInTheDocument();
    expect(screen.queryByText("Analyzed video")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: "Videos tab" }));
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
  });

  it("hides write controls (toggle, checkboxes, load-older, row actions) when not authenticated, keeping the video list visible", async () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    renderDetail();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("auto-analyze-toggle")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    // Read-only video content stays visible
    expect(await screen.findByText("Analyzed video")).toBeInTheDocument();
    expect(screen.getByText("Skipped video")).toBeInTheDocument();
    // Write affordances are gone
    expect(screen.queryByTestId("select-all")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Analyze" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load older videos" }),
    ).not.toBeInTheDocument();
  });

  it("routes a 401 during a skip action back through handleAuthError", async () => {
    const handleAuthError = vi.fn();
    useAdmin.mockReturnValue({ authenticated: true, handleAuthError });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ success: false, error: "Unauthorized" }),
      }),
    );
    renderDetail(pagedVideos(1));
    fireEvent.click(await screen.findByRole("tab", { name: /Videos tab/i }));
    expect(await screen.findByText("Video 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(handleAuthError).toHaveBeenCalledTimes(1);
    });
    const [err] = handleAuthError.mock.calls[0];
    expect(err).toMatchObject({ status: 401 });
  });
});

describe("ChannelDetail tickers tab", () => {
  it("leads with the chart and keeps the table collapsed until asked", async () => {
    renderDetail();
    expect(await screen.findByTestId("track-record-chart")).toBeInTheDocument();
    // Collapsed by default -> not rendered, so ChannelTickerTable's useSWRInfinite never fires a request.
    expect(screen.queryByTestId("ticker-table")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-ticker-table"));
    expect(screen.getByTestId("ticker-table")).toBeInTheDocument();
  });

  it("expands the table when the chart has nothing to draw", async () => {
    renderDetail();
    await screen.findByTestId("track-record-chart");
    act(() => emptyCallback.fn?.(true));
    expect(screen.getByTestId("ticker-table")).toBeInTheDocument();
  });
});
