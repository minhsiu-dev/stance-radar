import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { RecentStocks } from "@/components/recent-stocks";

const messages = {
  Dashboard: {
    recentStocks: {
      title: "Recently discussed",
      week: "This week",
      month: "This month",
      quarter: "3M",
      empty: "No stocks discussed in this period",
      channelCount: "{count} channels",
      viewAll: "View all",
    },
  },
};

function wrap(fetcher: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <RecentStocks />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const zone = (count: number, avatarN = Math.min(count, 3)) => ({
  count,
  avatars: Array.from({ length: avatarN }, (_, i) => ({ title: `Ch${i}`, thumbnail_url: "" })),
});

const STOCKS = [
  { ticker: "NVDA", channel_count: 5, mention_count: 7, score: 1, last_mentioned_at: "2026-06-11T00:00:00Z",
    stances: { buy: zone(4), neutral: zone(0), sell: zone(1) } },
  { ticker: "AAPL", channel_count: 2, mention_count: 5, score: 1, last_mentioned_at: "2026-06-10T00:00:00Z",
    stances: { buy: zone(2), neutral: zone(0), sell: zone(0) } },
];

describe("RecentStocks", () => {
  it("renders a card per stock with ticker and channel count", async () => {
    wrap(vi.fn().mockResolvedValue(STOCKS));
    const cards = await screen.findAllByTestId("recent-stock-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("NVDA");
    expect(cards[0].textContent).toContain("5"); // channel count, not mention_count (7)
  });

  it("links each card to its stock page", async () => {
    wrap(vi.fn().mockResolvedValue(STOCKS));
    const nvda = await screen.findByRole("link", { name: /NVDA/ });
    expect(nvda.getAttribute("href")).toContain("/stocks/NVDA");
    expect(nvda.getAttribute("href")).not.toContain("ticker=");
  });

  it("shows a +N chip when a stance zone has more than 3 channels", async () => {
    wrap(vi.fn().mockResolvedValue(STOCKS));
    const cards = await screen.findAllByTestId("recent-stock-card");
    expect(cards[0].textContent).toContain("+1"); // NVDA buy: 4 channels, 3 avatars
  });

  it("renders nothing when the API returns an empty array", async () => {
    const { container } = wrap(vi.fn().mockResolvedValue([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='recent-stock-card']")).toBeNull();
  });

  it("defaults to a 90-day window and refetches when a period is selected", async () => {
    const fetcher = vi.fn().mockResolvedValue(STOCKS);
    wrap(fetcher);
    await screen.findByRole("link", { name: /NVDA/ });
    expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("days=90"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => {
      expect(fetcher.mock.calls.some(([u]: string[]) => u.includes("days=7"))).toBe(true);
    });
  });
});
