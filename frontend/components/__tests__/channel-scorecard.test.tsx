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
    vsBenchmark: "α {value}",
    noData: "no data",
    columns: { date: "Date", ticker: "Ticker", stance: "Stance", horizon: "{days}d", now: "Now" },
    filter: { stance: "Stance", allStances: "All stances", ticker: "Ticker", allTickers: "All tickers" },
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
    returns: { "30": 8.2, "90": null },
    alpha: { "30": 1.4, "90": null },
    now_return: 15.0,
    now_alpha: 2.0,
    has_data: true,
  };
}

function page(n: number, count: number) {
  return {
    horizons: [30, 90],
    benchmark: "VOO",
    total: 23,
    page: n,
    page_size: PAGE_SIZE,
    tickers: ["TK0", "TK1"],
    calls: Array.from({ length: count }, (_, k) => makeCall((n - 1) * PAGE_SIZE + k)),
  };
}

// Controllable IntersectionObserver: track each (callback, element) pair so we
// can fire the sentinel specifically, even when Base UI Select also registers an observer.
let observed: { cb: IntersectionObserverCallback; el: Element }[] = [];
class MockIntersectionObserver {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
  observe(el: Element) { observed.push({ cb: this.cb, el }); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

function triggerSentinel() {
  const hits = observed.filter(
    (o) => o.el?.getAttribute?.("data-testid") === "scorecard-sentinel",
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
  it("renders the first page with return %, α, and the Now column", async () => {
    const fetcher = vi.fn(async () => page(1, PAGE_SIZE));
    wrap(fetcher);
    expect(await screen.findByText("TK0")).toBeInTheDocument();
    expect(screen.getAllByText("+8.20%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("α +1.40%").length).toBeGreaterThan(0);
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getAllByText("+15.00%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("α +2.00%").length).toBeGreaterThan(0);
  });

  it("orders performance columns as Now, 30d, 90d and drops 7d", async () => {
    const fetcher = vi.fn(async () => page(1, PAGE_SIZE));
    wrap(fetcher);
    await screen.findByText("TK0");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("7d");
    const now = headers.indexOf("Now");
    const d30 = headers.indexOf("30d");
    const d90 = headers.indexOf("90d");
    expect(now).toBeGreaterThan(-1);
    expect(now).toBeLessThan(d30);
    expect(d30).toBeLessThan(d90);
  });

  it("loads the next page when the sentinel intersects", async () => {
    const fetcher = vi.fn(async (key: string) =>
      key.includes("page=2") ? page(2, 3) : page(1, PAGE_SIZE),
    );
    wrap(fetcher);
    await screen.findByText("TK0");
    expect(screen.queryByText("TK20")).toBeNull();
    triggerSentinel();
    await waitFor(() => expect(screen.getByText("TK20")).toBeInTheDocument());
  });

  it("renders stance and ticker filter controls", async () => {
    const fetcher = vi.fn(async () => page(1, PAGE_SIZE));
    const { container } = wrap(fetcher);
    await screen.findByText("TK0");
    expect(container.querySelectorAll('[data-slot="select-trigger"]').length).toBe(2);
  });

  it("shows the empty state when there are no calls", async () => {
    const fetcher = vi.fn(async () => ({
      horizons: [30, 90], benchmark: "VOO", total: 0, page: 1, page_size: PAGE_SIZE, calls: [],
    }));
    wrap(fetcher);
    expect(await screen.findByText("No buy/sell stances to score yet.")).toBeInTheDocument();
  });
});
