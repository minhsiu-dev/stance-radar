import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ChannelScorecard } from "@/components/channel-scorecard";

const messages = {
  Scorecard: {
    title: "Latest mentions",
    description: "vs {benchmark}",
    loading: "Computing…",
    loadError: "Failed: {message}",
    empty: "No buy/sell stances to score yet.",
    vsBenchmark: "excess {value}",
    noData: "no data",
    columns: { date: "Date", ticker: "Ticker", stance: "Stance", horizon: "{days}d" },
  },
  Stock: { stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" } },
};

const PAGE_SIZE = 20;

function makeCall(i: number) {
  return {
    video_id: `v${i}`,
    video_title: `t${i}`,
    ticker: `TK${i}`,
    stance: "buy" as const,
    confidence: null,
    summary: "s",
    published_at: "2026-06-10T00:00:00Z",
    entry_date: "2026-06-11",
    entry_price: 100,
    returns: { "7": 8.2, "30": null, "90": null },
    alpha: { "7": 1.4, "30": null, "90": null },
    has_data: true,
  };
}

function page(n: number, count: number) {
  return {
    horizons: [7, 30, 90],
    benchmark: "VOO",
    total: 23,
    page: n,
    page_size: PAGE_SIZE,
    calls: Array.from({ length: count }, (_, k) => makeCall((n - 1) * PAGE_SIZE + k)),
  };
}

// Capturing IntersectionObserver mock so the test can drive page 2.
let ioCb: IntersectionObserverCallback | null = null;
beforeEach(() => {
  ioCb = null;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: IntersectionObserverCallback) { ioCb = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function wrap(fetcher: (key: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ChannelScorecard channelId="ch1" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("ChannelScorecard", () => {
  it("renders the first page with return % and inline alpha", async () => {
    const fetcher = vi.fn(async () => page(1, PAGE_SIZE));
    wrap(fetcher);
    expect(await screen.findByText("TK0")).toBeInTheDocument();
    expect(screen.getAllByText("+8.20%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("excess +1.40%").length).toBeGreaterThan(0);
  });

  it("loads the next page when the sentinel intersects", async () => {
    const fetcher = vi.fn(async (key: string) =>
      key.includes("page=2") ? page(2, 3) : page(1, PAGE_SIZE),
    );
    wrap(fetcher);
    await screen.findByText("TK0");
    expect(screen.queryByText("TK20")).toBeNull();
    act(() => {
      ioCb?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await waitFor(() => expect(screen.getByText("TK20")).toBeInTheDocument());
  });

  it("shows the empty state when there are no calls", async () => {
    const fetcher = vi.fn(async () => ({
      horizons: [7, 30, 90], benchmark: "VOO", total: 0, page: 1, page_size: PAGE_SIZE, calls: [],
    }));
    wrap(fetcher);
    expect(await screen.findByText("No buy/sell stances to score yet.")).toBeInTheDocument();
  });
});
