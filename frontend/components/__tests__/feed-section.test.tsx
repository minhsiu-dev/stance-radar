import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FeedSection } from "@/components/feed-section";

const messages = {
  Dashboard: {
    trending: { title: "Recently mentioned" },
    feed: {
      noMore: "No more results",
      noMatch: "No videos match",
      dropped: "Ignored: {tickers}",
      droppedHint: "could not validate",
      loadError: "Failed: {message}",
      statusNoTranscript: "no transcript",
      statusFailed: "failed",
      statusPending: "pending",
      statusNoMentions: "no mentions",
      filter: {
        allChannels: "All channels",
        allTickers: "All stocks",
        allStances: "All stances",
        holdingsOnly: "Holdings only",
      },
    },
    empty: { prompt: "", linkLabel: "channels", hint: "" },
  },
  Stock: { stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" } },
};

const PAGE_SIZE = 20;

const HOLDINGS_TOTALS = {
  market_value: 0,
  cost_basis: 0,
  unrealized_pl: 0,
  unrealized_pl_percent: 0,
};

function makeFetcher() {
  return vi.fn().mockImplementation((key: string) => {
    if (key.startsWith("/api/stocks/trending"))
      return Promise.resolve([
        { ticker: "META", mention_count: 9, last_mentioned_at: "2026-06-11T00:00:00Z" },
        { ticker: "NVDA", mention_count: 7, last_mentioned_at: "2026-06-10T00:00:00Z" },
      ]);
    if (key.startsWith("/api/portfolio/holdings"))
      return Promise.resolve({ holdings: [], totals: HOLDINGS_TOTALS });
    if (key.startsWith("/api/channels")) return Promise.resolve([]);
    if (key.startsWith("/api/stocks")) return Promise.resolve([]);
    return Promise.resolve({
      items: [
        {
          video_id: "v1",
          title: "Video 1",
          thumbnail_url: "",
          published_at: "2026-06-10T00:00:00Z",
          status: "analyzed",
          error_message: null,
          dropped_tickers: [],
          channel: { id: "c", title: "ch" },
          stances: [
            { ticker: "META", stance: "buy", confidence: null, summary: "META summary" },
            { ticker: "NVDA", stance: "sell", confidence: null, summary: "NVDA summary" },
          ],
        },
      ],
      total: 1,
      page: 1,
      page_size: PAGE_SIZE,
    });
  });
}

function wrap(fetcher: (key: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <FeedSection />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("FeedSection", () => {
  it("clicking a trending pill filters the feed and highlights it", async () => {
    const fetcher = makeFetcher();
    wrap(fetcher);

    const meta = await screen.findByRole("button", { name: /META/ });
    expect(meta).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(meta);

    await waitFor(() => {
      expect(
        fetcher.mock.calls.some(([url]: string[]) => url.includes("ticker=META")),
      ).toBe(true);
    });
    expect(meta).toHaveAttribute("aria-pressed", "true");

    // 非選中的 NVDA badge 變暗(badge Link 的 title 是 summary)
    await waitFor(() => {
      expect(screen.getByTitle("NVDA summary").className).toContain("opacity-40");
    });
    expect(screen.getByTitle("META summary").className).not.toContain("opacity-40");

    // 再點一次取消選取
    await userEvent.click(meta);
    expect(meta).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => {
      expect(screen.getByTitle("NVDA summary").className).not.toContain("opacity-40");
    });
  });

  it("highlights the selected pill and dims the others", async () => {
    const fetcher = makeFetcher();
    wrap(fetcher);

    // FeedList 的 ticker filter 與 pill 共用同一個 state:
    // 點 NVDA pill 後,META pill 變暗(opacity-40),NVDA pill 高亮
    const nvda = await screen.findByRole("button", { name: /NVDA/ });
    const meta = await screen.findByRole("button", { name: /META/ });
    await userEvent.click(nvda);
    expect(nvda).toHaveAttribute("aria-pressed", "true");
    expect(nvda.className).toContain("border-primary");
    expect(meta.className).toContain("opacity-40");
  });

  it("reverse-sync: selecting META via the feed ticker dropdown activates the META pill", async () => {
    // Fetcher returns META in both /api/stocks (for dropdown) and /api/stocks/trending (for pills)
    const fetcher = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("/api/stocks/trending"))
        return Promise.resolve([
          { ticker: "META", mention_count: 3, last_mentioned_at: "2026-06-11T00:00:00Z" },
        ]);
      if (key.startsWith("/api/portfolio/holdings"))
        return Promise.resolve({ holdings: [], totals: HOLDINGS_TOTALS });
      if (key.startsWith("/api/channels")) return Promise.resolve([]);
      if (key.startsWith("/api/stocks"))
        return Promise.resolve([{ ticker: "META", mention_count: 3 }]);
      return Promise.resolve({
        items: [
          {
            video_id: "v1",
            title: "Video 1",
            thumbnail_url: "",
            published_at: "2026-06-10T00:00:00Z",
            status: "analyzed",
            error_message: null,
            dropped_tickers: [],
            channel: { id: "c", title: "ch" },
            stances: [{ ticker: "META", stance: "buy", confidence: null, summary: "META summary" }],
          },
        ],
        total: 1,
        page: 1,
        page_size: PAGE_SIZE,
      });
    });
    wrap(fetcher);

    // Wait for META pill to appear
    const metaPill = await screen.findByRole("button", { name: /META/ });
    expect(metaPill).toHaveAttribute("aria-pressed", "false");

    // Open the ticker dropdown by mousedown on the trigger
    const tickerTrigger = await screen.findByTestId("feed-filter-ticker");
    fireEvent.mouseDown(tickerTrigger);

    // Click the META option in the popup (portal renders to body, screen still finds it)
    // base-ui Select item requires pointerdown (sets allowMouseSelectionRef=true) before click
    const metaOption = await screen.findByRole("option", { name: "META" });
    fireEvent.pointerDown(metaOption, { pointerType: "mouse" });
    fireEvent.click(metaOption, { detail: 1 });

    // The META pill should now be active
    await waitFor(() => {
      expect(metaPill).toHaveAttribute("aria-pressed", "true");
    });
  });
});
