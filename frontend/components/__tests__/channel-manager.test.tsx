import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ChannelManager } from "@/components/channel-manager";
import type { ChannelOverviewItem, ChannelOverviewResponse, ChannelPerformanceDto } from "@/lib/types";

// Controllable IntersectionObserver: remember each observe's (callback, element) so the test
// can manually fire the scroll sentinel (mirrors the channel-detail infinite-scroll test).
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

beforeEach(() => {
  observed = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

const messages = {
  Channels: {
    list: {
      empty: "No channels",
      lastUpdated: "Updated {date}",
      neverUpdated: "Never",
      remove: "Remove",
      removeFailed: "Delete failed",
      removePrompt: "Remove {name}?",
      pendingBadge: "{count} review",
      autoBadge: "Auto",
      analyzedCount: "{count} analyzed",
    },
    activity: { legend: "published / analyzed", tooltip: "{total} pub · {analyzed} an", weekOf: "Week of {date}" },
  },
};

function item(id: string): ChannelOverviewItem {
  return {
    id,
    title: `Channel ${id}`,
    thumbnail_url: "",
    auto_analyze: false,
    added_at: "2026-06-01T00:00:00Z",
    last_refreshed_at: null,
    video_counts: { analyzed: 3 },
    weekly_activity: [
      { week_start: "2026-05-18", total: 1, analyzed: 1 },
      { week_start: "2026-05-25", total: 0, analyzed: 0 },
      { week_start: "2026-06-01", total: 2, analyzed: 1 },
      { week_start: "2026-06-08", total: 0, analyzed: 0 },
      { week_start: "2026-06-15", total: 1, analyzed: 0 },
    ],
  };
}

// total 15: page 1 returns 10 items, page 2 returns 5.
function page(n: number): ChannelOverviewResponse {
  const ids =
    n === 1
      ? Array.from({ length: 10 }, (_, i) => `a${i + 1}`)
      : Array.from({ length: 5 }, (_, i) => `b${i + 1}`);
  return { items: ids.map(item), total: 15, page: n, page_size: 10 };
}

const zeroPerfDto: ChannelPerformanceDto = {
  benchmark: "VOO",
  window_days: 180,
  horizons: ["now", "30", "90"],
  summary: {
    all: {
      now: { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
      "30": { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
      "90": { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
    },
    buy: {
      now: { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
      "30": { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
      "90": { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
    },
    sell: {
      now: { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
      "30": { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
      "90": { win_rate: null, avg: null, median: null, avg_return: null, median_return: null, n: 0 },
    },
  },
  counts: { all: 0, buy: 0, sell: 0 },
};

function wrap() {
  const fetcher = vi.fn((key: string) => {
    if (key.includes("/performance")) return Promise.resolve(zeroPerfDto);
    const p = new URL(key, "http://x").searchParams.get("page") ?? "1";
    return Promise.resolve(page(Number(p)));
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ChannelManager />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return fetcher;
}

describe("ChannelManager", () => {
  it("renders the first page with activity bars and loads more on scroll", async () => {
    wrap();
    // First page rows + bars (10 rows × 5 bars).
    expect(await screen.findByText("Channel a1")).toBeInTheDocument();
    expect(screen.getByText("Channel a10")).toBeInTheDocument();
    expect(screen.getAllByTestId("bar-total").length).toBe(50);
    // Page 2 not loaded yet.
    expect(screen.queryByText("Channel b1")).not.toBeInTheDocument();

    // Scroll the sentinel into view → next page appends.
    scrollToSentinel();
    expect(await screen.findByText("Channel b1")).toBeInTheDocument();
    expect(screen.getByText("Channel b5")).toBeInTheDocument();

    // All 15 loaded → sentinel gone (no further pages).
    await waitFor(() =>
      expect(screen.queryByTestId("load-more-sentinel")).not.toBeInTheDocument(),
    );
  });

  it("shows the Remove button when authenticated", async () => {
    wrap();
    expect(await screen.findByText("Channel a1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" }).length).toBeGreaterThan(0);
  });

  it("hides the Remove button when not authenticated", async () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    wrap();
    expect(await screen.findByText("Channel a1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("routes a 401 from a failed remove back through handleAuthError", async () => {
    const handleAuthError = vi.fn();
    useAdmin.mockReturnValue({ authenticated: true, handleAuthError });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ success: false, error: "Unauthorized" }),
      }),
    );
    wrap();
    const removeBtn = (await screen.findAllByRole("button", { name: "Remove" }))[0];
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(handleAuthError).toHaveBeenCalledTimes(1);
    });
    const [err] = handleAuthError.mock.calls[0];
    expect(err).toMatchObject({ status: 401 });
  });
});
