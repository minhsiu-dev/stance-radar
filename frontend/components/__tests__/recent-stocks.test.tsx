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

const STOCKS = [
  { ticker: "NVDA", channel_count: 4, mention_count: 7, score: 1, last_mentioned_at: "2026-06-11T00:00:00Z" },
  { ticker: "AAPL", channel_count: 2, mention_count: 5, score: 1, last_mentioned_at: "2026-06-10T00:00:00Z" },
];

describe("RecentStocks", () => {
  it("renders each stock as a row linking to its page, with its channel count", async () => {
    wrap(vi.fn().mockResolvedValue(STOCKS));
    const nvda = await screen.findByRole("link", { name: /NVDA/ });
    expect(nvda.getAttribute("href")).toContain("/stocks/NVDA");
    expect(nvda.getAttribute("href")).not.toContain("ticker=");

    const rows = screen.getAllByTestId("recent-stock-row").map((el) => el.textContent);
    expect(rows[0]).toContain("NVDA");
    expect(rows[0]).toContain("4");   // channel count, not mention_count (7)
    expect(rows[1]).toContain("AAPL");
    expect(rows[1]).toContain("2");
  });

  it("renders nothing when the API returns an empty array", async () => {
    const { container } = wrap(vi.fn().mockResolvedValue([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='recent-stock-row']")).toBeNull();
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
