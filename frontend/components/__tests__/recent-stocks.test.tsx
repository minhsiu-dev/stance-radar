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
  { ticker: "NVDA", mention_count: 7, last_mentioned_at: "2026-06-11T00:00:00Z" },
  { ticker: "AAPL", mention_count: 5, last_mentioned_at: "2026-06-10T00:00:00Z" },
];

describe("RecentStocks", () => {
  it("renders each stock as a link to its stock page, in API order", async () => {
    wrap(vi.fn().mockResolvedValue(STOCKS));
    const nvda = await screen.findByRole("link", { name: /NVDA/ });
    expect(nvda.getAttribute("href")).toContain("/stocks/NVDA");
    const aapl = screen.getByRole("link", { name: /AAPL/ });
    expect(aapl.getAttribute("href")).toContain("/stocks/AAPL");
    expect(aapl.getAttribute("href")).not.toContain("ticker=");

    const pills = screen.getAllByTestId("recent-stock-pill").map((el) => el.textContent);
    expect(pills[0]).toContain("NVDA");
    expect(pills[1]).toContain("AAPL");
  });

  it("renders nothing when the API returns an empty array", async () => {
    const { container } = wrap(vi.fn().mockResolvedValue([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='recent-stock-pill']")).toBeNull();
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
